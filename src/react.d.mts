import type { ReactElement } from 'react';
import type { Host, Receipt, ResearchAdapter } from './index.mjs';
export interface IntakeletProps { workspaceId: string; host: Host; research?: ResearchAdapter; onCommit?: (receipt: Receipt) => void; className?: string; id?: string }
export declare function Intakelet(props: IntakeletProps): ReactElement;
import type { OnboardingFlow, OnboardingProgress, OnboardingScope, StepHandler, StepAcknowledgement } from './onboarding.mjs';
import type { TourConfiguration } from './onboarding-elements.mjs';
export interface OnboardingAcknowledged extends StepAcknowledgement { flowId: string; flowVersion: string; scope: OnboardingScope; appliedToView: boolean }
export interface OnboardingCompleted { flowId: string; scope: OnboardingScope; progress: OnboardingProgress }
export interface OnboardingProps { flow: OnboardingFlow; submit: StepHandler; onAcknowledged?: (detail: OnboardingAcknowledged) => void; onComplete?: (detail: OnboardingCompleted) => void; className?: string; id?: string }
export declare function IntakeletSetup(props: OnboardingProps): ReactElement;
export declare function IntakeletQuickstart(props: OnboardingProps): ReactElement;
export interface IntakeletTourProps extends TourConfiguration { active?: boolean; startStepId?: string; className?: string; id?: string }
export declare function IntakeletTour(props: IntakeletTourProps): ReactElement;
import type { MigrationElementConfiguration, MigrationAcknowledged } from './migration-api.mjs';
export interface IntakeletMigrationProps extends MigrationElementConfiguration { onAcknowledged?: (detail: MigrationAcknowledged) => void; className?: string; id?: string }
export declare function IntakeletMigration(props: IntakeletMigrationProps): ReactElement;
