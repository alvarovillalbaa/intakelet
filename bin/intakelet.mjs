#!/usr/bin/env node
import { open, lstat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, resolve } from 'node:path';
import { analyzeFiles, createPlan, verifyPlan, MemoryHost, searchKnowledge, parseJSON, canonical, LIMITS } from '../src/index.mjs';
import { researchWebsite } from '../src/node.mjs';
import { requireValue } from '../src/values.mjs';
const args = process.argv.slice(2), command = args.shift(), flags = new Map(), positional = [];
const grammar = { inspect: ['workspace', 'out', 'research'], plan: ['out', 'review', 'skip-invalid'], research: ['out', 'max-pages'], apply: ['out', 'workspace', 'state', 'expected-revision'], search: ['out'] };
const usage = `intakelet inspect --workspace ID --out draft.json FILES…
intakelet inspect --workspace ID --research website-report.json --out draft.json
intakelet plan draft.json --out plan.json [--review review.json | --skip-invalid]
intakelet research https://your-site.com/ --out website-report.json [--max-pages 8]
intakelet apply plan.json --workspace ID --expected-revision 0 --out result.json [--state state.json]
intakelet search state.json QUERY --out matches.json
Outputs must be new files. apply writes a new reference-host snapshot; it never overwrites a database.`;
let output;
async function readText(path, budget) {
  const resolved = resolve(path), before = await lstat(resolved); requireValue(before.isFile() && !before.isSymbolicLink() && before.size <= budget, 'input_file', 'Input must be a bounded regular file, not a symlink');
  const handle = await open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); requireValue(stat.dev === before.dev && stat.ino === before.ino && stat.isFile() && stat.size <= budget, 'input_file', 'Input changed before reading'); const data = await handle.readFile(); requireValue(data.length <= budget, 'input_file', 'Input exceeded its byte budget'); return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data); } finally { await handle.close(); }
}
const data = async path => parseJSON(await readText(path, 16777216), 16777216);
try {
  if (!command || command === '--help' || command === 'help') { console.log(usage); process.exit(0); }
  requireValue(Object.hasOwn(grammar, command), 'command', 'Unknown command. Use intakelet --help');
  while (args.length) {
    const token = args.shift(); if (token === '--') { positional.push(...args); args.length = 0; break; }
    if (!token.startsWith('--')) { positional.push(token); continue; }
    const name = token.slice(2); requireValue(grammar[command].includes(name) && !flags.has(name), 'option', 'Unknown or repeated command option');
    if (name === 'skip-invalid') flags.set(name, true);
    else { const value = args.shift(); requireValue(value && !value.startsWith('--'), 'option', 'Option needs an explicit value'); flags.set(name, value); }
  }
  requireValue(flags.has('out'), 'output', 'Choose --out for a new output file');
  requireValue(command === 'inspect' ? flags.has('research') ? positional.length === 0 : positional.length > 0 && positional.length <= LIMITS.files : command === 'search' ? positional.length === 2 : positional.length === 1, 'arguments', 'Command arguments do not match --help');
  if (['inspect', 'apply'].includes(command)) requireValue(flags.has('workspace'), 'workspace', 'Pass the trusted target --workspace explicitly');
  if (command === 'plan') requireValue(!(flags.has('review') && flags.has('skip-invalid')), 'review', 'Choose a review file or --skip-invalid');
  output = await open(resolve(flags.get('out')), 'wx', 0o600);
  let result, exit = 0;
  if (command === 'inspect') {
    let sources;
    if (flags.has('research')) { const report = await data(flags.get('research')); requireValue(report?.schema === 'intakelet.research' && report.version === 1 && Array.isArray(report.files), 'research', 'Expected a research report; supplied URL annotations are not authenticated provenance'); sources = report.files; }
    else { sources = []; for (const path of positional) sources.push({ name: basename(path), text: await readText(path, LIMITS.fileBytes) }); }
    result = await analyzeFiles(sources, { workspaceId: flags.get('workspace') });
  } else if (command === 'plan') result = await createPlan(await data(positional[0]), flags.has('review') ? await data(flags.get('review')) : { skipInvalid: flags.get('skip-invalid') === true });
  else if (command === 'research') { const maxPages = flags.has('max-pages') ? Number(flags.get('max-pages')) : 8; result = await researchWebsite(positional[0], { maxPages }); if (!result.files.length) exit = 2; }
  else if (command === 'apply') {
    requireValue(flags.has('expected-revision') && /^\d+$/.test(flags.get('expected-revision')), 'revision', 'Pass an explicit --expected-revision');
    const expectedRevision = Number(flags.get('expected-revision')); requireValue(Number.isSafeInteger(expectedRevision), 'revision', 'Revision exceeds the safe integer range');
    const plan = await verifyPlan(await data(positional[0])), stateInput = flags.has('state') ? await data(flags.get('state')) : undefined;
    const host = new MemoryHost({ workspaceId: flags.get('workspace'), ...(stateInput ? { state: stateInput.state ?? stateInput } : {}) });
    const receipt = await host.commit(plan, { expectedRevision }); result = { schema: 'intakelet.applied', version: 1, receipt, state: await host.snapshot() };
  } else { const input = await data(positional[0]), state = input.state ?? input; const host = new MemoryHost({ workspaceId: state.workspaceId, state }); result = { schema: 'intakelet.search', version: 1, hits: searchKnowledge((await host.snapshot()).articles, positional[1]) }; }
  await output.writeFile(canonical(result) + '\n'); await output.sync(); console.log(JSON.stringify({ command, output: flags.get('out'), schema: result.schema, ...(result.planId ? { planId: result.planId } : {}), ...(result.status ? { status: result.status } : {}) })); process.exitCode = exit;
} catch (error) {
  if (output) { try { const diagnostic = canonical({ schema: 'intakelet.command-error', version: 1, code: error.code || 'error', message: error.message }) + '\n'; await output.truncate(0); await output.write(diagnostic, 0, 'utf8'); await output.sync(); } catch {} }
  console.error(`${error.code || 'error'}: ${error.message}`); process.exitCode = 1;
} finally { await output?.close(); }
