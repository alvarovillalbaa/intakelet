"""Publish only the qualified public 0.4.0 archive. No credential output."""
import hashlib
import base64
import gzip
import json
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
expected = os.environ["INTAKELET_GITHUB_ARCHIVE_SHA256"]
archive = repo / "docs/results/2026/11-15/github-public-live/qualified/alvarovillalbaa-intakelet-0.4.0.tgz"
receipt = {"source": source, "tag": "v0.4.0", "passed": False, "requests": []}
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
    if os.environ.get("GITHUB_REPOSITORY") != repository or os.environ.get("GITHUB_REF_NAME") != "qa/intakelet-github-public-20261115":
        raise RuntimeError("Publication owner/ref mismatch")
    status, main = api("GET", "/git/ref/heads/main")
    if status != 200 or main["object"]["sha"] != source:
        raise RuntimeError("Production source changed before publication")
    accepted = json.loads((archive.parent / "receipt.json").read_text())
    live = json.loads((archive.parent / "live/live-receipt.json").read_text())
    if not all(accepted.get(key) for key in ["passed", "sourceGuardPassed", "cleanup"]) or not live["passed"]:
        raise RuntimeError("Actual installed public source qualification is required")
    content = archive.read_bytes()
    if digest(content) != expected:
        raise RuntimeError("The qualified archive changed")
    manifest = json.loads((archive.parent / "package-manifest.json").read_text())
    for member in manifest["members"]:
        path = repo / member["path"]
        if path.is_symlink() or not path.is_file() or digest(path.read_bytes()) != member["sha256"] or bool(path.stat().st_mode & 0o111) != bool(member["mode"] & 0o111):
            raise RuntimeError("A qualified package member changed: " + member["path"])
    status, existing = api("GET", "/releases/tags/v0.4.0")
    if status != 404:
        raise RuntimeError("Version0.4.0 already exists; inspect its ownership before continuing")
    status, tag = api("GET", "/git/ref/tags/v0.4.0")
    if status != 404:
        raise RuntimeError("Version0.4.0 tag already exists")
    body = "GitHub Issues source V2 follows real opaque after cursors on its fixed API endpoint. The previous0.3.0 public failure and all earlier releases remain preserved. Source identity/checkpoints are version2: use a fresh reviewed connection rather than silently resetting V1 state.\n\nThe exact candidate passed12 authored adapter controls and six real installed public-GET cases, including three nodejs/node pages, in-memory migration, accepted sample polling/revocation, empty scans and404 without retry. Retained evidence contains metadata/hashes, not issue text or author profiles.\n\nThese are bounded public reads and a T2 reference destination, not OAuth/private access, full large-repository migration, real mutable-update/delete coverage or durable production scheduling. The existing document/OCR/onboarding capabilities and dependency limitations remain separate. GitHub archive distribution, not npm-registry publication.\n\nEvidence: https://github.com/alvarovillalbaa/intakelet/blob/" + source + "/docs/results/2026/11-15/github-public-live/result.md"
    status, release = api("POST", "/releases", {"tag_name": "v0.4.0", "target_commitish": source, "name": "Intakelet0.4.0 — real GitHub cursor pagination and public migration evidence", "body": body, "draft": False, "prerelease": False, "make_latest": "true"})
    if status != 201:
        raise RuntimeError("Release creation did not acknowledge201")
    receipt["release"] = {"id": release["id"], "url": release["html_url"], "tag": release["tag_name"]}
    provenance = json.dumps({"source": source, "qualifiedSource": os.environ["INTAKELET_GITHUB_QUALIFIED_SOURCE"], "version": "0.4.0", "githubSourceVersion": "2", "archive": {"name": archive.name, "bytes": len(content), "sha256": expected}, "qualifiedArchiveMembers": len(manifest["members"]), "dependencyLockSha256": digest((repo / "package-lock.json").read_bytes()), "qualificationRun": int(os.environ["INTAKELET_GITHUB_QUALIFICATION_RUN"]), "actualPublicGETRequests": len(live["requests"]), "acceptedCases": [case["id"] for case in live["cases"]], "privacy": live["privacy"], "distribution": "GitHub archive, not npm registry", "limits": live["limits"]}, indent=2).encode() + b"\n"
    assets = [(archive.name, content, "application/gzip"), ("github-public-acceptance.json", (archive.parent / "live/live-receipt.json").read_bytes(), "application/json"), ("release-provenance.json", provenance, "application/json")]
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
    status, tag = api("GET", "/git/ref/tags/v0.4.0")
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
