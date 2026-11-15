import { createElement } from 'react';
import { IntakeletMigration } from '@alvarovillalbaa/intakelet/react';
import { defineMigration as defineElementMigration } from '@alvarovillalbaa/intakelet/element';
import { defineMigration, createGitHubIssuesSource, githubIssuesMigration, MemoryMigrationHost, buildFileOutput, type MigrationAcknowledged } from '@alvarovillalbaa/intakelet/migration';
const source = createGitHubIssuesSource({ owner: 'authored', repo: 'repo' }), host = new MemoryMigrationHost({ workspaceId: 'workspace' }), spec = githubIssuesMigration({ source, workspaceId: 'workspace', connectionId: 'issues' });
const Constructor = defineMigration(); const element = new Constructor(); element.configure({ spec, source, host, maxBatches: 4 }); element.cancel(); void element.start();
const sameRegistration: typeof defineMigration = defineElementMigration; void sameRegistration;
createElement(IntakeletMigration, { spec, source, host, onAcknowledged: (detail: MigrationAcknowledged) => { const applied: boolean = detail.appliedToView; void applied; } });
buildFileOutput({ id: 'files', fields: [{ source: 'name', target: 'file.name' }], key: 'file.name' });
// @ts-expect-error Application source and host are required.
createElement(IntakeletMigration, { spec });
// @ts-expect-error Source field names come from the supported file catalog.
buildFileOutput({ id: 'files', fields: [{ source: 'invented', target: 'name' }], key: 'name' });
