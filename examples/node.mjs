import { analyzeFiles, createPlan } from '@alvarovillalbaa/intakelet';
import { researchWebsite } from '@alvarovillalbaa/intakelet/node';

// Call from an authenticated, rate-limited application endpoint. host must be
// bound to the trusted workspace; caller-provided workspace text is not auth.
export async function onboardWebsite({ url, workspaceId, host, review, expectedRevision, signal }) {
  const report = await researchWebsite(url, { signal });
  if (!report.files.length) return { report, imported: false };
  const draft = await analyzeFiles(report.files, { workspaceId, signal });
  const plan = await createPlan(draft, review);
  // Present plan/report to the user before invoking the returned commit.
  return { report, draft, plan, commit: () => host.commit(plan, { expectedRevision }) };
}
