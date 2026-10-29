from fastapi import APIRouter, Request

from .. import clock

router = APIRouter(prefix='/api/health')


@router.get('')
def health(request: Request):
    conn = request.app.state.db.conn()
    conn.execute('SELECT 1').fetchone()
    migrations = conn.execute('SELECT count(*) FROM schema_migration').fetchone()[0]
    pending = conn.execute("SELECT count(*) FROM outbox_event WHERE state = 'pending'").fetchone()[0]
    dead = conn.execute("SELECT count(*) FROM outbox_event WHERE state = 'dead'").fetchone()[0]
    return {'data': {'status': 'ok', 'migrations': migrations, 'outbox_pending': pending, 'outbox_dead': dead,
                     'modules': [m.name for m in request.app.state.modules]},
            'meta': {'request_id': request.state.request_id, 'server_time': clock.now()}}
