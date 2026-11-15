import type { SourceInput, Host, Plan, ResearchAdapter, ResearchOptions, ResearchReport } from './index.mjs';
export interface Configuration { workspaceId: string; host: Host; research?: ResearchAdapter }
export interface IntakeletElement extends HTMLElement { configure(config: Configuration): void; refresh(): Promise<void>; addSources(sources: SourceInput[]): Promise<void>; readonly reviewPlan: Plan | null }
export declare function defineIntakelet(registry?: CustomElementRegistry): CustomElementConstructor & { new(): IntakeletElement };
export declare function createIndexedDBHost(options: { workspaceId: string; databaseName?: string }): Host & { exportRaw(): Promise<unknown>; close(): void };
export declare function researchSameOrigin(url: string, options?: ResearchOptions): Promise<ResearchReport>;
export { defineOnboarding } from './onboarding-elements.mjs';
export { defineMigration, type IntakeletMigrationElement, type MigrationElementConfiguration, type MigrationAcknowledged } from './migration-api.mjs';
