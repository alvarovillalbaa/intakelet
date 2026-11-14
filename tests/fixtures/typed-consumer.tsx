import { createElement } from 'react';
import { analyzeFiles, createPlan, MemoryHost, searchKnowledge, type Plan, type Mapping, type Host, type Receipt } from '@alvarovillalbaa/intakelet';
import { defineIntakelet, createIndexedDBHost, type IntakeletElement } from '@alvarovillalbaa/intakelet/element';
import { Intakelet } from '@alvarovillalbaa/intakelet/react';
import { researchWebsite } from '@alvarovillalbaa/intakelet/node';
const host: Host = new MemoryHost({ workspaceId: 'typed-consumer' });
const mapping: Mapping = { kind: 'contact', mapping: { email: 'Email' } };
// @ts-expect-error contacts require an email mapping
const invalidMapping: Mapping = { kind: 'contact', mapping: {} };
// @ts-expect-error a workspace must be an explicit string
new MemoryHost({ workspaceId: 7 });
export async function consume() {
  const draft = await analyzeFiles([{ name: 'note.md', text: '# Typed source\n\nA real source note.' }], { workspaceId: 'typed-consumer' });
  const plan: Plan = await createPlan(draft); const receipt: Receipt = await host.commit(plan, { expectedRevision: 0 });
  const state = await host.snapshot(); const hits = searchKnowledge(state.articles, 'source');
  for (const record of plan.records) if (record.kind === 'contact') record.data.email.toLowerCase();
  for (const article of plan.articles) if (article.method === 'exact_source') article.span.start.toFixed();
  // @ts-expect-error expected revision is a safe integer, not a string
  await host.commit(plan, { expectedRevision: 'zero' });
  return { receipt, hits, mapping };
}
export const component = createElement(Intakelet, { workspaceId: 'typed-consumer', host, onCommit: receipt => receipt.planId.toLowerCase() });
export function configureDOM(element: IntakeletElement) { defineIntakelet(); element.configure({ workspaceId: 'typed-consumer', host: createIndexedDBHost({ workspaceId: 'typed-consumer' }), research: researchWebsite }); }
