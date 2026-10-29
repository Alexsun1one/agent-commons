import fcntl
import hashlib
import json
import os
import re
from pathlib import Path

_CODE = re.compile(r'^[a-z][a-z0-9_.]{0,39}$')


class LogError(RuntimeError):
    pass


GENESIS = '0' * 64


def chain_path(path):
    return str(path) + '.chain'


def _link(prev, line):
    return hashlib.sha256(f'{prev}\n{line}'.encode()).hexdigest()


def _payload_lines(text):
    return [line for line in text.splitlines() if line.strip()]


def _expected_chain(lines):
    prev = GENESIS
    entries = []
    for index, line in enumerate(lines, 1):
        prev = _link(prev, line)
        entries.append(f'{index} {prev}')
    return entries


def _chain_entries(path):
    chain = chain_path(path)
    if not os.path.exists(chain):
        return None
    return [line.strip() for line in Path(chain).read_text(encoding='utf-8').splitlines() if line.strip()]


def check_chain(path, lines):
    """Sidecar chain: the JSON record holds ids and codes only, never content."""
    found = _chain_entries(path)
    if not lines and found is None:
        return []
    if not lines and not found:
        return []
    if found is None:
        return ['checksum chain is missing']
    expected = _expected_chain(lines)
    if found == expected:
        return []
    if len(found) > len(expected):
        return ['checksum chain is longer than the withdrawal log']
    for index, (got, want) in enumerate(zip(found, expected), 1):
        if got != want:
            return [f'checksum {index}: mismatch']
    return [f'checksum {len(found) + 1}: missing']


def _last_seq(f):
    f.seek(0, os.SEEK_END)
    size = f.tell()
    if size == 0:
        return 0
    f.seek(max(0, size - 8192))
    lines = [line for line in f.read().splitlines() if line.strip()]
    try:
        return int(json.loads(lines[-1])['seq'])
    except (ValueError, KeyError, IndexError, UnicodeDecodeError) as exc:
        raise LogError('withdrawal log tail is unreadable') from exc


def _write_chain(path, entries):
    target = Path(chain_path(path))
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f'.{target.name}.{os.getpid()}.partial')
    data = ''.join(f'{entry}\n' for entry in entries).encode()
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, data)
        os.fsync(fd)
    except Exception:
        os.close(fd)
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    os.close(fd)
    os.replace(tmp, target)


def append(path, object_id, actor_id, at, *, ns='object', version=None, reason=None):
    if not path:
        raise LogError('withdrawal log path is not configured')
    if not _CODE.match(ns) or (reason is not None and not _CODE.match(reason)):
        raise LogError('withdrawal ns and reason must be short codes')
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, 'a+b') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        try:
            f.seek(0)
            try:
                existing = _payload_lines(f.read().decode())
            except UnicodeDecodeError as exc:
                raise LogError('withdrawal log tail is unreadable') from exc
            problems = check_chain(path, existing)
            if problems:
                raise LogError('; '.join(problems))
            seq = _last_seq(f) + 1
            record = {'seq': seq, 'ns': ns, 'object_id': object_id, 'version': version, 'reason': reason, 'at': at, 'actor': actor_id}
            line = json.dumps(record, separators=(',', ':'))
            f.write((line + '\n').encode())
            f.flush()
            os.fsync(f.fileno())
            _write_chain(path, _expected_chain(existing + [line]))
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)
    return seq


def read(path, fail_on_gap=True):
    records = []
    problems = []
    expected = 1
    text = Path(path).read_text(encoding='utf-8')
    for number, line in enumerate(text.splitlines(), 1):
        if not line.strip():
            continue
        try:
            record = json.loads(line)
            seq = int(record['seq'])
            record['object_id'], record['at']
        except (ValueError, KeyError, TypeError):
            problems.append(f'line {number}: malformed record')
            continue
        if seq != expected:
            problems.append(f'line {number}: expected seq {expected}, found {seq}')
        expected = seq + 1
        records.append(record)
    problems.extend(check_chain(path, _payload_lines(text)))
    if problems and fail_on_gap:
        raise LogError('; '.join(problems))
    return records, problems
