# Setup, quickstart and guided tours

These APIs belong to **0.2.0**. They are not in the preserved
0.1.0 release archive. The file/research SDK still uses its existing bounded v1
contracts. No account, server, permissions or external connector is created by
registering a component.

## User or company setup

```js
import { defineOnboarding, initialSetup }
  from '@alvarovillalbaa/intakelet/onboarding';

defineOnboarding();
const setup = document.querySelector('intakelet-setup');
setup.configure({
  flow: initialSetup('company', {
    actorId: currentActor.id,
    workspaceId: currentWorkspace.id
  }),
  submit: saveStepInYourApplication
});
```

Use `initialSetup('user', scope)` for a person's name and optional first goal;
company setup collects a company name, optional HTTPS website and preferences.
Custom definitions have `id`, `version`, `scope`, optional `title`/`description`,
and `steps`. Each step has `id`, `title`, `fields`, and optional `description`,
`optional` and `actionLabel`. Fields have an ID, label and type: `text`, `email`,
`url`, `textarea`, `select` or `checkbox`; select options are `{value,label}`.
`required`, `maxLength` and `hint` are optional. At most 40 steps, 20 fields per
step and 2,000 characters per field bound the component. Passwords, document
uploads, arbitrary HTML and execution instructions are not field types.

The SDK validates supplied values and sends the handler an isolated copy of:

```js
{
  schema: 'intakelet.onboarding-step', version: 1,
  flowId, flowVersion, scope, stepId, values, requestId
}
```

`requestId` binds the exact scope, version, step and values by content hash.
Retries with the same input keep the same key. This is integrity/idempotency
metadata, **not authentication, a signature or proof of domain ownership**.
Change the flow version when field/step meaning changes; do not reuse a version
for a different application operation.
The application handler must return a matching acknowledgement only after its
own operation succeeds:

```js
{ requestId, stepId, status: 'saved', receiptId }
```

The application server authenticates the actor, derives the trusted workspace,
checks its own allowed operation and field schema, rejects mismatched client
scope, and atomically handles the content-bound idempotency key. Recompute the
expected request with the server's known definition and trusted context; never
derive authorization from the client's `scope`, `flowId` or hash. A callback that
merely echoes a request is not production persistence. No such server is
provisioned by Intakelet.

Required steps cannot be skipped or bypassed. A failed/mismatched acknowledgement
keeps the draft and current step. Optional Skip is a personal guide choice, not
a successful application write. Editing an acknowledged answer makes that step
pending again without rolling back the application's prior write.

`intakelet-onboarding-acknowledged` includes `flowId`, `flowVersion`, `scope`, the
matching acknowledgement and `appliedToView`. An acknowledgement arriving after
scope change/cancellation is still emitted with its original scope and
`appliedToView:false`; it cannot advance the new view. Filter by context when
projecting events. `intakelet-onboarding-complete` describes the completed guide,
not account permissions. Cancellation requests abort; it cannot reverse an
application write already acknowledged.

Drafts/progress are memory-only in this component. `progress` returns an isolated
snapshot. The host owns any durable guide state and should guard unsaved route
changes. Changing scope, flow/version or step definitions disposes the old view;
refreshing only a handler keeps the same inputs and focus.

## Quickstart checklist

```js
const quickstart = document.querySelector('intakelet-quickstart');
quickstart.configure({
  flow: {
    id: 'first-session', version: '1', scope: trustedScope,
    title: 'Your next useful step',
    steps: [
      { id: 'source', title: 'Bring your first source', fields: [],
        actionLabel: 'Open import' },
      { id: 'connection', title: 'Connect a tool', fields: [], optional: true }
    ]
  },
  submit: handleQuickstartAction
});
```

Actions can run independently. The handler may open application UI and should
acknowledge completion only when its actual condition is true. An action that
only navigates should stay pending until the application can acknowledge it.
Use field-free steps here; setup handles forms. Completed/skipped counts never
grant capabilities or represent an account-synced state.

## Targeted tour

```js
const tour = document.querySelector('intakelet-tour');
tour.configure({
  steps: [
    { id: 'import', title: 'Bring your first file',
      description: 'Open the import review here.',
      target: '#import-button', placement: 'bottom' }
  ],
  prepare: async (step, { signal }) => {
    // Reveal application UI using your own routing/state owner.
    // Honour signal; do not grant permissions or submit a form here.
  },
  onComplete: () => {},
  onClose: ({ reason, stepId }) => {}
});
await tour.start(); // explicit user action
```

The modeless guide highlights the target with a separate overlay; it does not
modify target styles, automatically click it or prevent other application work.
Next stays unavailable for a missing/hidden target. Retry finds a replacement
node; Back, Close and Escape remain available. Preparation is bounded to 5 s and
target discovery to 2.5 s. Reconfiguration/disconnect/close cancels owned waits,
observers, animation frames and listeners and restores focus when possible.
Positioning accounts for the visible viewport; overflow is scrollable. Actual
screen reader, native dialog, keyboard, zoom and mobile layout acceptance is
still pending for these source additions.

## React and pure state

```jsx
import { IntakeletSetup, IntakeletQuickstart, IntakeletTour }
  from '@alvarovillalbaa/intakelet/react';

<IntakeletSetup flow={userFlow} submit={saveStepInYourApplication}
  onAcknowledged={handleAcknowledgement} />
<IntakeletQuickstart flow={quickstartFlow} submit={handleQuickstartAction} />
<IntakeletTour steps={tourSteps} active={showTour} onClose={closeTour} />
```

Import `/styles.css` in the host bundler. Registering occurs in browser effects;
module imports do not require browser globals. Keep definitions stable where
possible. Runtime acceptance in installed React 18/19 consumers has not yet run
for these new wrappers. The root module also exports `OnboardingSession`,
`initialSetup`, validation/request helpers and pure `tourPosition` for hosts
building their own presentation.

## Package and publish the updated SDK

The [existing integration guide](integration.md) describes 0.1.0's import,
research, host and CLI contracts. For a new source release:

1. Complete the requested migration/schema/connector work and choose a new
   release version. Do not replace the original 0.1.0 artifact.
2. Verify the declared root/element/onboarding/React/Node exports and declarations;
   build/pack in an owned environment with sufficient storage.
3. Inspect the actual tarball allowlist, install it in separate Node/browser and
   React 18/19 consumers, and exercise the new components and acknowledgement
   lifecycle. Source imports and type checks are not installed-package proof.
4. Keep raw checks/failures, archive checksum and exact source identity. Publish
   the archive/checksum and matching static playground separately, verifying
   exact hosted assets. A registry publication is a distinct explicit action.

No new dependencies, backend, database, credentials or deployment were introduced
in this component iteration. Bulk arbitrary-format migration, third-party
migration/continuous sync and user-defined output schemas remain separate open
requirements of GEN-3659.
