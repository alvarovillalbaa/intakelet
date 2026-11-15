import { initialSetup, OnboardingSession, type StepHandler } from '../../src/index.mjs';
import { defineOnboarding, type TourStep, type IntakeletSetupElement } from '../../src/onboarding-elements.mjs';
import { IntakeletSetup, IntakeletQuickstart, IntakeletTour } from '../../src/react.mjs';

const flow = initialSetup('user', { actorId: 'authored-actor', workspaceId: 'authored-workspace' });
const submit: StepHandler = async request => ({ requestId: request.requestId, stepId: request.stepId, status: 'saved', receiptId: 'authored-receipt' });
const session = new OnboardingSession({ flow, submit });
session.setDraft({ name: 'Authored example' });
void session.save({ name: 'Authored example' });
const constructors = defineOnboarding();
const setup: IntakeletSetupElement = new constructors.Setup();
setup.configure({ flow, submit });
const steps: TourStep[] = [{ id: 'one', title: 'A guide', description: 'A bounded guide.', target: '#authored-target' }];
const setupElement = IntakeletSetup({ flow, submit, onAcknowledged: detail => { const applied: boolean = detail.appliedToView; void applied; } });
const checklistFlow = { ...flow, id: 'quickstart', steps: [{ id: 'first', title: 'First action', fields: [] }] };
const checklistElement = IntakeletQuickstart({ flow: checklistFlow, submit });
const tourElement = IntakeletTour({ steps, active: true });
void [setupElement, checklistElement, tourElement];
// @ts-expect-error actor scope is required
initialSetup('company', { workspaceId: 'workspace' });
// @ts-expect-error custom elements require the acknowledged application handler
setup.configure({ flow });
