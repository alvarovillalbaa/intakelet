import { SQLiteMigrationHost, DirectoryAssetStore, type SQLiteMigrationHostOptions } from '@alvarovillalbaa/intakelet/migration/node';
import type { MigrationHost, MigrationSpec, MigrationBatch, MigrationLease } from '@alvarovillalbaa/intakelet/migration';
const options: SQLiteMigrationHostOptions = { directory: '/application-owned-example', workspaceId: 'example', leaseMs: 1000 };
async function inspect(spec: MigrationSpec, batch: MigrationBatch, lease: MigrationLease) {
  const host = await SQLiteMigrationHost.open(options);
  const contract: MigrationHost = host;
  await host.acceptRoute(spec, { acceptedBy: 'trusted-owner' });
  await contract.commitBatch(batch, { lease });
  await host.revokeRoute(spec.connectionId);
  await host.inspectBatch(batch.batchId);
  await host.close();
}
void inspect;
void DirectoryAssetStore;
