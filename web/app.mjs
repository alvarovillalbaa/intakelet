import { defineIntakelet, createIndexedDBHost, researchSameOrigin } from '../src/element.mjs';
import { defineOnboarding, initialSetup, stepRequest } from '../src/onboarding-elements.mjs';
import { configureMigrationDemo } from '../examples/migration-playground.mjs';
defineOnboarding();
defineIntakelet();
const onboarding = document.getElementById('onboarding'), host = createIndexedDBHost({ workspaceId: 'playground', databaseName: 'intakelet-playground-v1' });
onboarding.configure({ workspaceId: 'playground', host, research: researchSameOrigin });
const status = document.getElementById('app-status');
document.getElementById('sample-files').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true; status.textContent = 'Reading the authored sample files…';
  try {
    const names = ['contacts.csv', 'handbook.md'], files = [];
    for (const name of names) { const response = await fetch('/fixtures/' + name); if (!response.ok) throw new Error('Sample file HTTP' + response.status); files.push({ name, text: await response.text() }); }
    await onboarding.addSources(files); status.textContent = 'Authored samples are staged in the component. Review before importing.';
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
document.getElementById('sample-website').addEventListener('click', () => {
  const input = onboarding.querySelector('[data-intakelet=url]'); if (!input || input.disabled) { status.textContent = 'Wait for the current import/research operation to finish.'; return; }
  input.value = new URL('/fixtures/company/', location.origin).href; input.dispatchEvent(new Event('input', { bubbles: true })); input.focus(); input.scrollIntoView({ block: 'center', behavior: 'auto' }); status.textContent = 'The fictional company URL is ready. Choose Research website in the component.';
});
window.addEventListener('pagehide', event => { if (!event.persisted) host.close(); });
window.addEventListener('pageshow', event => { if (event.persisted) void onboarding.refresh(); });

const demoScope = { actorId: 'authored-demo-actor', workspaceId: 'playground' }, setupReceipts = new Map();
for (const [id, audience] of [['user-setup', 'user'], ['company-setup', 'company']]) {
  const flow = initialSetup(audience, demoScope);
  document.getElementById(id).configure({ flow, submit: async request => {
    const expected = await stepRequest(flow, request.stepId, request.values);
    if (expected.requestId !== request.requestId) throw new Error('Demo step integrity mismatch');
    // This is a real session-only reference write, not an account operation.
    if (!setupReceipts.has(request.requestId)) setupReceipts.set(request.requestId, { request: structuredClone(request), receipt: { requestId: request.requestId, stepId: request.stepId, status: 'saved', receiptId: 'demo-' + request.requestId.slice(7, 23) } });
    return structuredClone(setupReceipts.get(request.requestId).receipt);
  } });
}
let imported = false; onboarding.addEventListener('intakelet-commit', () => { imported = true; });
const quickstartFlow = { id: 'playground-quickstart', version: '1', scope: demoScope, title: 'A useful first session', sequential: false, steps: [
  { id: 'profile', title: 'Make the demo yours', description: 'Complete the first user setup step above.', fields: [], actionLabel: 'Check setup' },
  { id: 'source', title: 'Stage a source', description: 'Use Load sample files or add a supported file, then inspect the proposal.', fields: [], actionLabel: 'Check staged source' },
  { id: 'import', title: 'Keep a reviewed import', description: 'Use Import reviewed plan in the import component before checking this step.', fields: [], actionLabel: 'Check import', optional: true },
] };
document.getElementById('quickstart').configure({ flow: quickstartFlow, submit: async request => {
  const expected = await stepRequest(quickstartFlow, request.stepId, request.values); if (expected.requestId !== request.requestId) throw new Error('Demo quickstart integrity mismatch');
  if (request.stepId === 'profile' && ![...setupReceipts.values()].some(value => value.request.flowId === 'initial-user' && value.request.stepId === 'profile')) throw new Error('Complete the first user setup step above');
  if (request.stepId === 'source' && !onboarding.reviewPlan) throw new Error('Stage a supported file and resolve its review first');
  if (request.stepId === 'import' && !imported) throw new Error('Import the reviewed plan in the component first');
  return { requestId: request.requestId, stepId: request.stepId, status: 'saved', receiptId: 'demo-quickstart-' + request.stepId };
} });
const tour = document.getElementById('guided-tour');
tour.configure({ steps: [
  { id: 'setup', title: 'Start with a person', description: 'A reusable setup flow waits for the application to acknowledge each saved step.', target: '#user-setup' },
  { id: 'files', title: 'Bring the first source', description: 'Sample files are explicitly labelled. Your own files still need review before a host commit.', target: '#sample-files' },
  { id: 'checklist', title: 'Keep the next step visible', description: 'Quickstart actions are acknowledged by the application; a guide is separate from permissions.', target: '#quickstart' },
] });
document.getElementById('start-tour').addEventListener('click', () => void tour.start());
window.addEventListener('pagehide', () => tour.close('pagehide'));
configureMigrationDemo(document);
