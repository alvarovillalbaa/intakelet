"""T2 document qualification in owned remote scratch; no host/customer data."""
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
import uuid
import tarfile

repo = Path(__file__).resolve().parents[2]
output = Path(os.environ['INTAKELET_DOCUMENT_ARTIFACT'])
output.mkdir(exist_ok=False)
phase = os.environ.get('INTAKELET_DOCUMENT_PHASE', 'qualify')
deadline = time.monotonic() + int(os.environ['INTAKELET_DOCUMENT_SECONDS']) - 20
receipt = {'phase': phase, 'passed': False, 'commands': [], 'cleanup': False}
scratch = None
sha = lambda value: hashlib.sha256(value).hexdigest()
roots = ['src', 'tests', 'bin', 'scripts', 'web', 'examples', 'docs/specs', 'docs/references', 'README.md', 'LICENSE', 'package.json', 'package-lock.json', 'vercel.json']
names = sorted(os.fsdecode(name) for name in subprocess.check_output(['git', 'ls-files', '-z', '--', *roots], cwd=repo).split(b'\0') if name)
def vector(root):
    return [{'path': name, 'bytes': (root / name).stat().st_size, 'sha256': sha((root / name).read_bytes())} for name in names]
before = vector(repo)
(output / 'source-before.json').write_text(json.dumps(before, indent=2))
(output / 'source.json').write_text(json.dumps({'sha': os.environ['GITHUB_SHA'], 'paths': names}, indent=2))
def execute(name, argv, seconds, cwd=None):
    allowed = min(seconds, int(deadline - time.monotonic() - 15))
    if allowed < 1:
        raise RuntimeError('Qualification deadline before ' + name)
    start = time.monotonic()
    process = subprocess.Popen(argv, cwd=cwd or work, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=allowed)
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
    scratch = Path(tempfile.mkdtemp(prefix='intakelet-documents-'))
    nonce = uuid.uuid4().hex
    (scratch / 'owner').write_text(nonce)
    inode = scratch.stat().st_ino
    work = scratch / 'source'
    work.mkdir()
    (scratch / 'tmp').mkdir()
    env = dict(os.environ, TMPDIR=str(scratch / 'tmp'), npm_config_cache=str(scratch / 'npm-cache'), PLAYWRIGHT_BROWSERS_PATH=str(scratch / 'browsers'))
    for key in ['GH_TOKEN', 'GITHUB_TOKEN', 'INTAKELET_RETIRE_TOKEN', 'INTAKELET_PUBLISH_TOKEN']:
        env.pop(key, None)
    for name in names:
        path = work / name
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(repo / name, path)
    execute('node-version', ['node', '--version'], 10)
    if phase == 'lock':
        execute('generate-lock', ['npm', 'install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], 110)
        generated = (work / 'package-lock.json').read_bytes()
        shutil.copyfile(work / 'package-lock.json', output / 'package-lock.json')
        receipt['generatedLockSha256'] = sha(generated)
    elif phase in ['qualify', 'hosted']:
        execute('dependencies', ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], 150)
        execute('runtime-dependency-audit', ['npm', 'audit', '--omit=dev', '--audit-level=high', '--json'], 30)
        execute('syntax', ['node', 'scripts/check.mjs'], 30)
        if phase == 'qualify':
            execute('document-guards', ['node', '--test', 'tests/unit/document-node.test.mjs'], 30)
        execute('pack', ['npm', 'pack', '--json', '--ignore-scripts', '--pack-destination', str(output)], 30)
        archives = list(output.glob('*.tgz'))
        if len(archives) != 1:
            raise RuntimeError('Expected one archive')
        archive = archives[0]
        members = []
        with tarfile.open(archive) as tar:
            for member in tar.getmembers():
                name = member.name.removeprefix('package/')
                if not member.isfile() or not member.name.startswith('package/') or '..' in Path(name).parts or (name not in ['package.json', 'README.md', 'LICENSE'] and not name.startswith(('src/', 'bin/', 'examples/', 'docs/specs/', 'docs/references/'))):
                    raise RuntimeError('Unexpected archive member')
                data = tar.extractfile(member).read()
                if data != (work / name).read_bytes() or bool(member.mode & 0o111) != bool((work / name).stat().st_mode & 0o111):
                    raise RuntimeError('Archive source differs: ' + name)
                members.append({'path': name, 'bytes': len(data), 'sha256': sha(data), 'mode': member.mode})
        (output / 'package-manifest.json').write_text(json.dumps({'file': archive.name, 'bytes': archive.stat().st_size, 'sha256': sha(archive.read_bytes()), 'members': members}, indent=2))
        if phase == 'hosted' and sha(archive.read_bytes()) != os.environ['INTAKELET_DOCUMENT_ARCHIVE_SHA256']:
            raise RuntimeError('Hosted source changed the qualified archive')
        if phase == 'qualify':
            online = scratch / 'online'
            online.mkdir()
            (online / 'package.json').write_text('{"name":"intakelet-document-online","version":"0.0.0","private":true,"type":"module"}')
            execute('online-installed-archive', ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund', str(archive)], 60, online)
            shutil.copyfile(online / 'package-lock.json', output / 'online-lock.json')
            consumer = scratch / 'consumer'
            consumer.mkdir()
            (consumer / 'package.json').write_text('{"name":"intakelet-document-consumer","version":"0.0.0","private":true,"type":"module"}')
            execute('installed-archive', ['npm', 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', str(archive)], 60, consumer)
            shutil.copyfile(consumer / 'package-lock.json', output / 'installed-lock.json')
            env.update(INTAKELET_DOCUMENT_CONSUMER=str(consumer), INTAKELET_DOCUMENT_OUTPUT=str(output / 'installed'))
            (output / 'installed').mkdir()
            locate = "import{createRequire}from'node:module';import{readdir,stat}from'node:fs/promises';import{dirname,join}from'node:path';const r=createRequire(import.meta.url),root=dirname(r.resolve('@tesseract.js-data/eng/package.json'));async function walk(p){for(const n of await readdir(p)){const f=join(p,n),s=await stat(f);if(s.isDirectory()){const found=await walk(f);if(found)return found;}else if(n==='eng.traineddata.gz')return f;}}console.log(await walk(root));"
            execute('locate-local-ocr-data', ['node', '--input-type=module', '-e', locate], 10)
            language_path = (output / 'locate-local-ocr-data.stdout.txt').read_text().strip()
            candidate = Path(language_path)
            if not candidate.is_file() or not candidate.is_relative_to(work / 'node_modules/@tesseract.js-data/eng'):
                raise RuntimeError('Unexpected local OCR model path')
            env['INTAKELET_OCR_FILE'] = str(candidate)
            execute('actual-installed-documents', ['node', '--test', 'tests/integration/documents-installed.test.mjs'], 180)
            shutil.copyfile(work / 'tests/fixtures/documents-types.mts', consumer / 'documents-types.mts')
            execute('installed-node-types', [str(work / 'node_modules/.bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--lib', 'ES2022', '--types', 'node', '--typeRoots', str(work / 'node_modules/@types'), 'documents-types.mts'], 30, consumer)
        execute('build', ['npm', 'run', 'build'], 60)
        shutil.copyfile(work / 'dist/build.json', output / 'build.json')
        browser = scratch / 'browser'
        browser.mkdir()
        shutil.copyfile(work / 'tests/fixtures/browser/package.json', browser / 'package.json')
        execute('browser-dependencies', ['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'], 60, browser)
        shutil.copyfile(browser / 'package-lock.json', output / 'browser-lock.json')
        execute('browser-install', ['node', str(browser / 'node_modules/playwright/cli.js'), 'install', '--with-deps', 'chromium'], 150)
        env.update(INTAKELET_PLAYWRIGHT=str(browser / 'node_modules/playwright/index.mjs'), INTAKELET_GUIDE_OUTPUT=str(output / 'guide'))
        execute('document-guide-native', ['node', 'tests/e2e/document-guide.mjs'], 90)

    else:
        raise RuntimeError('Unknown phase')
    receipt['passed'] = True
except Exception as error:
    receipt['error'] = repr(error)
finally:
    after = vector(repo)
    (output / 'source-after.json').write_text(json.dumps(after, indent=2))
    receipt['sourceUnchanged'] = before == after
    if scratch and (scratch / 'source').is_dir():
        copied = vector(work)
        (output / 'copied-source-after.json').write_text(json.dumps(copied, indent=2))
        changed = [item['path'] for item, old in zip(copied, before) if item != old]
        receipt['intentionalGeneratedChanges'] = changed if phase == 'lock' else []
        receipt['sourceGuardPassed'] = before == after and (not changed or phase == 'lock' and changed == ['package-lock.json'] and sha((work / 'package-lock.json').read_bytes()) == receipt.get('generatedLockSha256'))
        if scratch.stat().st_ino == inode and (scratch / 'owner').read_text() == nonce and all(command['groupAbsent'] for command in receipt['commands']):
            shutil.rmtree(scratch)
            receipt['cleanup'] = not scratch.exists()
    receipt['passed'] = receipt['passed'] and receipt.get('sourceGuardPassed', False) and receipt['cleanup']
    (output / 'receipt.json').write_text(json.dumps(receipt, indent=2))
    print('INTAKELET_DOCUMENT_RECEIPT ' + json.dumps(receipt), flush=True)
    for path in sorted(output.rglob('*')):
        if not path.is_file():
            continue
        value = path.read_bytes()
        if len(value) > 2 * 1024**2:
            raise RuntimeError('Oversized evidence; never retain OCR weights/dependencies')
        data = base64.b64encode(gzip.compress(value, mtime=0)).decode()
        parts = [data[index:index + 16000] for index in range(0, len(data), 16000)]
        name = path.relative_to(output).as_posix()
        print('INTAKELET_DOCUMENT_FILE ' + json.dumps({'path': name, 'bytes': len(value), 'sha256': sha(value), 'chunks': len(parts)}), flush=True)
        for index, part in enumerate(parts):
            print('INTAKELET_DOCUMENT_CHUNK ' + json.dumps({'path': name, 'index': index, 'data': part}), flush=True)
if not receipt['passed']:
    raise SystemExit(1)
