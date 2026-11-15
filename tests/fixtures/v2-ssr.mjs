// T2 installed consumers; no DOM/browser globals are available during SSR.
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { initialSetup } from '@alvarovillalbaa/intakelet/onboarding';
import { createGitHubIssuesSource, githubIssuesMigration, MemoryMigrationHost } from '@alvarovillalbaa/intakelet/migration';
import { IntakeletSetup, IntakeletQuickstart, IntakeletTour, IntakeletMigration } from '@alvarovillalbaa/intakelet/react';
assert.equal(typeof window, 'undefined');
const flow = initialSetup('user', { actorId: 'authored', workspaceId: 'ssr' });
const submit = async request => ({ requestId: request.requestId, stepId: request.stepId, status: 'saved', receiptId: 'authored' });
const source = createGitHubIssuesSource({ owner: 'authored', repo: 'example' });
const spec = githubIssuesMigration({ workspaceId: 'ssr', connectionId: 'ssr-issues', source });
const examples = [
  [IntakeletSetup, { flow, submit }, 'intakelet-setup'],
  [IntakeletQuickstart, { flow: { ...flow, steps: [{ id: 'first', title: 'First', fields: [] }] }, submit }, 'intakelet-quickstart'],
  [IntakeletTour, { steps: [{ id: 'first', title: 'First', description: 'Authored', target: '#target' }] }, 'intakelet-tour'],
  [IntakeletMigration, { spec, source, host: new MemoryMigrationHost({ workspaceId: 'ssr' }) }, 'intakelet-migration'],
];
const html = examples.map(([component, props, tag]) => { const value = renderToString(createElement(component, props)); assert.ok(value.includes('<' + tag)); return value; });
console.log(JSON.stringify({ browserGlobalRequired: false, html }));
