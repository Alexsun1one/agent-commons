from typing import Optional

from fastapi import APIRouter, Depends

from .. import flags, fts, pagination
from ..authz import visible_predicate
from ..context import Ctx, ok, user_ctx
from ..errors import ApiError

router = APIRouter(prefix='/api/search')

BASE = 'FROM search_fts JOIN object_head h ON h.doc_no = search_fts.rowid WHERE search_fts MATCH :q AND {pred}{filters}'


@router.get('')
def search(q: str = '', type: Optional[str] = None, space_id: Optional[str] = None, limit: Optional[int] = None,
           cursor: Optional[str] = None, count: bool = False, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    flags.gate(conn, 'core.search')
    size = pagination.page_size(limit)
    q = q.strip()
    if len(q) > 100:
        raise ApiError('validation_failed', '检索词不超过 100 个字')
    expr = fts.match_expression(q)
    if not expr:
        return ok(ctx, [], next_cursor=None, **({'count': 0} if count else {}))
    filters, params = '', {'q': expr}
    for key, value in (('type', type), ('space_id', space_id)):
        if value is not None:
            filters += f' AND h.{key} = :f_{key}'
            params[f'f_{key}'] = value
    pred = visible_predicate(ctx.actor)
    params.update(pred.params)
    base = BASE.format(pred=pred.sql, filters=filters)
    qhash = pagination.query_hash('search', expr, type, space_id)
    after = pagination.decode(ctx.settings, cursor, ctx.actor.id, qhash)
    outer = ''
    if after:
        outer = 'WHERE (rank, id) > (:c_rank, :c_id)'
        params.update(c_rank=after[0], c_id=after[1])
    hits = conn.execute(f'SELECT id, rank FROM (SELECT h.id AS id, bm25(search_fts, 4.0, 1.0) AS rank {base}) '
                        f'{outer} ORDER BY rank, id LIMIT :n', {**params, 'n': size + 1}).fetchall()
    hits, next_cursor = pagination.page(ctx.settings, ctx.actor.id, qhash, hits, size, lambda r: [r['rank'], r['id']])
    results = []
    for hit in hits:
        row = conn.execute(
            'SELECT h.id, h.type, h.space_id, h.root_id, h.author_id, h.created_at, h.current_version, d.title, d.body, '
            'p.display_name FROM object_head h JOIN search_doc d ON d.object_id = h.id '
            'JOIN profile p ON p.principal_id = h.author_id WHERE h.id = ?', (hit['id'],)).fetchone()
        results.append({
            'id': row['id'], 'type': row['type'], 'space_id': row['space_id'], 'root_id': row['root_id'],
            'title': row['title'], 'snippet': fts.snippet(row['body'], q), 'version': row['current_version'],
            'created_at': row['created_at'], 'author': {'id': row['author_id'], 'display_name': row['display_name']},
        })
    meta = {'next_cursor': next_cursor}
    if count:
        meta['count'] = conn.execute(f'SELECT count(*) {base}', params).fetchone()[0]
    return ok(ctx, results, **meta)
