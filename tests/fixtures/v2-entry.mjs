// T2 browser application; all imports use the actual installed package exports.
import * as core from '@alvarovillalbaa/intakelet';
import * as guides from '@alvarovillalbaa/intakelet/onboarding';
import * as migration from '@alvarovillalbaa/intakelet/migration';
import { IntakeletSetup, IntakeletQuickstart, IntakeletTour, IntakeletMigration } from '@alvarovillalbaa/intakelet/react';
import { createElement, StrictMode, version } from 'react';
import { createRoot } from 'react-dom/client';
window.sdk = { ...core, ...guides, ...migration };
window.reactVersion = version;
const root = createRoot(document.getElementById('react-root'));
window.renderGuide = props => root.render(createElement(StrictMode, null, createElement(IntakeletSetup, props)));
window.renderMigration = props => root.render(createElement(StrictMode, null, createElement(IntakeletMigration, props)));
window.renderOtherGuides = props => root.render(createElement(StrictMode, null, createElement(IntakeletQuickstart, props.quickstart), createElement(IntakeletTour, props.tour)));
window.unmountSDK = () => root.unmount();
window.fixtureReady = true;
