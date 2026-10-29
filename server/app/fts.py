import re

from . import clock

CJK = re.compile('[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\U00020000-\U0002ebef]+')
TOKEN = re.compile(r'[^\W_]+')
MAX_TERMS = 8
SNIPPET = 60


def segment(text):
    out = []
    pos = 0
    for m in CJK.finditer(text):
        out.append(text[pos:m.start()])
        run = m.group()
        grams = [run[i:i + 2] for i in range(len(run) - 1)] or [run]
        out.append(' ' + ' '.join(grams) + ' ')
        pos = m.end()
    out.append(text[pos:])
    return ''.join(out)


def match_expression(query):
    parts = []
    for term in query.split():
        tokens = TOKEN.findall(segment(term))
        if not tokens:
            continue
        if len(parts) == MAX_TERMS:
            break
        if len(tokens) == 1:
            parts.append(f'"{tokens[0]}"*')
        else:
            parts.append('"' + ' '.join(tokens) + '"')
    return ' '.join(parts)


def index(conn, object_id, version, title, body):
    unindex(conn, object_id)
    doc_no = conn.execute('SELECT doc_no FROM object_head WHERE id = ?', (object_id,)).fetchone()[0]
    conn.execute('INSERT INTO search_doc (object_id, object_version, title, body, indexed_at) VALUES (?, ?, ?, ?, ?)',
                 (object_id, version, title, body, clock.now()))
    conn.execute('INSERT INTO search_fts (rowid, title, body) VALUES (?, ?, ?)',
                 (doc_no, segment(title), segment(body)))


def unindex(conn, object_id):
    row = conn.execute('SELECT h.doc_no FROM search_doc d JOIN object_head h ON h.id = d.object_id '
                       'WHERE d.object_id = ?', (object_id,)).fetchone()
    if row is None:
        return False
    conn.execute('DELETE FROM search_fts WHERE rowid = ?', (row[0],))
    conn.execute('DELETE FROM search_doc WHERE object_id = ?', (object_id,))
    return True


def snippet(text, query):
    if not text:
        return ''
    lowered = text.lower()
    hits = [lowered.find(t.lower()) for t in query.split()[:MAX_TERMS]]
    hits = [h for h in hits if h >= 0]
    start = max(0, min(hits) - SNIPPET // 3) if hits else 0
    piece = text[start:start + SNIPPET].replace('\n', ' ')
    return ('…' if start > 0 else '') + piece + ('…' if start + SNIPPET < len(text) else '')
