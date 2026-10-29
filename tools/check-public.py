#!/usr/bin/env python3
"""Check the exact publication allowlist, optionally against Git's staged snapshot."""
import argparse
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--staged', action='store_true')
args = parser.parse_args()
allowed = set((ROOT / 'tools/public-files.txt').read_text().splitlines())
if args.staged:
    names = subprocess.check_output(['git', 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], cwd=ROOT).decode().split('\0')
    names = [n for n in names if n]
else:
    names = sorted(allowed)
problems = []
for name in names:
    p = ROOT / name
    if name not in allowed:
        problems.append((name, 'not in publication allowlist'))
        continue
    if p.is_symlink() or Path(name).is_absolute() or '..' in Path(name).parts:
        problems.append((name, 'invalid publication path'))
        continue
    if any(x in Path(name).parts for x in ['node_modules', '__pycache__', '.git', '.venv', '.local-data', 'evidence', 'innovation']):
        problems.append((name, 'private or generated directory'))
    if p.name.startswith('.env') or p.suffix.lower() in {'.db', '.sqlite', '.sqlite3', '.log', '.jsonl'}:
        problems.append((name, 'runtime data or credential file'))
    if not p.is_file():
        problems.append((name, 'missing file'))
        continue
    data = subprocess.check_output(['git', 'show', ':' + name], cwd=ROOT) if args.staged else p.read_bytes()
    if len(data) > 90 * 1024 * 1024:
        problems.append((name, 'file exceeds publication size limit'))
    if p.suffix.lower() in {'.png', '.webp', '.jpg', '.jpeg', '.gif'}:
        continue
    text = data.decode('utf-8', errors='replace')
    if re.search(r'/Volumes[/]|/Users/(?!alice/|bob/|name/)[^/]+/(?:Documents|Desktop)/', text):
        problems.append((name, 'private workstation path'))
    if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', text):
        problems.append((name, 'private key'))
    for match in re.finditer(r'(?:github_pat_|ghp_)[A-Za-z0-9_]{20,}', text):
        # Exact synthetic secret-rejection fixture, reviewed for this test.
        if name == 'server/modules/growth/tests/test_growth.py' and match[0] == 'ghp_' + 'abcdefghijklmnopqrstuvwxyz0123456789':
            continue
        problems.append((name, 'possible access token'))
if problems:
    for name, reason in problems:
        print(name + ': ' + reason)
    sys.exit(1)
print(f'Publication check passed: {len(names)} files; allowlist, paths, data and token patterns checked.')
