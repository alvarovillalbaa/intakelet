import { OnboardingSession, initialSetup, MemoryMigrationHost, runMigration } from '@alvarovillalbaa/intakelet';
import { DirectoryAssetStore, createFileMigrationSource, fileMigration } from '@alvarovillalbaa/intakelet/migration/node';
const flow = initialSetup('user', { actorId: 'authored', workspaceId: 'node-only' });
const session = new OnboardingSession({ flow, submit: request => ({ requestId: request.requestId, stepId: request.stepId, status: 'saved', receiptId: 'authored' }) });
const store = new DirectoryAssetStore({ directory: '/application-owned-assets' });
const source = await createFileMigrationSource({ collectionId: 'authored', files: [new File(['authored'], 'example.txt')], assetStore: store });
const spec = fileMigration({ workspaceId: 'node-only', connectionId: 'files', source });
void runMigration({ spec, source, host: new MemoryMigrationHost({ workspaceId: 'node-only' }), review: batch => ({ decision: 'approve', batchId: batch.batchId }) });
void session;
