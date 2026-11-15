"""T2 0.2.0 remote qualification; exact inputs, complete streams, owned teardown."""
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tarfile
import tempfile
import time
import uuid

repo = Path(__file__).resolve().parents[2]
output = Path(os.environ["INTAKELET_OUTPUT"])
output.mkdir(exist_ok=False)
receipt = {"passed": False, "cleanup": False, "commands": [], "phase": os.environ.get("INTAKELET_PHASE", "package-native")}
scratch = None
deadline = time.monotonic() + 17 * 60
digest = lambda value: hashlib.sha256(value).hexdigest()
roots = ["src", "bin", "scripts", "web", "examples", "tests", "docs/specs", "docs/references", "package.json", "package-lock.json", "README.md", "LICENSE", "vercel.json"]
names = subprocess.check_output(["git", "ls-files", "-z", "--", *roots], cwd=repo).split(b"\0")
paths = sorted(os.fsdecode(name) for name in names if name)
def vector(root):
    return [{"path": name, "bytes": (root / name).stat().st_size, "sha256": digest((root / name).read_bytes())} for name in paths]
before = vector(repo)
(output / "source-before.json").write_text(json.dumps(before, indent=2))
(output / "source.json").write_text(json.dumps({"sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo).decode().strip(), "paths": paths}, indent=2))

def execute(name, args, timeout, cwd=None):
    remaining = int(deadline - time.monotonic() - 30)
    if remaining <= 0:
        raise RuntimeError("Internal deadline reached before " + name)
    started = time.monotonic()
    process = subprocess.Popen(args, cwd=cwd or work, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=min(timeout, remaining))
    except subprocess.TimeoutExpired:
        timed_out = True
        os.killpg(process.pid, signal.SIGTERM)
        try:
            stdout, stderr = process.communicate(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            stdout, stderr = process.communicate(timeout=10)
    absent = False
    for _ in range(30):
        try:
            os.killpg(process.pid, 0)
            time.sleep(0.1)
        except ProcessLookupError:
            absent = True
            break
    for suffix, value in [("stdout", stdout), ("stderr", stderr)]:
        (output / (name + "." + suffix + ".txt")).write_bytes(value)
    row = {"name": name, "argv": args, "exit": process.returncode, "timedOut": timed_out, "leaderReaped": process.poll() is not None, "groupAbsent": absent, "seconds": time.monotonic() - started, "stdoutBytes": len(stdout), "stderrBytes": len(stderr), "stdoutSha256": digest(stdout), "stderrSha256": digest(stderr)}
    receipt["commands"].append(row)
    print(json.dumps(row), flush=True)
    if process.returncode or timed_out or not absent:
        raise RuntimeError(name + " did not close successfully")

try:
    usage = shutil.disk_usage(tempfile.gettempdir())
    receipt["storage"] = {"freeBytes": usage.free, "requiredBytes": 34 * 1024**3, "passed": usage.free >= 34 * 1024**3}
    if not receipt["storage"]["passed"]:
        raise RuntimeError("Runner storage preflight refused installation")
    scratch = Path(tempfile.mkdtemp(prefix="intakelet-v2-"))
    nonce = uuid.uuid4().hex
    (scratch / "owner").write_text(nonce)
    inode = scratch.stat().st_ino
    work = scratch / "source"
    work.mkdir()
    (scratch / "tmp").mkdir()
    env = dict(os.environ, npm_config_cache=str(scratch / "npm-cache"), PLAYWRIGHT_BROWSERS_PATH=str(scratch / "browsers"), TMPDIR=str(scratch / "tmp"))
    # Child consumers never receive workflow credentials.
    for key in ["GH_TOKEN", "GITHUB_TOKEN", "INTAKELET_RETIRE_TOKEN"]:
        env.pop(key, None)
    for name in paths:
        path = work / name
        path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(repo / name, path)
    execute("node-version", ["node", "--version"], 10)
    execute("npm-version", ["npm", "--version"], 10)
    old_lock = json.loads((work / "package-lock.json").read_text())
    execute("lock-metadata", ["npm", "install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"], 90)
    lock = json.loads((work / "package-lock.json").read_text())
    comparable = json.loads(json.dumps(lock))
    comparable["version"] = old_lock["version"]
    comparable["packages"][""]["version"] = old_lock["packages"][""]["version"]
    if comparable != old_lock or lock["version"] != "0.2.0" or lock["packages"][""]["version"] != "0.2.0":
        raise RuntimeError("Lock changed beyond the two package version fields")
    shutil.copyfile(work / "package-lock.json", output / "package-lock.json")
    receipt["dependencyIdentitiesUnchanged"] = True
    execute("dependencies", ["npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund"], 180)
    execute("syntax", ["node", "scripts/check.mjs"], 60)
    if receipt["phase"] == "package-native":
        units = ["output-schema", "migration", "file-migration", "github-migration", "migration-elements", "migration-react", "migration-demo", "onboarding", "onboarding-elements", "onboarding-react"]
        execute("new-unit-contracts", ["node", "--test", *["tests/unit/" + name + ".test.mjs" for name in units]], 90)
    execute("build", ["npm", "run", "build"], 90)
    shutil.copyfile(work / "dist/build.json", output / "build.json")
    execute("pack", ["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", str(output)], 30)
    archives = list(output.glob("*.tgz"))
    if len(archives) != 1:
        raise RuntimeError("Expected exactly one candidate archive")
    tarball = archives[0]
    members = []
    with tarfile.open(tarball) as archive:
        for member in archive.getmembers():
            name = member.name.removeprefix("package/")
            if not member.isfile() or not member.name.startswith("package/") or ".." in Path(name).parts or (name not in ["package.json", "README.md", "LICENSE"] and not name.startswith(("src/", "bin/", "examples/", "docs/specs/", "docs/references/"))):
                raise RuntimeError("Unexpected archive member")
            content = archive.extractfile(member).read()
            if content != (work / name).read_bytes() or bool(member.mode & 0o111) != bool((work / name).stat().st_mode & 0o111):
                raise RuntimeError("Archive bytes/mode differ: " + name)
            members.append({"path": name, "bytes": len(content), "sha256": digest(content), "mode": member.mode})
    (output / "package-manifest.json").write_text(json.dumps({"file": tarball.name, "bytes": tarball.stat().st_size, "sha256": digest(tarball.read_bytes()), "members": members}, indent=2))
    if receipt["phase"] == "final-native":
        baseline_path = repo / "docs/results/2026/11-15/qualification-v2/run-1/package-manifest.json"
        baseline_bytes = baseline_path.read_bytes()
        baseline = json.loads(baseline_bytes)
        old = {item["path"]: item for item in baseline["members"]}
        actual = {item["path"]: item for item in members}
        if set(old) != set(actual):
            raise RuntimeError("Final documentation edition changed archive membership")
        changed = sorted(name for name in old if old[name] != actual[name])
        allowed = {"README.md", "docs/references/onboarding-components.md", "docs/references/migration-integration.md"}
        if not set(changed).issubset(allowed):
            raise RuntimeError("Final archive changed qualified runtime bytes/modes")
        comparison = {"baselineManifestSha256": digest(baseline_bytes), "baselineArchiveSha256": baseline["sha256"], "changedMembers": changed, "unchangedMembers": len(old) - len(changed), "allRuntimeBytesAndModesEqual": True}
        (output / "archive-comparison.json").write_text(json.dumps(comparison, indent=2))
        receipt["archiveRuntimePreserved"] = True
    def consumer(name, fixture=None):
        target = scratch / name
        target.mkdir()
        (target / "package.json").write_text((work / fixture).read_text() if fixture else json.dumps({"name": "intakelet-" + name, "version": "0.0.0", "private": True, "type": "module"}))
        return target
    if receipt["phase"] == "package-native":
        online = consumer("online")
        execute("online-install", ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", str(tarball)], 90, online)
        installed = consumer("offline")
        execute("offline-install", ["npm", "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", str(tarball)], 90, installed)
        shutil.copyfile(installed / "package-lock.json", output / "installed-lock.json")
        (scratch / "consumer-tmp").mkdir()
        env.update(INTAKELET_CONSUMER_ROOT=str(installed), INTAKELET_CONSUMER_TMP=str(scratch / "consumer-tmp"))
        execute("installed-migration", ["node", "tests/integration/migration-installed.test.mjs"], 60)
        execute("installed-regression", ["node", "--test", "--test-name-pattern", "^(M01|M04|M06) ", "tests/integration/consumer.test.mjs"], 90)
    for edition in ["react18", "react19"]:
        target = consumer(edition, "tests/fixtures/" + edition + "/package.json")
        execute(edition + "-install", ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", str(tarball)], 150, target)
        shutil.copyfile(target / "package-lock.json", output / (edition + "-lock.json"))
        shutil.copyfile(work / "tests/fixtures/v2-entry.mjs", target / "browser-entry.mjs")
        if receipt["phase"] == "package-native":
            fixtures = ["typed-consumer.tsx", "onboarding-types.mts", "migration-types.mts", "migration-ui-types.mts"]
            for name in fixtures:
                text = (work / "tests/fixtures" / name).read_text().replace("'../../src/index.mjs'", "'@alvarovillalbaa/intakelet'").replace("'../../src/onboarding-elements.mjs'", "'@alvarovillalbaa/intakelet/onboarding'").replace("'../../src/react.mjs'", "'@alvarovillalbaa/intakelet/react'")
                (target / name).write_text(text)
            config = {"compilerOptions": {"target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "jsx": "react-jsx", "strict": True, "noEmit": True, "skipLibCheck": False, "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["node", "react", "react-dom"]}, "include": fixtures}
            (target / "tsconfig.json").write_text(json.dumps(config))
            execute(edition + "-types", ["node", str(target / "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], 60, target)
            shutil.copyfile(work / "tests/fixtures/v2-ssr.mjs", target / "ssr.mjs")
            execute(edition + "-ssr", ["node", "ssr.mjs"], 30, target)
            if edition == "react19":
                for name in ["node-consumer.mts", "v2-node-consumer.mts"]:
                    shutil.copyfile(work / "tests/fixtures" / name, target / name)
                config["compilerOptions"].update(lib=["ES2022"], types=["node"])
                config["include"] = ["node-consumer.mts", "v2-node-consumer.mts"]
                (target / "node-tsconfig.json").write_text(json.dumps(config))
                execute("node-only-types", ["node", str(target / "node_modules/typescript/bin/tsc"), "-p", "node-tsconfig.json"], 60, target)
    env["INTAKELET_BROWSER_FIXTURES"] = str(scratch)
    tools = consumer("browser-tools", "tests/fixtures/browser/package.json")
    env["INTAKELET_BROWSER_TOOLS"] = str(tools)
    execute("browser-dependencies", ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund"], 120, tools)
    shutil.copyfile(tools / "package-lock.json", output / "browser-lock.json")
    execute("browser-install", ["node", str(tools / "node_modules/playwright/cli.js"), "install", "--with-deps", "chromium"], 240)
    execute("consumer-bundles", ["node", "tests/scripts/build-consumers.mjs"], 60)
    env["INTAKELET_NATIVE_OUTPUT"] = str(output / "native")
    execute("native", ["node", "tests/e2e/onboarding-migration.mjs"], 240)
    receipt["passed"] = True
except Exception as error:
    receipt["error"] = repr(error)
finally:
    after = vector(repo)
    (output / "source-after.json").write_text(json.dumps(after, indent=2))
    receipt["sourceUnchanged"] = before == after
    if scratch:
        copied = vector(work)
        (output / "copied-source-after.json").write_text(json.dumps(copied, indent=2))
        changed = [row["path"] for row, original in zip(copied, before) if row != original]
        receipt["exportChangedPaths"] = changed
        receipt["sourceGuardPassed"] = before == after and all(name == "package-lock.json" for name in changed) and receipt.get("dependencyIdentitiesUnchanged", False)
        receipt["scratchBytes"] = sum(path.stat().st_size for path in scratch.rglob("*") if path.is_file() and not path.is_symlink())
        if scratch.stat().st_ino == inode and (scratch / "owner").read_text() == nonce and all(row["groupAbsent"] for row in receipt["commands"]):
            shutil.rmtree(scratch)
            receipt["cleanup"] = not scratch.exists()
    receipt["passed"] = receipt["passed"] and receipt.get("sourceGuardPassed", False) and receipt["cleanup"]
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt), flush=True)
    # Bounded byte-exact evidence survives even when the artifact download API
    # cannot return binary archives. Never print environment or credentials.
    for path in sorted(output.rglob("*")):
        if not path.is_file():
            continue
        value = path.read_bytes()
        if len(value) > 8 * 1024**2:
            raise RuntimeError("Evidence file exceeds the reviewed budget")
        packed = base64.b64encode(gzip.compress(value, mtime=0)).decode()
        parts = [packed[index:index + 16000] for index in range(0, len(packed), 16000)]
        metadata = {"path": path.relative_to(output).as_posix(), "bytes": len(value), "sha256": digest(value), "chunks": len(parts)}
        print("INTAKELET_V2_FILE " + json.dumps(metadata), flush=True)
        for index, part in enumerate(parts):
            print("INTAKELET_V2_CHUNK " + json.dumps({"path": metadata["path"], "index": index, "data": part}), flush=True)
if not receipt["passed"]:
    raise SystemExit(1)
