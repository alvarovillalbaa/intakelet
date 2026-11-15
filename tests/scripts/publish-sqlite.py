"""Publish only the qualified public 0.5.0 archive. No credential output."""
import hashlib
import base64
import gzip
import json
import re
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

repo = Path(__file__).resolve().parents[2]
repository = "alvarovillalbaa/intakelet"
source = os.environ["INTAKELET_RELEASE_SOURCE"]
output = Path(os.environ["INTAKELET_PUBLICATION_OUTPUT"])
output.mkdir(exist_ok=False)
token = os.environ["INTAKELET_RELEASE_TOKEN"]
expected = os.environ["INTAKELET_SQLITE_ARCHIVE_SHA256"]
archive = repo / "docs/results/2026/11-15/sqlite-host-v1/qualified/alvarovillalbaa-intakelet-0.5.0.tgz"
receipt = {"source": source, "tag": "v0.5.0", "passed": False, "requests": []}
digest = lambda value: hashlib.sha256(value).hexdigest()

def api(method, path, body=None, content_type="application/json"):
    url = path if path.startswith("https://uploads.github.com/repos/alvarovillalbaa/intakelet/") else "https://api.github.com/repos/" + repository + path
    if not url.startswith(("https://api.github.com/repos/" + repository + "/", "https://uploads.github.com/repos/" + repository + "/")):
        raise RuntimeError("Publication target is outside the owned repository")
    data = json.dumps(body).encode() if isinstance(body, dict) else body
    request = urllib.request.Request(url, data=data, method=method, headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": content_type, "User-Agent": "intakelet-owned-release"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read(2 * 1024**2)
            receipt["requests"].append({"method": method, "path": urllib.parse.urlsplit(url).path, "status": response.status, "responseSha256": digest(raw)})
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        receipt["requests"].append({"method": method, "path": urllib.parse.urlsplit(url).path, "status": error.code})
        if error.code == 404:
            return 404, None
        raise RuntimeError("GitHub publication request returned HTTP" + str(error.code)) from None

try:
    if os.environ.get("GITHUB_REPOSITORY") != repository or os.environ.get("GITHUB_REF_NAME") != "qa/intakelet-sqlite-20261115":
        raise RuntimeError("Publication owner/ref mismatch")
    status, main = api("GET", "/git/ref/heads/main")
    if status != 200 or main["object"]["sha"] != source:
        raise RuntimeError("Production source changed before publication")
    accepted = json.loads((archive.parent / "receipt.json").read_text())
    processes = json.loads((archive.parent / "installed/process-cleanup.json").read_text())["observations"]
    report = (archive.parent / "actual-installed-sqlite.stdout.txt").read_text()
    cases = re.findall(r"^ok \d+ - (D\d{2}) ", report, re.M)
    expected_cases = ["D" + str(index).zfill(2) for index in range(1, 12)]
    if not all(accepted.get(key) for key in ["passed", "sourceGuardPassed", "cleanup"]) or cases != expected_cases or not any(c["name"] == "installed-node-types" and c["code"] == 0 for c in accepted["commands"]):
        raise RuntimeError("Actual installed SQLite/process/types qualification is required")
    content = archive.read_bytes()
    if digest(content) != expected:
        raise RuntimeError("The qualified archive changed")
    manifest = json.loads((archive.parent / "package-manifest.json").read_text())
    for member in manifest["members"]:
        path = repo / member["path"]
        if path.is_symlink() or not path.is_file() or digest(path.read_bytes()) != member["sha256"] or bool(path.stat().st_mode & 0o111) != bool(member["mode"] & 0o111):
            raise RuntimeError("A qualified package member changed: " + member["path"])
    status, existing = api("GET", "/releases/tags/v0.5.0")
    if status != 404:
        raise RuntimeError("Version0.5.0 already exists; inspect its ownership before continuing")
    status, tag = api("GET", "/git/ref/tags/v0.5.0")
    if status != 404:
        raise RuntimeError("Version0.5.0 tag already exists")
    body = "Durable Node SQLite migration host: reviewed output rows, accepted routes, fenced claims, checkpoints and exact receipts commit atomically. Explicit new-store initialization and exact schema/workspace checks; no automatic migration of an unknown database. Node24.22.2 built-in SQLite remains release candidate/stability1.2.\n\nThe exact archive passed eleven actual installed SQLite/process identities, including fresh-process resume, withheld-receipt replay, independent claimant fencing, real rollback and SQLite busy/full/read-only failures, with normal closure plus one deliberate claimant kill. Node-only declarations and the packaged worker/schema passed. Earlier releases/evidence remain preserved.\n\nAuthored fixtures establish bounded local-database software behavior, not production authentication, private OAuth, operated scheduling, multi-host/enterprise scale or hardware power-loss qualification. Applications own permissions, provider credentials and retention. GitHub archive distribution, not npm-registry publication.\n\nEvidence: https://github.com/alvarovillalbaa/intakelet/blob/" + source + "/docs/results/2026/11-15/sqlite-host-v1/result.md"
    status, release = api("POST", "/releases", {"tag_name": "v0.5.0", "target_commitish": source, "name": "Intakelet0.5.0 — durable SQLite migrations and restart recovery", "body": body, "draft": False, "prerelease": False, "make_latest": "true"})
    if status != 201:
        raise RuntimeError("Release creation did not acknowledge201")
    receipt["release"] = {"id": release["id"], "url": release["html_url"], "tag": release["tag_name"]}
    schema = (repo / "src/sqlite-host-v1.sql").read_bytes()
    acceptance = json.dumps({"source": source, "qualifiedSource": os.environ["INTAKELET_SQLITE_QUALIFIED_SOURCE"], "qualificationRun": int(os.environ["INTAKELET_SQLITE_QUALIFICATION_RUN"]), "tier": "T2 authored data with actual installed Node/SQLite/process execution", "cases": cases, "archive": {"bytes": len(content), "sha256": expected, "members": len(manifest["members"])}, "schema": {"version": 1, "bytes": len(schema), "sha256": digest(schema)}, "closedOwnedDatabases": sum("case" in p and p.get("closed") and p.get("removed") for p in processes), "normalChildren": sum("child" in p and not p["expectedKill"] and p["code"] == 0 and p["signal"] is None for p in processes), "deliberatelyKilledClaimants": sum("child" in p and p["expectedKill"] and p["signal"] == "SIGKILL" for p in processes), "installedNodeTypes": True, "sourceGuardPassed": accepted["sourceGuardPassed"], "ownedScratchRemoved": accepted["cleanup"], "limits": ["Node24.22.2 SQLite release candidate/stability1.2", "No real provider, OAuth, production authentication or operated scheduler", "No hardware power-loss, network filesystem, encryption, multi-host or enterprise-scale proof"]}, indent=2).encode() + b"\n"
    provenance = json.dumps({"source": source, "qualifiedSource": os.environ["INTAKELET_SQLITE_QUALIFIED_SOURCE"], "version": "0.5.0", "archive": {"name": archive.name, "bytes": len(content), "sha256": expected}, "qualifiedArchiveMembers": len(manifest["members"]), "dependencyLockSha256": digest((repo / "package-lock.json").read_bytes()), "schemaSha256": digest(schema), "qualificationRun": int(os.environ["INTAKELET_SQLITE_QUALIFICATION_RUN"]), "distribution": "GitHub archive, not npm registry"}, indent=2).encode() + b"\n"
    assets = [(archive.name, content, "application/gzip"), ("sqlite-acceptance.json", acceptance, "application/json"), ("sqlite-host-v1.sql", schema, "application/sql"), ("release-provenance.json", provenance, "application/json")]
    sums = "".join(digest(value) + "  " + name + "\n" for name, value, mime in assets).encode()
    assets.append(("SHA256SUMS.txt", sums, "text/plain"))
    receipt["assets"] = []
    for name, value, mime in assets:
        status, asset = api("POST", "https://uploads.github.com/repos/" + repository + "/releases/" + str(release["id"]) + "/assets?name=" + urllib.parse.quote(name), value, mime)
        if status != 201 or asset["size"] != len(value) or asset.get("digest") != "sha256:" + digest(value):
            raise RuntimeError("Published asset identity mismatch")
        receipt["assets"].append({"id": asset["id"], "name": name, "bytes": len(value), "sha256": digest(value), "url": asset["browser_download_url"]})
        # A separate unauthenticated ordinary public download; never reuse the
        # authenticated API request or persist temporary CDN redirect URLs.
        with urllib.request.urlopen(urllib.request.Request(asset["browser_download_url"], headers={"User-Agent": "intakelet-public-download"}), timeout=30) as response:
            public = response.read(len(value) + 1)
            if response.status != 200 or public != value:
                raise RuntimeError("Anonymous public asset download differs")
            receipt["assets"][-1]["anonymousDownload"] = {"status": response.status, "bytes": len(public), "sha256": digest(public), "equal": True}
        (output / name).write_bytes(value)
    status, tag = api("GET", "/git/ref/tags/v0.5.0")
    if status != 200 or tag["object"]["sha"] != source:
        raise RuntimeError("Published tag source differs")
    status, main = api("GET", "/git/ref/heads/main")
    if status != 200 or main["object"]["sha"] != source:
        raise RuntimeError("Main changed during publication")
    receipt["passed"] = True
except Exception as error:
    receipt["error"] = str(error)
finally:
    # Preserve only public identifiers and request status/digests, never tokens
    # or authenticated response bodies with account metadata.
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2))
    print("INTAKELET_PUBLICATION " + json.dumps(receipt), flush=True)
    for path in sorted(output.iterdir()):
        if path.suffix == ".tgz":
            continue
        value = path.read_bytes()
        print("INTAKELET_RELEASE_FILE " + json.dumps({"path": path.name, "bytes": len(value), "sha256": digest(value), "data": base64.b64encode(gzip.compress(value, mtime=0)).decode()}), flush=True)
if not receipt["passed"]:
    raise SystemExit(1)
