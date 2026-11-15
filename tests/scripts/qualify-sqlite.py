"""Owned remote SQLite acceptance. No customer DB, provider or credential copy."""
import base64, gzip, hashlib, json, os, shutil, signal, subprocess, tempfile, time, tarfile, uuid
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
output = Path(os.environ['INTAKELET_SQLITE_ARTIFACT'])
output.mkdir(exist_ok=False)
phase = os.environ.get('INTAKELET_SQLITE_PHASE', 'qualify')
receipt = {'phase': phase, 'passed': False, 'commands': [], 'cleanup': False}
scratch = None
sha = lambda value: hashlib.sha256(value).hexdigest()
roots = ['src', 'bin', 'scripts', 'examples', 'docs/specs', 'docs/references', 'README.md', 'LICENSE', 'package.json', 'package-lock.json', 'tests/integration/sqlite-installed.test.mjs', 'tests/fixtures/sqlite-contract.mjs', 'tests/fixtures/sqlite-host-child.mjs', 'tests/fixtures/sqlite-node-consumer.mts', 'tests/scripts/qualify-sqlite.py']
names = sorted(os.fsdecode(name) for name in subprocess.check_output(['git', 'ls-files', '-z', '--', *roots], cwd=repo).split(b'\0') if name)
def vector(root):
    return [{'path': name, 'bytes': (root / name).stat().st_size, 'sha256': sha((root / name).read_bytes())} for name in names]
