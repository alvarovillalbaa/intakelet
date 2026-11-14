import { defineIntakelet, createIndexedDBHost, researchSameOrigin } from '../src/element.mjs';
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
