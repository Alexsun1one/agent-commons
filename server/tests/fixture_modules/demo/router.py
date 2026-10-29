from fastapi import APIRouter, Depends

from app import outbox
from app.authz import require
from app.context import Ctx, ok, user_ctx

router = APIRouter(prefix='/api/demo')
SEEN = []


def on_object_created(conn, event):
    SEEN.append(event['aggregate_id'])
    conn.execute('INSERT OR IGNORE INTO demo_note (id, body) VALUES (?, ?)', (event['aggregate_id'], event['event_type']))


outbox.subscribe('demo.notes', 'object.*', on_object_created)


@router.get('/ping')
def ping(ctx: Ctx = Depends(user_ctx)):
    require(ctx.db.conn(), ctx.actor, 'demo.ping')
    return ok(ctx, {'pong': True})
