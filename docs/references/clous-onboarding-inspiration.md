# Clous onboarding references

Inspected 2026-11-14 for [GEN-3659](https://app.notion.com/p/418a1ee8bd0680c99343ea23eb42d0dd).
These references inform original Intakelet components. No Clous code, assets,
company records or private onboarding data were copied into the SDK.

## GitHub execution sources actually read

| Source | Returned Git blob SHA | Applied observation |
| --- | --- | --- |
| [Frontend onboarding README](https://github.com/clous-ai/cloush-frontend/blob/main/components/onboarding/README.md) | `ac33e9804d67daaef6f21a28d98ded0433c48316` | Separate wizard, targeted guide and reusable quickstart presentation; device progress does not imply account sync. Failed saves stay on their step. |
| [Wizard sequence](https://github.com/clous-ai/cloush-frontend/blob/main/components/onboarding/wizard/buildStepSequence.ts) | `3ab55bba227d198b673eb6cbe14082d3c116b4cb` | Different initial flows for person/profile and first-company setup. |
| [Targeted guide API, lines 1–65](https://github.com/clous-ai/cloush-frontend/blob/main/components/onboarding/DynamicOnboardingGuide.tsx) | `ecfde1627ae07ad4e319c46f98101907a7b7c5e8` | Targets/selectors, per-step instructions, prepare requirements and explicit completion/close are distinct from route owners. Only this introductory/API slice was fetched remotely. |
| [Backend organization command serializer](https://github.com/clous-ai/cloush-server/blob/main/organizations/serializers/commands.py) | `5f42d7fecad741ed87800ff8e0ffe483f93bb470` | Company/workspace creation uses a strict input command and requires an authenticated actor from server context, not payload authority. |

Git blob SHAs identify returned file content, not commit IDs or deployed runtime
evidence. No Clous browser, live endpoint, authentication or company creation ran.

## Local working sources and disagreement

The local frontend checkout is at HEAD
`652572023edd0fb580f72e61a746d43920f01e2a`; its `features/onboarding/`,
`lib/api/clients/identity/onboarding.ts`, `lib/utils/storage/quickstartProgress.ts`
and `components/forms/CompanySetup.tsx` are untracked working files. Relevant
README/sequence/wizard/guide sections, feature-visibility parser, scoped progress
storage and company-save call were inspected. The new feature path returned
404 from GitHub; tracked `components/onboarding/` paths above supplied canonical
remote references instead. Do not claim those untracked paths are published.

The backend checkout is at HEAD
`0b6957bc53dbd5815a19263d0910610ae2b588fc`; organization command and creation
serializers have local changes. Relevant command input/create and authenticated
preflight/view sections were inspected. The remote command differs in preference
shape, so Intakelet does not adopt either preference payload as a Clous contract.
The shared principle used here is server-owned actor/workspace authority.

The local feature-visibility parser further separates presentation milestones
from permission decisions. Intakelet adopts that separation: tutorial progress
never grants a capability. Local source observations are inspiration, not proof
that a particular Clous account or deployment currently behaves this way.
