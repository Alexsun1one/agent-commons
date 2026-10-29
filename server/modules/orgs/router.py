from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field

from app import flags, objects
from app.authz import require
from app.context import Ctx, ok, user_ctx, write_ctx

from . import hooks, hub, service  # noqa: F401  注销钩子在导入时注册


from . import privacy  # noqa: F401 — register member export

router = APIRouter(prefix='/api/orgs')
admin_router = APIRouter(prefix='/api/admin/orgs')

objects.register_type('org_post', service.validate_post, service.post_text)


class Strict(BaseModel):
    model_config = ConfigDict(extra='forbid')


class OrgIn(Strict):
    name: str = Field(min_length=1, max_length=60)
    intro: str = Field(min_length=1, max_length=240)
    type: Literal['company', 'lab', 'school_club', 'open_source', 'interest_group']
    website: str = Field(default='', max_length=300)
    slug: Optional[str] = Field(default=None, max_length=40)
    banner: str = Field(default='', max_length=160)
    join_policy: Literal['invite', 'apply'] = 'apply'


class JoinIn(Strict):
    note: str = Field(default='', max_length=200)
    show_on_profile: bool = True


class RoleIn(Strict):
    role: Literal['owner', 'admin', 'member'] = 'member'
    state: Literal['active', 'invited', 'rejected'] = 'active'


class FollowIn(Strict):
    on: bool = True


class PostIn(Strict):
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=20_000)
    summary: str = Field(default='', max_length=240)
    tags: list[str] = Field(default_factory=list, max_length=8)
    visibility: Literal['members', 'level'] = 'members'
    min_level: int = Field(default=1, ge=1, le=5)


class ReviewIn(Strict):
    decision: Literal['approve', 'reject']
    note: str = Field(default='', max_length=300)


class ApplicationReviewIn(Strict):
    decision: Literal['approve', 'reject']
    note: str = Field(default='', max_length=300)


class VerificationIn(Strict):
    verified: bool


def gate(conn):
    flags.gate(conn, 'orgs.enabled')


@router.get('')
def orgs(
        type: Optional[str] = Query(default=None, max_length=24),
        q: Optional[str] = Query(default=None, max_length=80),
        sort: Literal['activity', 'followers'] = 'activity',
        ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    return ok(ctx, service.list_orgs(conn, ctx.actor, type, q, sort),
              types=[{'id': key, 'label': label} for key, label in service.KINDS.items()])


@router.post('', status_code=201)
def create_org(body: OrgIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn)
        return ok(ctx, service.create(conn, ctx.actor, body.model_dump(), ctx.request_id))


@router.get('/hub/opportunities')
def hub_opportunities(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    items, sources = hub.opportunities(conn, ctx.actor)
    return ok(ctx, items, sources=sources)


@router.get('/hub/projects')
def hub_projects(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    return ok(ctx, hub.projects(conn, ctx.actor))


@router.get('/hub/workshop')
def hub_workshop(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    data, sources = hub.workshop(conn, ctx.actor)
    return ok(ctx, data, sources=sources)


@router.get('/hub/constellation')
def hub_constellation(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    return ok(ctx, hub.constellation(conn, ctx.actor))


@router.get('/mine/applications')
def my_applications(ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    return ok(ctx, service.my_applications(conn, ctx.actor))


@router.get('/{slug}')
def org(slug: str, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    return ok(ctx, service.detail(conn, ctx.actor, slug))


@router.post('/{slug}/join')
def join(slug: str, body: Optional[JoinIn] = None, ctx: Ctx = Depends(write_ctx)):
    body = body or JoinIn()
    with ctx.db.write() as conn:
        gate(conn)
        return ok(ctx, service.join(conn, ctx.actor, slug, body.note, body.show_on_profile, ctx.request_id))


@router.post('/{slug}/members/{principal_id}/role')
def member_role(slug: str, principal_id: str, body: RoleIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn)
        return ok(ctx, service.set_member(conn, ctx.actor, slug, principal_id, body.role, body.state,
                                          ctx.request_id))


@router.get('/{slug}/applications')
def applications(slug: str, status: Literal['pending', 'approved', 'rejected'] = 'pending',
                 limit: Optional[int] = None, cursor: Optional[str] = None,
                 ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    rows, next_cursor = service.applications(conn, ctx.actor, slug, status, limit, cursor, ctx.settings)
    return ok(ctx, rows, cursor=next_cursor)


@router.post('/{slug}/applications/{principal_id}/review')
def review_application(slug: str, principal_id: str, body: ApplicationReviewIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn)
        return ok(ctx, service.review_application(conn, ctx.actor, slug, principal_id, body.decision, body.note,
                                                  ctx.request_id))


@router.get('/{slug}/posts/{object_id}')
def post_detail(slug: str, object_id: str, ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    return ok(ctx, service.post_detail(conn, ctx.actor, slug, object_id))


@router.post('/{slug}/follow')
def follow(slug: str, body: Optional[FollowIn] = None, ctx: Ctx = Depends(write_ctx)):
    body = body or FollowIn()
    with ctx.db.write() as conn:
        gate(conn)
        return ok(ctx, service.follow(conn, ctx.actor, slug, body.on, ctx.request_id))


@router.post('/{slug}/posts', status_code=201)
def create_post(slug: str, body: PostIn, ctx: Ctx = Depends(write_ctx)):
    payload = body.model_dump()
    content = {'body': payload.pop('body'), 'summary': payload.pop('summary'), 'tags': payload.pop('tags')}
    payload['content'] = content
    with ctx.db.write() as conn:
        gate(conn)
        object_id = service.create_post(conn, ctx.actor, slug, payload, ctx.request_id)
        return ok(ctx, {'id': object_id})


@router.post('/{slug}/works/{object_id}')
def attach_work(slug: str, object_id: str, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn)
        return ok(ctx, service.attach_work(conn, ctx.actor, slug, object_id, ctx.request_id))


@admin_router.get('/applications')
def applications(status: Literal['pending', 'approved', 'rejected', 'frozen'] = 'pending',
                 ctx: Ctx = Depends(user_ctx)):
    conn = ctx.db.conn()
    gate(conn)
    require(conn, ctx.actor, 'orgs.review')
    rows = conn.execute('SELECT * FROM org WHERE status = ? ORDER BY created_at, id', (status,)).fetchall()
    return ok(ctx, [service.application_view(conn, row) for row in rows])


@admin_router.post('/applications/{org_id}/review')
def review(org_id: str, body: ReviewIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn)
        return ok(ctx, service.review(conn, ctx.actor, org_id, body.decision, body.note, ctx.request_id))


@admin_router.post('/{slug}/verification')
def verification(slug: str, body: VerificationIn, ctx: Ctx = Depends(write_ctx)):
    with ctx.db.write() as conn:
        gate(conn)
        return ok(ctx, service.set_verified(conn, ctx.actor, slug, body.verified, ctx.request_id))
