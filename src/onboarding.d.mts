export interface OnboardingScope { actorId: string; workspaceId: string }
export interface SetupField { id: string; label: string; type: 'text' | 'email' | 'url' | 'textarea' | 'select' | 'checkbox'; required?: boolean; maxLength?: number; hint?: string; options?: Array<{ value: string; label: string }> }
export interface OnboardingStep { id: string; title: string; fields: SetupField[]; description?: string; optional?: boolean; actionLabel?: string }
export interface OnboardingFlow { id: string; version: string; scope: OnboardingScope; steps: OnboardingStep[]; title?: string; description?: string; sequential?: boolean }
export type StepValues = Record<string, string | boolean>;
export interface StepRequest { schema: 'intakelet.onboarding-step'; version: 1; flowId: string; flowVersion: string; scope: OnboardingScope; stepId: string; values: StepValues; requestId: string }
export interface StepAcknowledgement { requestId: string; stepId: string; status: 'saved'; receiptId: string }
export type StepHandler = (request: StepRequest, options: { signal?: AbortSignal }) => StepAcknowledgement | Promise<StepAcknowledgement>;
export interface OnboardingProgress { index: number; stepId: string | null; busy: boolean; complete: boolean; completed: string[]; skipped: string[]; values: StepValues; receipts: Array<{ requestId: string; stepId: string; receiptId: string }> }
export declare function validateFlow(input: unknown): OnboardingFlow;
export declare function validateStepValues(step: OnboardingStep, values: unknown, options?: { draft?: boolean }): StepValues;
export declare function stepRequest(flow: OnboardingFlow, stepId: string, values: StepValues): Promise<StepRequest>;
export declare class OnboardingSession {
  constructor(options: { flow: OnboardingFlow; submit: StepHandler });
  readonly definition: OnboardingFlow;
  snapshot(): OnboardingProgress;
  setDraft(values: StepValues): void;
  select(stepId: string): void;
  skip(): void;
  cancel(): void;
  dispose(): void;
  save(values: StepValues, options?: { signal?: AbortSignal }): Promise<{ applied: boolean; acknowledgement: StepAcknowledgement | null; request: StepRequest }>;
}
export declare function initialSetup(audience: 'user' | 'company', scope: OnboardingScope): OnboardingFlow;
export interface TourRect { x: number; y: number; width: number; height: number }
export declare function tourPosition(rect: TourRect, viewport: { width: number; height: number }, card?: { width: number; height: number }, preferred?: 'top' | 'bottom'): { x: number; y: number; width: number; maxHeight: number; placement: 'top' | 'bottom'; highlight: TourRect };
