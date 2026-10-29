"""ADMIN-2 system view: flags with impact, periodic jobs, health and masked configuration.

Secret and path-like settings are reported only as 已设置 / 未设置; their values never leave here.
"""

import sqlite3

from app import clock, worker

SECRET_SETTINGS = {
    'secret_key': '会话与游标签名密钥',
    'db_path': '数据库路径',
    'backup_dir': '备份目录',
    'storage_dir': '附件存储目录',
    'withdrawal_log': '撤回日志路径',
    'static_dir': '静态文件目录',
}
PLAIN_SETTINGS = {
    'public_origin': '站点来源',
    'content_origin': '附件来源',
    'allowed_origins': '允许的来源',
    'cookie_name': '会话 Cookie 名',
    'cookie_secure': '仅 HTTPS Cookie',
    'session_ttl': '会话有效期（秒）',
    'totp_issuer': '两步验证签发方',
    'rate_limits': '限流（次数, 窗口秒）',
    'trusted_proxies': '可信代理',
    'max_body': '请求体上限（字节）',
    'auto_migrate': '启动时自动迁移',
    'delete_cooldown_days': '注销冷静期（天）',
    'module_package': '模块包',
}


def flags(conn):
    rules = {}
    for row in conn.execute('SELECT action, flag FROM action_rule WHERE flag IS NOT NULL ORDER BY action'):
        rules.setdefault(row['flag'], []).append(row['action'])
    data = []
    for row in conn.execute(
            'SELECT f.key, f.enabled, f.description, f.updated_at, f.updated_by, c.handle AS updated_by_handle '
            'FROM feature_flag f LEFT JOIN credential c ON c.principal_id = f.updated_by ORDER BY f.key'):
        item = dict(row)
        item['enabled'] = bool(item['enabled'])
        item['module'] = item['key'].split('.', 1)[0]
        item['gates'] = rules.get(item['key'], [])
        data.append(item)
    return data


def _tasks(db):
    selector = getattr(worker, '_tasks_for', None)
    try:
        return tuple(selector(db)) if selector else tuple(worker.PERIODIC.values())
    except Exception:
        return tuple(worker.PERIODIC.values())


def jobs(db, conn):
    now = int(clock.now_ts())
    data = []
    for task in sorted(_tasks(db), key=lambda t: t.name):
        row = conn.execute('SELECT window_start, count FROM rate_bucket WHERE key = ?',
                           (f'periodic:{task.name}',)).fetchone()
        parts = (getattr(task.fn, '__module__', '') or '').split('.')
        item = {'name': task.name, 'every_seconds': task.every_seconds,
                'module': parts[1] if len(parts) > 1 and parts[0] == 'modules' else parts[0] or None,
                'last_run_at': None, 'next_due_at': None, 'state': 'never',
                'duration_ms': None, 'last_error': None, 'history': 'not_recorded'}
        if row is not None:
            if row['count'] < 0 and row['window_start'] > now:
                item['state'] = 'running'
            else:
                item['state'] = 'overdue' if row['window_start'] + task.every_seconds < now else 'idle'
                item['next_due_at'] = clock.iso(row['window_start'])
                item['last_run_at'] = clock.iso(row['window_start'] - task.every_seconds)
        data.append(item)
    return data


def health(app, conn):
    started = clock.now_ts()
    conn.execute('SELECT 1').fetchone()
    latest = conn.execute('SELECT id, applied_at FROM schema_migration ORDER BY applied_at DESC, id DESC LIMIT 1').fetchone()
    outbox = conn.execute(
        "SELECT sum(state = 'pending') AS pending, sum(state = 'dead') AS dead, "
        "min(CASE WHEN state = 'pending' THEN occurred_at END) AS oldest_pending FROM outbox_event").fetchone()
    return {
        'status': 'ok',
        'checked_at': clock.now(),
        'db_ms': round((clock.now_ts() - started) * 1000, 2),
        'sqlite': sqlite3.sqlite_version,
        'migrations': conn.execute('SELECT count(*) FROM schema_migration').fetchone()[0],
        'latest_migration': dict(latest) if latest else None,
        'outbox_pending': outbox['pending'] or 0,
        'outbox_dead': outbox['dead'] or 0,
        'outbox_oldest_pending': outbox['oldest_pending'],
        'modules': [m.name for m in app.state.modules],
    }


def _plain(value):
    if isinstance(value, dict):
        return {k: list(v) if isinstance(v, tuple) else v for k, v in value.items()}
    if isinstance(value, tuple):
        return list(value)
    return value


def config(settings):
    data = []
    for key, label in SECRET_SETTINGS.items():
        raw = getattr(settings, key, None)
        data.append({'key': key, 'label': label, 'is_secret': True, 'set': bool(raw), 'value': None})
    for key, label in PLAIN_SETTINGS.items():
        if hasattr(settings, key):
            data.append({'key': key, 'label': label, 'is_secret': False, 'set': True,
                         'value': _plain(getattr(settings, key))})
    return data


def collect(app, db, conn):
    return {'flags': flags(conn), 'jobs': jobs(db, conn), 'health': health(app, conn),
            'config': config(app.state.settings)}
