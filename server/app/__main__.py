import argparse
import os

from . import accounts, audit, clock, discovery, migrate
from .db import Database
from .errors import ApiError
from .settings import Settings


def issue_cli_invite(conn, *, issuer=None, days=7):
    """One outstanding system code before bootstrap; named admin thereafter."""
    if issuer:
        pid = accounts.principal_by_handle(conn, issuer.strip().lower())
        allowed = conn.execute(
            "SELECT 1 FROM principal p JOIN role_assignment r ON r.principal_id = p.id "
            "WHERE p.id = ? AND p.status = 'active' AND r.role = 'admin' "
            'AND r.space_id IS NULL AND r.revoked_at IS NULL', (pid,)).fetchone()
        if allowed is None:
            raise ApiError('action_not_allowed', '签发人须为有效的全局管理员')
    else:
        if conn.execute('SELECT 1 FROM principal LIMIT 1').fetchone():
            raise ApiError('action_not_allowed', '已有账号，签发须带 --issuer 管理员用户名')
        pending = conn.execute(
            'SELECT 1 FROM invite_code WHERE inviter_id IS NULL AND revoked_at IS NULL '
            'AND used_count = 0 AND expires_at > ? LIMIT 1', (clock.now(),)).fetchone()
        if pending:
            raise ApiError('state_conflict', '已有有效的首个账号邀请码，请先使用或吊销')
        pid = None
    invite_id, code, expires = accounts.issue_invite(conn, pid, days=days,
                                                     note='cli.bootstrap' if pid is None else 'cli')
    audit.record(conn, pid, 'invite.cli_issue', 'invite_code', invite_id,
                 meta={'bootstrap': pid is None})
    return invite_id, code, expires


def main(argv=None, *, settings=None):
    parser = argparse.ArgumentParser(prog='python -m app')
    sub = parser.add_subparsers(dest='cmd', required=True)
    sub.add_parser('migrate')
    sub.add_parser('backup')
    serve = sub.add_parser('serve')
    serve.add_argument('--port', type=int, default=None)
    invite = sub.add_parser('issue-invite')
    invite.add_argument('--max-uses', type=int, choices=(1,), default=1)
    invite.add_argument('--days', type=int, default=7)
    invite.add_argument('--issuer', help='已有账号后必填：有效全局管理员的用户名')
    role = sub.add_parser('grant-role')
    role.add_argument('handle')
    role.add_argument('role')
    args = parser.parse_args(argv)
    settings = settings or Settings.from_env(os.environ)
    db = Database(settings.db_path)
    try:
        if args.cmd == 'serve':
            import uvicorn
            from .main import create_app
            port = args.port if args.port is not None else int(os.environ.get('COMMONS_API_PORT') or 8000)
            uvicorn.run(create_app(settings), host='127.0.0.1', port=port)
            return 0
        if args.cmd == 'migrate':
            done, snapshot = migrate.migrate(db, discovery.discover(settings.module_package), settings.backup_dir)
            print(f'migrated={len(done)} backup={snapshot or "-"}')
        elif args.cmd == 'backup':
            print(migrate.backup(db, settings.backup_dir, 'manual'))
        elif args.cmd == 'issue-invite':
            try:
                with db.write() as conn:
                    _, code, expires = issue_cli_invite(conn, issuer=args.issuer, days=args.days)
            except ApiError as exc:
                parser.error(exc.message)
            print(f'{code} expires_at={expires}')
        elif args.cmd == 'grant-role':
            with db.write() as conn:
                pid = accounts.principal_by_handle(conn, args.handle)
                accounts.set_role(conn, None, pid, args.role)
            print(f'granted {args.role} to {args.handle}')
        return 0

    finally:
        db.close()


if __name__ == '__main__':
    raise SystemExit(main())
