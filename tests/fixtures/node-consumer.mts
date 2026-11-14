import { analyzeFiles, createPlan, MemoryHost, type Receipt } from '@alvarovillalbaa/intakelet';
import { researchWebsite } from '@alvarovillalbaa/intakelet/node';
export async function onboard(url: string, signal?: AbortSignal): Promise<Receipt | null> {
  const report = await researchWebsite(url, { signal, maxPages: 4 });
  if (!report.files.length) return null;
  const draft = await analyzeFiles(report.files, { workspaceId: 'node-only', signal });
  const host = new MemoryHost({ workspaceId: 'node-only' });
  return host.commit(await createPlan(draft), { expectedRevision: 0 });
}
