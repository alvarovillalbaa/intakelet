"""T2 remote-only qualification. Complete streams, exact source and teardown."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import tempfile
import tarfile
import time
import uuid

repo = Path(__file__).resolve().parents[2]
output = Path(os.environ["INTAKELET_OUTPUT"])
output.mkdir(exist_ok=False)
scratch = Path(tempfile.mkdtemp(prefix="intakelet-qualification-"))
nonce = uuid.uuid4().hex
(scratch / "owner").write_text(nonce)
identity = scratch.stat().st_ino
work = scratch / "source"
work.mkdir()
(scratch / "tmp").mkdir()
env = dict(os.environ, npm_config_cache=str(scratch / "npm-cache"),
           PLAYWRIGHT_BROWSERS_PATH=str(scratch / "browsers"), TMPDIR=str(scratch / "tmp"))
receipt = {"mode": os.environ["INTAKELET_MODE"], "commands": [], "passed": False, "cleanup": False}
deadline = time.monotonic() + 17 * 60

def vector(root):
    names = subprocess.check_output(["git", "ls-files", "-z"], cwd=repo).split(b"\0")
    return [{"path": os.fsdecode(name), "bytes": (root / os.fsdecode(name)).stat().st_size,
             "sha256": hashlib.sha256((root / os.fsdecode(name)).read_bytes()).hexdigest()}
            for name in names if name]

before = vector(repo)
(output / "source-before.json").write_text(json.dumps(before, indent=2))
(output / "source.json").write_text(json.dumps({"sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo).decode().strip()}))
for item in before:
    destination = work / item["path"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(repo / item["path"], destination)

def execute(name, args, timeout, cwd=None):
    remaining = int(deadline - time.monotonic() - 30)
    if remaining < 1:
        raise RuntimeError("Owned qualification deadline reached before " + name)
    timeout = min(timeout, remaining)
    started = time.monotonic()
    process = subprocess.Popen(args, cwd=cwd or work, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    timed_out = False
    try:
        stdout, stderr = process.communicate(timeout=timeout)
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
    (output / f"{name}.stdout.txt").write_bytes(stdout)
    (output / f"{name}.stderr.txt").write_bytes(stderr)
    row = {"name": name, "argv": args, "exit": process.returncode, "timedOut": timed_out, "timeoutSeconds": timeout,
           "leaderReaped": process.poll() is not None, "groupAbsent": absent,
           "seconds": time.monotonic() - started, "stdoutBytes": len(stdout), "stderrBytes": len(stderr),
           "stdoutSha256": hashlib.sha256(stdout).hexdigest(), "stderrSha256": hashlib.sha256(stderr).hexdigest()}
    receipt["commands"].append(row)
    print(json.dumps(row), flush=True)
    if process.returncode or timed_out or not absent:
        raise RuntimeError(f"{name} did not complete successfully")

try:
    execute("node-version", ["node", "--version"], 10)
    execute("npm-version", ["npm", "--version"], 10)
    old_lock = json.loads((work / "package-lock.json").read_text()) if (work / "package-lock.json").exists() else None
    generate = receipt["mode"] == "build"
    execute("dependencies", ["npm", "install" if generate or not old_lock else "ci", "--ignore-scripts", "--no-audit", "--no-fund"], 240)
    shutil.copyfile(work / "package-lock.json", output / "package-lock.json")
    if generate and old_lock:
        new_lock = json.loads((work / "package-lock.json").read_text())
        for name, package in old_lock["packages"].items():
            if name:
                actual = new_lock["packages"][name]
                if any(actual.get(k) != package.get(k) for k in ["version", "integrity", "resolved"]):
                    raise RuntimeError("Build tooling changed an existing runtime dependency: " + name)
        receipt["runtimeDependenciesPreserved"] = True
    if receipt["mode"] == "prepare":
        execute("research", ["node", "--test", "tests/unit/research.test.mjs"], 60)
        execute("network-refusals", ["node", "--test", "tests/adversarial/network.test.mjs"], 60)
    elif receipt["mode"] == "build":
        execute("syntax", ["node", "scripts/check.mjs"], 60)
        execute("build", ["npm", "run", "build"], 60)
        files = [{"path": p.relative_to(work / "dist").as_posix(), "bytes": p.stat().st_size,
                  "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
                 for p in sorted((work / "dist").rglob("*")) if p.is_file()]
        (output / "build-manifest.json").write_text(json.dumps(files, indent=2))
    elif receipt["mode"] == "package":
        execute("pack", ["npm", "pack", "--json", "--ignore-scripts", "--pack-destination", str(output)], 30)
        tarball = next(output.glob("*.tgz"))
        with tarfile.open(tarball) as archive:
            members = [{"path": m.name, "bytes": m.size, "mode": m.mode, "regular": m.isfile()} for m in archive.getmembers()]
            roots = {"package/README.md", "package/LICENSE", "package/package.json"}
            prefixes = ("package/src/", "package/bin/", "package/examples/", "package/docs/specs/", "package/docs/references/")
            for member in archive.getmembers():
                if not member.isfile() or (member.name not in roots and not member.name.startswith(prefixes)) or ".." in Path(member.name).parts:
                    raise RuntimeError("Unexpected package member")
                if archive.extractfile(member).read() != (work / member.name.removeprefix("package/")).read_bytes():
                    raise RuntimeError("Archive member differs from its exact source")
        (output / "package-manifest.json").write_text(json.dumps({"file": tarball.name, "bytes": tarball.stat().st_size, "sha256": hashlib.sha256(tarball.read_bytes()).hexdigest(), "members": members}, indent=2))
        def consumer_directory(name):
            directory = scratch / name
            directory.mkdir()
            (directory / "package.json").write_text(json.dumps({"name": "intakelet-" + name, "version": "0.0.0", "private": True, "type": "module"}))
            return directory
        # Normal archive install warms only this owned cache; offline proof
        # explicitly requires these locked public runtime dependencies cached.
        online = consumer_directory("online-consumer")
        execute("online-archive-install", ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", str(tarball)], 120, cwd=online)
        consumer = consumer_directory("offline-consumer")
        execute("offline-archive-install", ["npm", "install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", str(tarball)], 120, cwd=consumer)
        shutil.copyfile(consumer / "package-lock.json", output / "installed-lock.json")
        env["INTAKELET_CONSUMER_ROOT"] = str(consumer)
        (scratch / "cli-tmp").mkdir()
        env["INTAKELET_CONSUMER_TMP"] = str(scratch / "cli-tmp")
        cases = os.environ.get("INTAKELET_CASES", "")
        command = ["node", "--test"]
        if cases:
            names = cases.split(",")
            if len(set(names)) != len(names) or any(name not in [f"M{i:02}" for i in range(1, 9)] for name in names):
                raise RuntimeError("Invalid installed case selection")
            command += ["--test-name-pattern", "^(" + "|".join(names) + ") "]
        command += ["tests/integration/consumer.test.mjs"]
        execute("installed-consumer", command, 300)
        for edition in ["react18", "react19"]:
            target = scratch / edition
            target.mkdir()
            shutil.copyfile(work / f"tests/fixtures/{edition}/package.json", target / "package.json")
            execute(edition + "-dependencies", ["npm", "install", "--ignore-scripts", "--no-audit", "--no-fund", str(tarball)], 180, cwd=target)
            shutil.copyfile(target / "package-lock.json", output / (edition + "-lock.json"))
            shutil.copyfile(work / "tests/fixtures/typed-consumer.tsx", target / "consumer.tsx")
            shutil.copyfile(work / "tests/fixtures/ssr-consumer.mjs", target / "ssr.mjs")
            config = {"compilerOptions": {"target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "jsx": "react-jsx", "strict": True, "noEmit": True, "skipLibCheck": False, "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["node", "react", "react-dom"]}, "include": ["consumer.tsx"]}
            (target / "tsconfig.json").write_text(json.dumps(config))
            execute(edition + "-types", ["node", str(target / "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"], 90, cwd=target)
            execute(edition + "-ssr", ["node", "ssr.mjs"], 30, cwd=target)
            if edition == "react19":
                shutil.copyfile(work / "tests/fixtures/node-consumer.mts", target / "node-consumer.mts")
                config["compilerOptions"]["lib"] = ["ES2022"]
                config["compilerOptions"]["types"] = ["node"]
                config["include"] = ["node-consumer.mts"]
                (target / "node-tsconfig.json").write_text(json.dumps(config))
                execute("node-only-types", ["node", str(target / "node_modules/typescript/bin/tsc"), "-p", "node-tsconfig.json"], 90, cwd=target)
    else:
        raise RuntimeError("Unknown qualification mode")
    receipt["passed"] = True
except Exception as error:
    receipt["error"] = repr(error)
finally:
    after = vector(repo)
    copied = vector(work)
    (output / "source-after.json").write_text(json.dumps(after, indent=2))
    (output / "copied-source-after.json").write_text(json.dumps(copied, indent=2))
    receipt["sourceUnchanged"] = before == after == copied
    original = {row["path"]: row for row in before}
    changed = [row["path"] for row in copied if row != original[row["path"]]]
    receipt["exportChangedPaths"] = changed
    # Lock generation is an explicit output, never relabelled byte-unchanged.
    allowed = ["package-lock.json"] if receipt["mode"] == "build" and receipt.get("runtimeDependenciesPreserved") else []
    receipt["sourceGuardPassed"] = before == after and all(name in allowed for name in changed)
    receipt["scratchBytes"] = sum(p.stat().st_size for p in scratch.rglob("*") if p.is_file() and not p.is_symlink())
    if scratch.stat().st_ino == identity and (scratch / "owner").read_text() == nonce and all(row["groupAbsent"] for row in receipt["commands"]):
        shutil.rmtree(scratch)
        receipt["cleanup"] = not scratch.exists()
    receipt["passed"] = receipt["passed"] and receipt["sourceGuardPassed"] and receipt["cleanup"]
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt), flush=True)
if not receipt["passed"]:
    raise SystemExit(1)
