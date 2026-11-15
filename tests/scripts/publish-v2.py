"""Publish only the qualified public 0.2.0 archive. No credential output."""
import hashlib
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
expected = "84a3fc59b83ae3182396bffa2e6bb7b61bda2b126c144b08309c236b5a41e4be"
archive = repo / "docs/results/2026/11-15/qualification-v2/run-4/alvarovillalbaa-intakelet-0.2.0.tgz"
receipt = {"source": source, "tag": "v0.2.0", "passed": False, "requests": []}
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
    if os.environ.get("GITHUB_REPOSITORY") != repository or os.environ.get("GITHUB_REF_NAME") != "qa/intakelet-onboarding-20261115":
        raise RuntimeError("Publication owner/ref mismatch")
    status, main = api("GET", "/git/ref/heads/main")
    if status != 200 or main["object"]["sha"] != source:
        raise RuntimeError("Production source changed before publication")
    content = archive.read_bytes()
    if digest(content) != expected or len(content) != 87878:
        raise RuntimeError("The qualified archive changed")
    manifest = json.loads((archive.parent / "package-manifest.json").read_text())
    for member in manifest["members"]:
        path = repo / member["path"]
        if path.is_symlink() or not path.is_file() or digest(path.read_bytes()) != member["sha256"] or bool(path.stat().st_mode & 0o111) != bool(member["mode"] & 0o111):
            raise RuntimeError("A qualified package member changed: " + member["path"])
    status, existing = api("GET", "/releases/tags/v0.2.0")
    if status != 404:
        raise RuntimeError("Version0.2.0 already exists; inspect its ownership before continuing")
    status, tag = api("GET", "/git/ref/tags/v0.2.0")
    if status != 404:
        raise RuntimeError("Version0.2.0 tag already exists")
    body = "Setup for people and companies, acknowledged quickstart, targeted tours, reviewed resumable file migrations and custom nested output recipes. Web components, React18/19, Node asset storage and typed exports are included.\n\nThe archive is qualified in installed consumers and native Chromium. Download SHA256SUMS.txt and release-provenance.json with it.\n\nHosts own authentication, durable data and accepted background scheduling. Binary attachments preserve bytes; PDF/Office/image extraction and OAuth one-click app connections remain pending. This is GitHub archive distribution, not npm-registry publication.\n\nEvidence: https://github.com/alvarovillalbaa/intakelet/blob/" + source + "/docs/results/2026/11-15/qualification-v2/result.md"
    status, release = api("POST", "/releases", {"tag_name": "v0.2.0", "target_commitish": source, "name": "Intakelet0.2.0 — acknowledged onboarding and reviewed migrations", "body": body, "draft": False, "prerelease": False, "make_latest": "true"})
    if status != 201:
        raise RuntimeError("Release creation did not acknowledge201")
    receipt["release"] = {"id": release["id"], "url": release["html_url"], "tag": release["tag_name"]}
    sums = (expected + "  " + archive.name + "\n").encode()
    provenance = json.dumps({"source": source, "version": "0.2.0", "archive": {"name": archive.name, "bytes": len(content), "sha256": expected}, "qualifiedArchiveMembers": len(manifest["members"]), "initialArchiveSha256": "7052c8a744bbc931a15989c5f3f9e0951167a60e88872356b0b39d4ce1dcea8b", "runtimeBytesAndModesPreserved": True, "onlyChangedArchiveMembers": ["README.md", "docs/references/migration-integration.md", "docs/references/onboarding-components.md"], "runs": [43708443934, 43708699066, 43708888948, 43709262034], "distribution": "GitHub archive; cached runtime dependencies required for the observed offline install", "limits": "No OAuth, production host/scheduler or arbitrary-format semantic extraction."}, indent=2).encode() + b"\n"
    receipt["assets"] = []
    for name, value, mime in [(archive.name, content, "application/gzip"), ("SHA256SUMS.txt", sums, "text/plain"), ("release-provenance.json", provenance, "application/json")]:
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
    status, tag = api("GET", "/git/ref/tags/v0.2.0")
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
if not receipt["passed"]:
    raise SystemExit(1)
