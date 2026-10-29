import hashlib
import io
import json
import os
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

from app.tools import replay_withdrawals
from app.withdrawals import LogError, append, read

ROOT = Path(__file__).resolve().parents[2]
BACKUP = ROOT / 'deploy' / 'backup.sh'
INSTALL = ROOT / 'deploy' / 'install.sh'
RESTORE = ROOT / 'deploy' / 'restore.sh'
AT = '2026-10-27T00:00:00.000000Z'


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _write_env(directory, db, log, backup, allow_same, storage=None):
    path = Path(directory) / 'backup.env'
    lines = [
        f'COMMONS_DB_PATH={db}',
        f'COMMONS_WITHDRAWAL_LOG={log}',
        f'COMMONS_BACKUP_ROOT={backup}',
    ]
    if allow_same:
        lines.append('COMMONS_ALLOW_SAME_DEVICE=1')
    if storage is not None:
        lines.append(f'COMMONS_STORAGE_DIR={storage}')
    path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return path


def _empty_db(path):
    with sqlite3.connect(path) as conn:
        conn.execute('CREATE TABLE marker (id INTEGER PRIMARY KEY)')


def _object_db(path):
    with sqlite3.connect(path) as conn:
        conn.execute(
            '''CREATE TABLE object_head (
                 id TEXT PRIMARY KEY,
                 lifecycle TEXT NOT NULL,
                 withdrawn_at TEXT,
                 updated_at TEXT,
                 policy_epoch INTEGER NOT NULL,
                 doc_no INTEGER
               )'''
        )
        conn.execute('CREATE TABLE search_doc (object_id TEXT PRIMARY KEY)')
        conn.execute(
            "INSERT INTO object_head VALUES ('gone', 'active', NULL, ?, 1, 1)",
            (AT,),
        )


class WithdrawalChainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='commons-lg1-')
        self.log = os.path.join(self.tmp.name, 'withdrawals.jsonl')

    def tearDown(self):
        self.tmp.cleanup()

    def test_append_keeps_record_shape_and_chain_mode(self):
        self.assertEqual(append(self.log, 'obj-1', 'actor-1', AT), 1)
        record = json.loads(Path(self.log).read_text(encoding='utf-8').splitlines()[0])
        self.assertEqual(
            set(record),
            {'seq', 'ns', 'object_id', 'version', 'reason', 'at', 'actor'},
        )
        self.assertEqual(record['ns'], 'object')
        self.assertIsNone(record['version'])
        self.assertIsNone(record['reason'])
        chain = Path(self.log + '.chain')
        self.assertEqual(stat.S_IMODE(chain.stat().st_mode) & 0o077, 0)
        self.assertEqual(stat.S_IMODE(os.stat(self.log).st_mode) & 0o077, 0)
        records, problems = read(self.log)
        self.assertEqual(problems, [])
        self.assertEqual(records[0]['object_id'], 'obj-1')

    def test_tamper_and_missing_chain_refuse_another_append(self):
        append(self.log, 'obj-1', 'actor-1', AT)
        original = Path(self.log + '.chain').read_text(encoding='utf-8')
        Path(self.log + '.chain').write_text('1 ' + ('0' * 64) + '\n', encoding='utf-8')
        with self.assertRaises(LogError):
            append(self.log, 'obj-2', 'actor-1', AT)
        self.assertEqual(len(Path(self.log).read_text(encoding='utf-8').splitlines()), 1)
        Path(self.log + '.chain').write_text(original, encoding='utf-8')
        os.remove(self.log + '.chain')
        with self.assertRaises(LogError):
            read(self.log)

    def test_gap_does_not_apply_and_replay_is_idempotent(self):
        db = os.path.join(self.tmp.name, 'objects.sqlite3')
        _object_db(db)
        append(self.log, 'gone', 'actor-1', AT)
        self.assertEqual(
            replay_withdrawals.main(['--database', db, '--log', self.log, '--fail-on-gap']),
            0,
        )
        self.assertEqual(
            replay_withdrawals.main(['--database', db, '--log', self.log, '--fail-on-gap']),
            0,
        )
        with sqlite3.connect(db) as conn:
            row = conn.execute(
                'SELECT lifecycle, withdrawn_at, policy_epoch FROM object_head WHERE id = ?',
                ('gone',),
            ).fetchone()
        self.assertEqual(row, ('withdrawn', AT, 2))

        fresh = os.path.join(self.tmp.name, 'fresh.sqlite3')
        _object_db(fresh)
        with open(self.log, 'a', encoding='utf-8') as handle:
            handle.write(
                '{"seq":3,"object_id":"gone","at":"2026-10-27T00:00:02.000000Z","actor":"actor-1"}\n'
            )
        self.assertEqual(
            replay_withdrawals.main(['--database', fresh, '--log', self.log, '--fail-on-gap']),
            2,
        )
        with sqlite3.connect(fresh) as conn:
            self.assertEqual(
                conn.execute('SELECT lifecycle FROM object_head').fetchone()[0],
                'active',
            )


class BackupScriptTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='commons-lg1-backup-')
        self.db = os.path.join(self.tmp.name, 'live.sqlite3')
        self.log = os.path.join(self.tmp.name, 'withdrawals.jsonl')
        self.root = os.path.join(self.tmp.name, 'backups')
        _empty_db(self.db)
        Path(self.log).write_text('', encoding='utf-8')

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, allow_same, storage=None):
        env = _write_env(self.tmp.name, self.db, self.log, self.root, allow_same, storage)
        return subprocess.run([str(BACKUP), '--env', str(env)], capture_output=True, text=True)

    def test_same_device_is_refused(self):
        result = self._run(False)
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertIn('different block device', result.stderr)

    def test_nonempty_log_without_chain_is_refused(self):
        Path(self.log).write_text('{"seq":1}\n', encoding='utf-8')
        result = self._run(True)
        self.assertEqual(result.returncode, 66, result.stderr)
        self.assertIn('checksum chain is missing', result.stderr)

    def test_backup_copies_chain_into_manifest(self):
        append(self.log, 'obj-1', 'actor-1', AT)
        result = self._run(True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('backup_ok', result.stdout)
        copies = list(Path(self.root, 'hourly').glob('commons-*.withdrawals.chain'))
        self.assertEqual(len(copies), 1)
        manifest = Path(str(copies[0]).replace('.withdrawals.chain', '.sha256'))
        text = manifest.read_text(encoding='utf-8')
        self.assertIn(f'{_sha256(copies[0])}  {copies[0].name}', text)
        daily = list(Path(self.root, 'daily').glob('commons-*.withdrawals.chain'))
        self.assertEqual(len(daily), 1)
        self.assertIn('policy=48-hourly/14-daily', result.stdout)
        self.assertIn('encryption=disk_volume_only', result.stdout)
        self.assertIn('files=skipped', result.stdout)

    def test_missing_storage_dir_is_refused(self):
        result = self._run(True, storage=os.path.join(self.tmp.name, 'missing-files'))
        self.assertEqual(result.returncode, 66, result.stderr)
        self.assertIn('user-content directory does not exist', result.stderr)

    def test_backup_and_restore_roundtrip_user_files(self):
        storage = Path(self.tmp.name) / 'user-content'
        body = storage / 'html_work' / 'ab' / 'abcd'
        body.parent.mkdir(parents=True)
        body.write_text('work', encoding='utf-8')
        original = storage / 'upload_raw' / 'ff' / 'original'
        original.parent.mkdir(parents=True)
        original.write_bytes(b'exif')
        link = storage / 'html_work' / 'escape'
        link.symlink_to(self.tmp.name)
        result = self._run(True, storage=str(storage))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('files=included', result.stdout)
        self.assertIn('policy=48-hourly/14-daily', result.stdout)
        archives = list(Path(self.root, 'hourly').glob('commons-*.files.tar'))
        self.assertEqual(len(archives), 1)
        manifest = Path(str(archives[0]).replace('.files.tar', '.sha256'))
        self.assertIn(f'{_sha256(archives[0])}  {archives[0].name}', manifest.read_text(encoding='utf-8'))
        with tarfile.open(archives[0], 'r') as bundle:
            names = set(bundle.getnames())
        self.assertIn('html_work/ab/abcd', names)
        self.assertIn('upload_raw/ff/original', names)
        self.assertNotIn('html_work/escape', names)
        daily = list(Path(self.root, 'daily').glob('commons-*.files.tar'))
        self.assertEqual(len(daily), 1)

        body.unlink()
        original.unlink()
        backup_db = next(Path(self.root, 'hourly').glob('commons-*.sqlite3'))
        health = Path(self.tmp.name) / 'health.sh'
        health.write_text('#!/bin/sh\nexit 0\n', encoding='utf-8')
        health.chmod(0o755)
        env = _write_env(self.tmp.name, self.db, self.log, self.root, True, str(storage))
        restored = self._restore(env, backup_db, health)
        self.assertEqual(restored.returncode, 0, restored.stderr)
        self.assertEqual(body.read_text(encoding='utf-8'), 'work')
        self.assertEqual(original.read_bytes(), b'exif')

    def test_restore_rejects_escaping_archive(self):
        storage = Path(self.tmp.name) / 'user-content'
        storage.mkdir()
        (storage / 'keep-me').write_text('stay', encoding='utf-8')
        result = self._run(True, storage=str(storage))
        self.assertEqual(result.returncode, 0, result.stderr)
        archive = next(Path(self.root, 'hourly').glob('commons-*.files.tar'))
        payload = b'pwned'
        with tarfile.open(archive, 'w') as bundle:
            info = tarfile.TarInfo('../escaped.txt')
            info.size = len(payload)
            bundle.addfile(info, io.BytesIO(payload))
        manifest = Path(str(archive).replace('.files.tar', '.sha256'))
        text = manifest.read_text(encoding='utf-8')
        old = next(line for line in text.splitlines() if line.endswith(f'  {archive.name}'))
        manifest.write_text(
            text.replace(old, f'{_sha256(archive)}  {archive.name}'),
            encoding='utf-8',
        )
        scratch = Path(self.tmp.name) / 'scratch'
        scratch.mkdir()
        (storage / 'keep-me').write_text('changed-after-backup', encoding='utf-8')
        backup_db = next(Path(self.root, 'hourly').glob('commons-*.sqlite3'))
        health = Path(self.tmp.name) / 'health-escape.sh'
        health.write_text('#!/bin/sh\nexit 0\n', encoding='utf-8')
        health.chmod(0o755)
        env = _write_env(self.tmp.name, self.db, self.log, self.root, True, str(storage))
        restored = self._restore(env, backup_db, health, tmpdir=scratch)
        self.assertNotEqual(restored.returncode, 0, restored.stdout)
        self.assertFalse((scratch / 'escaped.txt').exists())
        self.assertEqual((storage / 'keep-me').read_text(encoding='utf-8'), 'changed-after-backup')
        with sqlite3.connect(self.db) as conn:
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM marker').fetchone()[0], 0)

    def _restore(self, env, backup_db, health, tmpdir=None):
        proc_env = os.environ.copy()
        proc_env['PYTHONPATH'] = str(ROOT / 'server')
        if tmpdir is not None:
            proc_env['TMPDIR'] = str(tmpdir)
        return subprocess.run(
            [
                str(RESTORE),
                '--env', str(env),
                '--backup', str(backup_db),
                '--withdrawal-log', self.log,
                '--database', self.db,
                '--python-bin', sys.executable,
                '--healthcheck-bin', str(health),
                '--no-systemd',
            ],
            capture_output=True,
            text=True,
            env=proc_env,
        )


def _install_env(directory, **overrides):
    values = {
        'COMMONS_SITE_DOMAIN': 'app.example.com',
        'COMMONS_CONTENT_DOMAIN': 'files.example.org',
        'COMMONS_LIVEKIT_DOMAIN': 'rtc.example.net',
        'COMMONS_API_PORT': '8000',
        'COMMONS_DATA_DIR': '/var/lib/commons',
        'COMMONS_DB_PATH': '/var/lib/commons/commons.db',
        'COMMONS_WITHDRAWAL_LOG': '/var/lib/commons/withdrawals.jsonl',
        'COMMONS_BACKUP_ROOT': '/mnt/commons-backup',
        'COMMONS_BACKUP_MAX_AGE_MINUTES': '90',
        'COMMONS_BACKUP_DISK_ENCRYPTION': '1',
        'COMMONS_STORAGE_DIR': '/srv/commons-user-content',
    }
    values.update(overrides)
    path = Path(directory) / 'install.env'
    path.write_text(''.join(f'{key}={value}\n' for key, value in values.items()), encoding='utf-8')
    return path


class InstallGuardTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='commons-lg1-install-')

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, **overrides):
        env = _install_env(self.tmp.name, **overrides)
        return subprocess.run([str(INSTALL), '--env', str(env)], capture_output=True, text=True)

    def test_equal_domains_rejected_before_root(self):
        result = self._run(COMMONS_CONTENT_DOMAIN='app.example.com')
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertIn('subdomain', result.stderr)

    def test_subdomain_rejected_before_root(self):
        result = self._run(COMMONS_SITE_DOMAIN='www.example.com', COMMONS_CONTENT_DOMAIN='example.com')
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertIn('subdomain', result.stderr)

    def test_case_and_trailing_dot_count_as_same_host(self):
        result = self._run(COMMONS_CONTENT_DOMAIN='App.Example.com.')
        self.assertEqual(result.returncode, 78, result.stderr)

    def test_missing_disk_encryption_ack_rejected(self):
        result = self._run(COMMONS_BACKUP_DISK_ENCRYPTION='')
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertIn('disk-volume encryption', result.stderr)

    def test_other_storage_dir_rejected(self):
        result = self._run(COMMONS_STORAGE_DIR='/var/lib/commons/files')
        self.assertEqual(result.returncode, 78, result.stderr)
        self.assertIn('/srv/commons-user-content', result.stderr)

    def test_valid_config_reaches_root_or_ubuntu_check(self):
        result = self._run()
        if os.geteuid() == 0:
            self.assertEqual(result.returncode, 69, result.stderr)
        else:
            self.assertEqual(result.returncode, 77, result.stderr)
            self.assertIn('must run as root', result.stderr)


if __name__ == '__main__':
    unittest.main()
