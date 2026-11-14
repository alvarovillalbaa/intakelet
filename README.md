# Intakelet

Last updated: 2026-11-14

An onboarding SDK for turning customer files and public websites into reviewed
records, computed insights and a source-backed knowledge base.

Implements the owner's Migration/Onboarding SDK brief: classify/import dropped
information, generate insights/knowledge, and research a supplied URL. It is a
new dedicated project; detailed API/interface choices are delegated judgment.
Classification is rule-based and insights are computed/extractive. No model is
silently called and no LLM understanding or time-to-value benchmark is claimed.

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

Implementation and qualification are in progress. Do not infer publication,
installed-consumer, website or browser acceptance from this source scaffold.
Read [SDK contract](docs/specs/sdk-v1.md) and [source notes](docs/references/sources.md).
