import type { OnboardingFlow, OnboardingProgress, StepHandler } from './onboarding.mjs';
export * from './onboarding.mjs';
export interface FlowConfiguration { flow: OnboardingFlow; submit: StepHandler }
export interface IntakeletSetupElement extends HTMLElement { configure(config: FlowConfiguration): void; readonly progress: OnboardingProgress | null }
export interface IntakeletQuickstartElement extends HTMLElement { configure(config: FlowConfiguration): void; readonly progress: OnboardingProgress | null }
export interface TourStep { id: string; title: string; description: string; target: string; placement?: 'top' | 'bottom' }
export interface TourConfiguration { steps: TourStep[]; prepare?: (step: TourStep, options: { signal: AbortSignal }) => void | Promise<void>; onComplete?: () => void; onClose?: (detail: { reason: string; stepId: string }) => void }
export interface IntakeletTourElement extends HTMLElement { configure(config: TourConfiguration): void; start(stepId?: string): Promise<void>; close(reason?: string): void; readonly currentStep: string | null }
type Constructor<T> = CustomElementConstructor & { new(): T };
export declare function defineOnboarding(registry?: CustomElementRegistry): { Setup: Constructor<IntakeletSetupElement>; Quickstart: Constructor<IntakeletQuickstartElement>; Tour: Constructor<IntakeletTourElement> };
