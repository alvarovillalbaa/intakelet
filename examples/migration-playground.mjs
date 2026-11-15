import { defineMigration, MemoryMigrationHost, createFileMigrationSource, fileMigration, fileOutputFields, buildFileOutput } from '../src/migration-api.mjs';
import { aborted, sha256, requireValue } from '../src/values.mjs';

// Bounded session-only playground adapter. It never uploads or executes bytes.
export function demoAssetStore({ maxAssetBytes = 2097152, maxStoredBytes = 8388608 } = {}) {
  const assets = new Map(); let storedBytes = 0;
  return {
    get bytes() { return storedBytes; },
    async put(file, { signal } = {}) {
      aborted(signal); requireValue(Number.isSafeInteger(file.size) && file.size >= 0 && file.size <= maxAssetBytes, 'demo_budget', 'This browser example accepts at most 2MiB per file. Use your application asset adapter for larger files.');
      const bytes = new Uint8Array(await file.arrayBuffer()); aborted(signal); requireValue(bytes.byteLength === file.size, 'asset_size', 'File bytes do not match the selected upload');
      const digest = 'sha256:' + await sha256(bytes); aborted(signal);
      if (!assets.has(digest)) { requireValue(storedBytes + bytes.byteLength <= maxStoredBytes, 'demo_budget', 'This tab example reached its 8MiB asset budget. Earlier acknowledged batches remain committed.'); assets.set(digest, bytes); storedBytes += bytes.byteLength; }
      return { assetId: digest, sha256: digest, bytes: bytes.byteLength };
    }
  };
}
export async function demoTextDecoder({ file, signal }) {
  if (!/\.(?:txt|md|markdown|csv|json)$/i.test(file.name)) return { text: null };
  requireValue(file.size <= 262144, 'demo_text', 'Text extraction in this example admits 256KiB per file. Disable text extraction to retain larger files as attachments.');
  aborted(signal); const bytes = await file.arrayBuffer(); aborted(signal);
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }; }
  catch { throw new Error('Cannot decode the selected text file as UTF-8: ' + file.name); }
}

export function configureMigrationDemo(document) {
  defineMigration(); const component = document.getElementById('bulk-migration'), picker = document.getElementById('bulk-files'), form = document.getElementById('bulk-configuration'), fields = document.getElementById('output-fields'), key = document.getElementById('output-key'), status = document.getElementById('bulk-status'), preview = document.getElementById('output-preview');
  const catalog = fileOutputFields(), listeners = [], rowListeners = []; let rows = [{ source: 'fileId', target: 'externalId' }, { source: 'name', target: 'file.name' }, { source: 'assetId', target: 'file.asset' }, { source: 'bytes', target: 'file.bytes' }], generation = 0;
  const listen = (target, type, callback, owned = listeners) => { target.addEventListener(type, callback); owned.push(() => target.removeEventListener(type, callback)); };
  const make = (tag, text) => { const value = document.createElement(tag); if (text !== undefined) value.textContent = text; return value; };
  const reset = () => { generation++; component.cancel('configuration changed'); component.hidden = true; preview.textContent = ''; status.textContent = 'Configuration changed. Prepare this selection to review a new migration.'; document.getElementById('bulk-configure').disabled = false; };
  const keys = () => { const previous = key.value; key.replaceChildren(); for (const row of rows) { const option = make('option', row.target || 'Unnamed field'); option.value = row.target; key.append(option); } key.value = rows.some(row => row.target === previous) ? previous : rows[0]?.target ?? ''; };
  const renderFields = () => {
    rowListeners.splice(0).forEach(remove => remove());
    fields.replaceChildren();
    rows.forEach((row, index) => {
      const item = make('div'); item.className = 'output-field'; const targetLabel = make('label', 'Destination path'), input = make('input'); input.value = row.target; input.maxLength = 800; input.required = true; listen(input, 'input', () => { row.target = input.value; keys(); reset(); }, rowListeners); targetLabel.append(input);
      const sourceLabel = make('label', 'Source value'), select = make('select'); for (const source of catalog) { const option = make('option', source.label); option.value = source.source; select.append(option); } select.value = row.source; listen(select, 'change', () => { row.source = select.value; reset(); }, rowListeners); sourceLabel.append(select);
      const remove = make('button', 'Remove'); remove.type = 'button'; remove.disabled = rows.length === 1; remove.setAttribute('aria-label', 'Remove destination field ' + (index + 1)); listen(remove, 'click', () => { rows.splice(index, 1); renderFields(); reset(); }, rowListeners); item.append(targetLabel, sourceLabel, remove); fields.append(item);
    }); keys(); document.getElementById('output-add').disabled = rows.length >= 20;
  };
  listen(document.getElementById('output-add'), 'click', () => { if (rows.length < 20) { rows.push({ source: 'name', target: 'field' + (rows.length + 1) }); renderFields(); reset(); } });
  for (const input of [picker, key, document.getElementById('output-namespace'), document.getElementById('bulk-text')]) listen(input, 'change', reset);
  listen(document.getElementById('output-namespace'), 'input', reset);
  listen(component, 'intakelet-migration-acknowledged', event => {
    const receipt = event.detail.receipt, list = document.getElementById('bulk-receipts'), item = make('li', `${receipt.connectionId}: revision ${receipt.revision} · ${receipt.counts.created} created, ${receipt.counts.excluded} excluded${event.detail.appliedToView ? '' : ' · acknowledged outside the active view'}`); list.prepend(item); while (list.children.length > 10) list.lastElementChild.remove();
  });
  listen(form, 'submit', event => {
    event.preventDefault(); reset(); const current = generation, configure = document.getElementById('bulk-configure'); configure.disabled = true;
    void (async () => {
      try {
        const selected = Array.from(picker.files ?? []); requireValue(selected.length > 0, 'files', 'Choose one or more files first');
        const output = buildFileOutput({ id: document.getElementById('output-namespace').value, fields: rows.map(row => ({ ...row })), key: key.value }), decode = document.getElementById('bulk-text').checked;
        const collectionId = 'selection-' + crypto.randomUUID(), source = await createFileMigrationSource({ collectionId, files: selected, filesPerPage: 4, assetStore: demoAssetStore(), ...(decode ? { decode: demoTextDecoder, decoderVersion: 'utf8-demo-v1' } : {}) });
        if (current !== generation) return;
        const host = new MemoryMigrationHost({ workspaceId: 'migration-demo' }), spec = fileMigration({ workspaceId: 'migration-demo', connectionId: collectionId, source, output }); component.configure({ spec, source, host }); component.hidden = false;
        preview.textContent = JSON.stringify(output, null, 2); status.textContent = `${selected.length} file(s) selected. Review the generated output recipe and start the migration below. Nothing has been committed yet.`;
      } catch (error) { if (current === generation) status.textContent = error.message; }
      finally { if (current === generation) configure.disabled = false; }
    })();
  });
  const close = () => { reset(); component.cancel('pagehide'); }; listen(document.defaultView, 'pagehide', close); renderFields();
  return { dispose() { close(); listeners.splice(0).forEach(remove => remove()); rowListeners.splice(0).forEach(remove => remove()); } };
}
