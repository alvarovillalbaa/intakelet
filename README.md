# Intakelet

Last updated: 2026-11-15

An onboarding SDK for turning customer files and public websites into reviewed
records, computed insights and a source-backed knowledge base.

Implements the owner's Migration/Onboarding SDK brief: classify/import dropped
information, generate insights/knowledge, and research a supplied URL. It is a
new dedicated project; detailed API/interface choices are delegated judgment.
Classification is rule-based and insights are computed/extractive. No model is
silently called and no LLM understanding or time-to-value benchmark is claimed.

Version0.2.0 adds reusable user/company setup,
quickstart checklists and targeted guided tours, with web components, pure state
and React wrappers. Application acknowledgements bind each completed step to
its exact scope/input; guide progress never grants access. See the
[component integration/publication guide](docs/references/onboarding-components.md)
and [actual source/check limits](docs/results/2026/11-15/onboarding-components.md).
These additions are separate from the preserved 0.1.0 archive and evidence.
The migration API supports reviewed resumable pages,
custom nested output recipes, fenced accepted sync routes, a GitHub Issues
source, arbitrary binary attachments and a streaming Node asset store. See the
[migration integration guide](docs/references/migration-integration.md) and
[actual evidence/remaining work](docs/results/2026/11-15/migration-core.md).
The playground also has file selection, a visual destination-field
editor and a reusable migration review component, with a React wrapper and
correctly scoped acknowledgements. [UI evidence](docs/results/2026/11-15/migration-ui.md)
records the original source checks. The [0.2.0 qualification](docs/results/2026/11-15/qualification-v2/result.md)
binds installed/native evidence and publication identities. Semantic extraction
of arbitrary formats, OAuth connection and production-host/API qualification
remain pending under GEN-3659. The existing
component/CLI v1 limits below apply.

The SDK supports UTF-8 CSV, JSON records, Markdown and text. It proposes fields,
keeps invalid/conflicting rows visible and builds an explicit commit plan.
The host owns authentication and persistence; the SDK provides validated atomic
revision/idempotency semantics and reference in-memory/IndexedDB hosts.

Website research reads public HTTPS pages, robots and an optional sitemap,
extracts meaningful text/links and produces cited knowledge plus a coverage
report. It never executes page scripts, logs into a site or uses a paid service.
The Node transport resolves and pins public addresses before each TLS request.
Browser demonstration is restricted to its own authored sample website;
production integrations use a server endpoint owned by the application.

Try the [public playground](https://intakelet.vercel.app), or install the archive
from [release0.2.0](https://github.com/alvarovillalbaa/intakelet/releases/tag/v0.2.0)
into your Node24+ application. The release archive is a normal npm package;
there is no npm-registry publication or SDK account requirement.

```sh
npm install ./alvarovillalbaa-intakelet-0.2.0.tgz
```

```js
import { analyzeFiles, createPlan, MemoryHost } from '@alvarovillalbaa/intakelet';
const host = new MemoryHost({ workspaceId: 'demo' });
const draft = await analyzeFiles([
  { name: 'guide.md', text: '# Guide\nKeep source links with project notes.' }
], { workspaceId: 'demo' });
const plan = await createPlan(draft); // display sources and review first
const receipt = await host.commit(plan, { expectedRevision: 0 });
```

For browsers, import `defineIntakelet` and `createIndexedDBHost` from
`@alvarovillalbaa/intakelet/element`, import `/styles.css` in your bundler, then
configure an `<intakelet-onboarding>` with a stable trusted workspace/host.
React18/19 applications use `Intakelet` from `/react` with the same properties
and `onCommit`. See [integration guide](docs/references/integration.md) and
[React example](examples/react.jsx). Host applications own authentication,
workspace authority, durable server storage and research rate limits.

The CLI works on explicit local files and always writes a new output:

```sh
npx --no-install intakelet inspect --workspace demo --out draft.json contacts.csv guide.md
npx --no-install intakelet plan draft.json --out plan.json
# Review plan.json before writing a reference-host snapshot.
npx --no-install intakelet apply plan.json --workspace demo --expected-revision 0 --out state.json
npx --no-install intakelet search state.json 'source links' --out matches.json
```

Use `intakelet research https://your-company.com/ --out website.json`, followed
by `inspect --workspace demo --research website.json --out website-draft.json`,
to review real public website research. A partial report stays partial. No
browser-rendered pages, login, binary documents, generated answers or hidden
network enrichment are promised. Node uses verified pinned public TLS; the
public browser demo intentionally researches only its own fictional site.

[SDK contract](docs/specs/sdk-v1.md), [source notes](docs/references/sources.md)
and [qualification/evidence](docs/specs/qualification-v1.md) state exact limits.
Results under docs/results/2026/11-14 distinguish installed, typed, virtual,
native HTTPS, hosted and browser checks, retaining original failures. This is
an early developer SDK; no measured onboarding-time or AI-quality claim.