before = vector(repo)
(output / 'source-before.json').write_text(json.dumps(before, indent=2))
(output / 'source.json').write_text(json.dumps({'sha': os.environ['GITHUB_SHA'], 'paths': names}, indent=2))
deadline = time.monotonic() + 140
def execute(name, argv, timeout, cwd):
    timeout = min(timeout, int(deadline - time.monotonic() - 15))
    if timeout < 1:
        raise RuntimeError('SQLite deadline before ' + name)
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
    scratch = Path(tempfile.mkdtemp(prefix='intakelet-sqlite-'))
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
    (scratch / 'empty.npmrc').write_text('')
    env = {'PATH': os.environ['PATH'], 'TMPDIR': str(scratch / 'tmp'), 'npm_config_cache': str(scratch / 'npm-cache'), 'npm_config_userconfig': str(scratch / 'empty.npmrc'), 'npm_config_globalconfig': '/dev/null'}
    execute('node-version', ['node', '--version'], 10, scratch)
    execute('schema-generation-check', ['node', 'scripts/generate-sqlite-schema.mjs', '--check'], 10, source)
    if phase == 'lock':
        execute('generate-lock', ['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], 90, source)
        value = (source / 'package-lock.json').read_bytes()
        (output / 'package-lock.json').write_bytes(value)
        receipt['generatedLockSha256'] = sha(value)
    elif phase == 'qualify':
        execute('dependencies', ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], 60, source)
        execute('syntax', ['node', 'scripts/check.mjs'], 20, source)
        execute('pack-candidate', ['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', str(output)], 15, source)
        archives = list(output.glob('*.tgz'))
        if len(archives) != 1:
            raise RuntimeError('Expected one candidate archive')
        archive = archives[0]
        members = []
        with tarfile.open(archive) as tar:
            for member in tar.getmembers():
                name = member.name.removeprefix('package/')
                if not member.isfile() or not member.name.startswith('package/') or '..' in Path(name).parts or (name not in ['package.json', 'README.md', 'LICENSE'] and not name.startswith(('src/', 'bin/', 'examples/', 'docs/specs/', 'docs/references/'))):
                    raise RuntimeError('Unexpected archive member')
                data = tar.extractfile(member).read()
                if data != (source / name).read_bytes() or bool(member.mode & 0o111) != bool((source / name).stat().st_mode & 0o111):
                    raise RuntimeError('Candidate archive source/mode differs')
                members.append({'path': name, 'bytes': len(data), 'sha256': sha(data), 'mode': member.mode})
        value = archive.read_bytes()
        receipt['archive'] = {'file': archive.name, 'bytes': len(value), 'sha256': sha(value)}
        (output / 'package-manifest.json').write_text(json.dumps({**receipt['archive'], 'members': members}, indent=2))
        consumer = scratch / 'consumer'
        consumer.mkdir()
        (consumer / 'package.json').write_text('{"name":"intakelet-sqlite-consumer","version":"0.0.0","private":true,"type":"module"}')
        execute('installed-candidate-archive', ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', str(archive)], 45, consumer)
        shutil.copyfile(consumer / 'package-lock.json', output / 'installed-lock.json')
        (scratch / 'databases').mkdir()
        (output / 'installed').mkdir()
        env.update(INTAKELET_SQLITE_CONSUMER=str(consumer), INTAKELET_SQLITE_WORK=str(scratch / 'databases'), INTAKELET_SQLITE_OUTPUT=str(output / 'installed'))
        execute('actual-installed-sqlite', ['node', '--test', '--test-reporter=tap', 'tests/integration/sqlite-installed.test.mjs'], 55, source)
        report = (output / 'actual-installed-sqlite.stdout.txt').read_text()
        if '# tests 11\n' not in report or '# pass 11\n' not in report or '# fail 0\n' not in report:
            raise RuntimeError('All eleven SQLite identities must pass')
        cleanup = json.loads((output / 'installed/process-cleanup.json').read_text())['observations']
        if sum('case' in row and row.get('closed') and row.get('removed') for row in cleanup) != 11 or any('child' in row and (row['signal'] != 'SIGKILL' if row['expectedKill'] else row['code'] != 0 or row['signal'] is not None) for row in cleanup):
            raise RuntimeError('SQLite process/owned-database cleanup is incomplete')
        shutil.copyfile(source / 'tests/fixtures/sqlite-node-consumer.mts', consumer / 'sqlite-node-consumer.mts')
        execute('installed-node-types', [str(source / 'node_modules/.bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022', '--types', 'node', '--typeRoots', str(source / 'node_modules/@types'), 'sqlite-node-consumer.mts'], 20, consumer)
    else:
        raise RuntimeError('Unknown SQLite phase')
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
        changed = [new['path'] for old, new in zip(before, copied) if old != new]
        receipt['intentionalGeneratedChanges'] = changed if phase == 'lock' else []
        receipt['sourceGuardPassed'] = before == after and (not changed or phase == 'lock' and changed == ['package-lock.json'] and sha((source / 'package-lock.json').read_bytes()) == receipt.get('generatedLockSha256'))
        if scratch.stat().st_ino == inode and (scratch / 'owner').read_text() == nonce and all(command['groupAbsent'] for command in receipt['commands']):
            shutil.rmtree(scratch)
            receipt['cleanup'] = not scratch.exists()
    receipt['passed'] = receipt['passed'] and receipt.get('sourceGuardPassed', False) and receipt['cleanup']
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2))
    print('INTAKELET_SQLITE_RECEIPT ' + json.dumps(receipt), flush=True)
    for path in sorted(output.rglob('*')):
        if not path.is_file():
            continue
        value = path.read_bytes()
        if len(value) > 1024**2:
            raise RuntimeError('Unexpected evidence size; never publish database files')
        data = base64.b64encode(gzip.compress(value, mtime=0)).decode()
        parts = [data[index:index + 16000] for index in range(0, len(data), 16000)]
        name = path.relative_to(output).as_posix()
        print('INTAKELET_SQLITE_FILE ' + json.dumps({'path': name, 'bytes': len(value), 'sha256': sha(value), 'chunks': len(parts)}), flush=True)
        for index, part in enumerate(parts):
            print('INTAKELET_SQLITE_CHUNK ' + json.dumps({'path': name, 'index': index, 'data': part}), flush=True)
if not receipt['passed']:
    raise SystemExit(1)
