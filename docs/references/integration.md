# Embed Intakelet

Last updated: 2026-11-14

Use the actual0.1.0 GitHub release archive, or a source checkout. The root
module contains file analysis/planning/knowledge/reference-host contracts.
`/element` provides the browser component, IndexedDB host and same-origin demo
research. `/react` wraps that element. `/node` owns native public HTTPS research.
Import `/styles.css` through your app bundler or serve that CSS beside the SDK.
No account, remote SDK service, model or provider key is implicit.

```js
import { analyzeFiles, createPlan, MemoryHost } from '@alvarovillalbaa/intakelet';
const host = new MemoryHost({ workspaceId: 'example' });
const draft = await analyzeFiles([
  { name: 'guide.md', text: '# Guide\n\nAn authored source note.' }
], { workspaceId: 'example' });
const plan = await createPlan(draft); // show the user its sources and review
const receipt = await host.commit(plan, { expectedRevision: 0 });
```

File inputs are UTF-8 strings, not filesystem paths. Use the CLI for explicit
local files. Contact fields come from unambiguous header aliases; use
`review.mappings[sourceId] = {kind:'contact',mapping:{email:'Your column'}}`
to override them. `excludedRows:[{sourceId,index}]` uses zero-based data rows.
Invalid/conflicting rows block until corrected/excluded, or explicitly accepted
for exclusion with `skipInvalid:true`. Excluding rows does not redact the full
staged source file. Remove a source before creating a plan if it must not be
sent to your host. Exact duplicate rows merge provenance; conflicts do not
silently overwrite existing contacts.

```js
import { defineIntakelet, createIndexedDBHost } from '@alvarovillalbaa/intakelet/element';
defineIntakelet();
const element = document.querySelector('intakelet-onboarding');
element.configure({
  workspaceId: 'example',
  host: createIndexedDBHost({ workspaceId: 'example' })
});
element.addEventListener('intakelet-commit', event => {
  // Matching host acknowledgement; persists even if the user changes views.
  console.info(event.detail.planId, event.detail.revision);
});
```

Create the element in HTML or your framework. Registration runs in a browser
effect; importing the React wrapper does not require a browser during SSR.
Keep host instances stable with `useMemo` and call their `close()` when your
application finishes owning them. Changes to workspace/host invalidate the old
review and pending UI results. A research-callback refresh on the same host
keeps staged files. All labels are literal text. See examples/react.jsx.

For real websites, call `researchWebsite(url, options)` from your application
server and pass a callback as `configuration.research`. It returns sources,
page categories, attempt hashes, refusals and coverage; show that coverage with
the review. Bind authentication, trusted workspace lookup and rate limits in
the host application. Never derive authorization from plan.workspaceId. The
reference memory/local IndexedDB hosts are not production identity systems.

Research accepts only public HTTPS443 domains and root/www site aliases. It
does not execute JavaScript, log in, post forms, send cookies or visit arbitrary
subdomains. Private/special/mixed DNS and off-site redirects are refused. Eight
pages, one sitemap,16 requests,512KiB/page,2MiB and60seconds bound the session;
robots and delays can reduce coverage. A partial/no-content report stays so.
`researchSameOrigin` is only for same-origin browser examples; it is not a
server SSRF control or a proxy. Uploaded research annotations have no signature.

CLI: `inspect`, `plan`, `research`, `apply`, `search`; use `intakelet --help`.
Every output must be a new file. `apply` uses an explicit workspace/revision and
optional previous snapshot, then writes a new snapshot; it never replaces your
database. The host API is the integration for actual application persistence.
Node24+, modern browser/IndexedDB. Exact installed/React/browser/native check
receipts live under docs/results/2026/11-14. Read each boundary separately;
source examples and server rendering alone do not prove browser behavior.
