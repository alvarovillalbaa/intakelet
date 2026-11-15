import { createGitHubIssuesSource, githubIssuesMigration, runMigration, syncMigration, MemoryMigrationHost, mapOutput } from '@alvarovillalbaa/intakelet';
import { createFileMigrationSource, fileMigration, type OutputRecipe } from '@alvarovillalbaa/intakelet/migration';
import { DirectoryAssetStore } from '@alvarovillalbaa/intakelet/migration/node';
const host = new MemoryMigrationHost({ workspaceId: 'workspace' });
const source = createGitHubIssuesSource({ owner: 'authored', repo: 'repo' });
const spec = githubIssuesMigration({ workspaceId: 'workspace', connectionId: 'issues', source });
void runMigration({ spec, source, host, review: batch => ({ decision: 'approve', batchId: batch.batchId }) });
void syncMigration({ spec, source, host, maxPolls: 2 });
const store = new DirectoryAssetStore({ directory: '/application-owned-assets' });
const uploads = await createFileMigrationSource({ collectionId: 'selection', files: [new File(['authored'], 'note.txt')], assetStore: store });
fileMigration({ workspaceId: 'workspace', connectionId: 'files', source: uploads });
const recipe: OutputRecipe = { id: 'custom', version: '1', schema: { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false, required: ['name'] }, fields: [{ from: ['name'], to: ['name'], transforms: ['trim'] }], key: [['name']] };
mapOutput({ name: 'Authored' }, recipe);
// @ts-expect-error An output mapping chooses source OR constant, never both.
recipe.fields.push({ from: ['name'], constant: 'other', to: ['name'] });
// @ts-expect-error Review cannot approve without the exact content-bound batch ID.
void runMigration({ spec, source, host, review: () => ({ decision: 'approve' }) });
// @ts-expect-error Runtime transform names are a fixed allowlist.
recipe.fields.push({ from: ['name'], to: ['name'], transforms: ['eval'] });
