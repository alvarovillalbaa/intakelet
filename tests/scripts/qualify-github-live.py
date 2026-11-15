"""Owned actual public-GET acceptance. Never retain public issue text/tokens."""
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import time
import urllib.request
import uuid

repo = Path(__file__).resolve().parents[2]
output = Path(os.environ['INTAKELET_GITHUB_ARTIFACT'])
output.mkdir(exist_ok=False)
receipt = {'passed': False, 'commands': [], 'cleanup': False}
scratch = None
sha = lambda value: hashlib.sha256(value).hexdigest()
names = ['tests/integration/github-public-live.mjs', 'tests/scripts/qualify-github-live.py', 'docs/results/2026/11-15/github-public-live/protocol-v1.md']
def vector(root):
    return [{'path': name, 'bytes': (root / name).stat().st_size, 'sha256': sha((root / name).read_bytes())} for name in names]
before = vector(repo)
(output / 'source-before.json').write_text(json.dumps(before, indent=2))
(output / 'source.json').write_text(json.dumps({'sha': os.environ['GITHUB_SHA'], 'paths': names}, indent=2))
deadline = time.monotonic() + 140
def execute(name, argv, timeout, cwd):
    timeout = min(timeout, int(deadline - time.monotonic() - 15))
    if timeout < 1:
        raise RuntimeError('Live acceptance deadline before ' + name)
    start = time.monotonic()
    process = subprocess.Popen(argv, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(process.pid, signal.SIGTERM)
        try:
            stdout, stderr = process.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate(timeout=5)
    absent = False
    for _ in range(30):
        try:
            os.killpg(process.pid, 0)
            time.sleep(0.1)
        except ProcessLookupError:
            absent = True
            break
    for suffix, value in [('stdout', stdout), ('stderr', stderr)]:
        (output / (name + '.' + suffix + '.txt')).write_bytes(value)
    item = {'name': name, 'argv': argv, 'code': process.returncode, 'timedOut': timed_out, 'leaderReaped': process.poll() is not None, 'groupAbsent': absent, 'seconds': time.monotonic() - start, 'stdoutBytes': len(stdout), 'stdoutSha256': sha(stdout), 'stderrBytes': len(stderr), 'stderrSha256': sha(stderr)}
    receipt['commands'].append(item)
    print(json.dumps(item), flush=True)
    if process.returncode or timed_out or not absent:
        raise RuntimeError(name + ' did not close successfully')
try:
    free = shutil.disk_usage(tempfile.gettempdir()).free
    receipt['storage'] = {'freeBytes': free, 'requiredBytes': 34 * 1024**3, 'passed': free >= 34 * 1024**3}
    if not receipt['storage']['passed']:
        raise RuntimeError('Runner Storage Guard refused installation')
    scratch = Path(tempfile.mkdtemp(prefix='intakelet-github-live-'))
    nonce = uuid.uuid4().hex
    (scratch / 'owner').write_text(nonce)
    inode = scratch.stat().st_ino
    source = scratch / 'source'
    source.mkdir()
    for name in names:
        target = source / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(repo / name, target)
    (scratch / 'tmp').mkdir()
    # A new environment, not a copy of CI's credential-bearing environment.
    (scratch / 'empty.npmrc').write_text('')
    env = {'PATH': os.environ['PATH'], 'TMPDIR': str(scratch / 'tmp'), 'npm_config_cache': str(scratch / 'npm-cache'), 'npm_config_userconfig': str(scratch / 'empty.npmrc'), 'npm_config_globalconfig': '/dev/null'}
    execute('node-version', ['node', '--version'], 10, scratch)
    url = 'https://github.com/alvarovillalbaa/intakelet/releases/download/v0.3.0/alvarovillalbaa-intakelet-0.3.0.tgz'
    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Intakelet-owned-public-acceptance'}), timeout=20) as response:
        content = response.read(97206)
        if response.status != 200 or len(content) != 97205 or sha(content) != '76cd7c273fad245bf508241c69827f2b5232b925e87dd235aa90d1bffc7bba84':
            raise RuntimeError('Anonymous published archive differs')
        receipt['archive'] = {'url': url, 'status': 200, 'bytes': len(content), 'sha256': sha(content)}
    archive = scratch / 'intakelet.tgz'
    archive.write_bytes(content)
    consumer = scratch / 'consumer'
    consumer.mkdir()
    (consumer / 'package.json').write_text('{"name":"intakelet-public-live-consumer","version":"0.0.0","private":true,"type":"module"}')
    execute('installed-published-archive', ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', str(archive)], 45, consumer)
    shutil.copyfile(consumer / 'package-lock.json', output / 'installed-lock.json')
    (output / 'live').mkdir()
    env.update(INTAKELET_LIVE_CONSUMER=str(consumer), INTAKELET_LIVE_OUTPUT=str(output / 'live'))
    execute('actual-public-api', ['node', str(source / 'tests/integration/github-public-live.mjs')], 85, consumer)
    accepted = json.loads((output / 'live/live-receipt.json').read_text())
    if not accepted['passed'] or len(accepted['requests']) > 12 or any(item['method'] != 'GET' or item['authenticated'] for item in accepted['requests']):
        raise RuntimeError('Actual public source acceptance is incomplete')
    receipt['passed'] = True
except Exception as error:
    receipt['error'] = str(error)
finally:
    after = vector(repo)
    (output / 'source-after.json').write_text(json.dumps(after, indent=2))
    receipt['sourceUnchanged'] = before == after
    if scratch and (scratch / 'source').is_dir():
        copied = vector(source)
        (output / 'copied-source-after.json').write_text(json.dumps(copied, indent=2))
        receipt['sourceGuardPassed'] = before == after == copied
        if scratch.stat().st_ino == inode and (scratch / 'owner').read_text() == nonce and all(command['groupAbsent'] for command in receipt['commands']):
            shutil.rmtree(scratch)
            receipt['cleanup'] = not scratch.exists()
    receipt['passed'] = receipt['passed'] and receipt.get('sourceGuardPassed', False) and receipt['cleanup']
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2))
    print('INTAKELET_GITHUB_RECEIPT ' + json.dumps(receipt), flush=True)
    for path in sorted(output.rglob('*')):
        if not path.is_file():
            continue
        value = path.read_bytes()
        if len(value) > 1024**2:
            raise RuntimeError('Unexpected evidence size')
        data = base64.b64encode(gzip.compress(value, mtime=0)).decode()
        parts = [data[index:index + 16000] for index in range(0, len(data), 16000)]
        name = path.relative_to(output).as_posix()
        print('INTAKELET_GITHUB_FILE ' + json.dumps({'path': name, 'bytes': len(value), 'sha256': sha(value), 'chunks': len(parts)}), flush=True)
        for index, part in enumerate(parts):
            print('INTAKELET_GITHUB_CHUNK ' + json.dumps({'path': name, 'index': index, 'data': part}), flush=True)
if not receipt['passed']:
    raise SystemExit(1)
