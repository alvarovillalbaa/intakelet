"""Retire only this owned temporary workflow/ref, retaining public receipts."""
import json
import os
from pathlib import Path
import urllib.error
import urllib.parse
import urllib.request

repository = "alvarovillalbaa/intakelet"
branch = "qa/intakelet-documents-20261115"
main_sha = os.environ["INTAKELET_RELEASE_SOURCE"]
expected_qa = os.environ["GITHUB_SHA"]
token = os.environ["INTAKELET_RETIRE_TOKEN"]
output = Path(os.environ["INTAKELET_RETIRE_OUTPUT"])
output.mkdir(exist_ok=False)
receipt = {"main": main_sha, "qaBefore": expected_qa, "passed": False, "requests": []}
def request(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request("https://api.github.com/repos/" + repository + path, data=data, method=method, headers={"Authorization": "Bearer " + token, "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "intakelet-owned-retirement"})
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            value = response.read(2 * 1024**2)
            receipt["requests"].append({"method": method, "path": path, "status": response.status})
            return response.status, json.loads(value) if value else None
    except urllib.error.HTTPError as error:
        receipt["requests"].append({"method": method, "path": path, "status": error.code})
        if error.code == 404:
            return 404, None
        raise RuntimeError("Owned retirement returned HTTP" + str(error.code)) from None
try:
    if os.environ.get("GITHUB_REPOSITORY") != repository or os.environ.get("GITHUB_REF_NAME") != branch:
        raise RuntimeError("Wrong retirement owner/ref")
    code, main = request("GET", "/git/ref/heads/main")
    if code != 200 or main["object"]["sha"] != main_sha:
        raise RuntimeError("Main changed before retirement")
    code, qa = request("GET", "/git/ref/heads/" + branch)
    if code != 200 or qa["object"]["sha"] != expected_qa:
        raise RuntimeError("Owned temporary head changed")
    code, active = request("GET", "/contents/.github/workflows/documents-v3.yml?ref=main")
    if code != 404:
        raise RuntimeError("Temporary workflow unexpectedly exists on main")
    code, file = request("GET", "/contents/.github/workflows/documents-v3.yml?ref=" + urllib.parse.quote(branch, safe=""))
    if code != 200:
        raise RuntimeError("Owned temporary workflow is missing")
    code, deleted = request("DELETE", "/contents/.github/workflows/documents-v3.yml", {"branch": branch, "sha": file["sha"], "message": "chore: retire the completed temporary Intakelet qualification workflow"})
    if code != 200:
        raise RuntimeError("Workflow removal was not acknowledged")
    retired = deleted["commit"]["sha"]
    receipt["retiredCommit"] = retired
    code, qa = request("GET", "/git/ref/heads/" + branch)
    if code != 200 or qa["object"]["sha"] != retired:
        raise RuntimeError("Temporary head changed after workflow removal")
    code, active = request("GET", "/contents/.github/workflows/documents-v3.yml?ref=" + urllib.parse.quote(branch, safe=""))
    if code != 404:
        raise RuntimeError("Removed temporary workflow remains reachable on the ref")
    # GitHub DELETE ref has no server-side expected-head parameter. Serialize
    # against the immediately read exact owner head and record that limitation.
    code, qa = request("GET", "/git/ref/heads/" + branch)
    if code != 200 or qa["object"]["sha"] != retired:
        raise RuntimeError("Temporary ref changed immediately before deletion")
    code, ignored = request("DELETE", "/git/refs/heads/" + branch)
    if code != 204:
        raise RuntimeError("Temporary ref deletion did not acknowledge204")
    code, ignored = request("GET", "/git/ref/heads/" + branch)
    if code != 404:
        raise RuntimeError("Temporary ref remains reachable")
    code, main = request("GET", "/git/ref/heads/main")
    if code != 200 or main["object"]["sha"] != main_sha:
        raise RuntimeError("Main changed during retirement")
    receipt.update(passed=True, workflowAbsent=True, qaDeleted=True, mainUnchanged=True, deleteSemantics="serialized exact owner read; GitHub DELETE ref is not atomic CAS")
except Exception as error:
    receipt["error"] = str(error)
finally:
    (output / "receipt.json").write_text(json.dumps(receipt, indent=2))
    print("INTAKELET_RETIREMENT " + json.dumps(receipt), flush=True)
if not receipt["passed"]:
    raise SystemExit(1)
