"""Anonymous HTTP contract on an isolated, disposable database and the assigned port."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[3]
PATHS = [
    '/me', '/announce/active', '/feed/events', '/agents/catalog', '/agents/mine',
    '/agents/unknown/preview', '/agentchat/agents', '/search/members?kinds=agent',
    '/social/profiles', '/social/people/unknown', '/orgs/hub/constellation',
    '/orgs/hub/projects', '/objects?type=work', '/events', '/bounty/list',
    '/orgs/hub/opportunities', '/growth/me', '/achievements/me', '/economy/me',
    '/notify/unread-count', '/notify/notifications', '/dm/unread-count',
]
with tempfile.TemporaryDirectory(prefix='ac-xg-data-') as data:
    env = dict(os.environ, COMMONS_DATA_DIR=data, COMMONS_ORIGIN='http://127.0.0.1:8731',
               PYTHONDONTWRITEBYTECODE='1')
    migration = subprocess.run(['python3', '-m', 'app', 'migrate'], cwd=ROOT / 'server', env=env,
                               capture_output=True, text=True, check=True)
    print(migration.stdout.strip())
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen(['python3', '-m', 'app', 'serve', '--port', '8731'],
                                   cwd=ROOT / 'server', env=env, stdout=log, stderr=log)
        try:
            ready = False
            for _ in range(100):
                if process.poll() is not None:
                    break
                log.seek(0)
                if b'Uvicorn running on http://127.0.0.1:8731' in log.read():
                    ready = True
                    break
                time.sleep(.1)
            if not ready:
                raise RuntimeError('Owned backend did not start on 127.0.0.1:8731')
            for path in PATHS:
                response = subprocess.run(
                    ['curl', '--silent', '--show-error', '--max-time', '10', '--write-out', '\n%{http_code}',
                     'http://127.0.0.1:8731/api' + path], capture_output=True, text=True, check=True)
                body, status = response.stdout.rsplit('\n', 1)
                body, status = json.loads(body), int(status)
                expected = 200 if path in ['/feed/events', '/agents/catalog', '/objects?type=work'] else 401
                assert status == expected, (path, status)
                if status == 401:
                    assert body['error']['code'] == 'unauthenticated', path
                    shape = 'error.code=unauthenticated'
                else:
                    assert 'data' in body and 'meta' in body, path
                    value = body['data']
                    shape = sorted(value) if isinstance(value, dict) else f'list[{len(value)}]'
                    if path == '/objects?type=work':
                        assert value == []
                    elif path == '/agents/catalog':
                        assert 'tools' in value and 'agents' not in value
                    elif path == '/feed/events':
                        assert value['events'] == []
                print(json.dumps({'path': path, 'http': status, 'shape': shape}, ensure_ascii=False))
            print(f'PASS: {len(PATHS)} anonymous HTTP contracts; invitation-only content preserved')
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            print(f'STOPPED owned backend pid={process.pid}')
