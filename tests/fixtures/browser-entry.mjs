// T2 application fixture. Imports are resolved from the actual installed archive.
import * as core from '@alvarovillalbaa/intakelet';
import * as element from '@alvarovillalbaa/intakelet/element';
import { Intakelet } from '@alvarovillalbaa/intakelet/react';
import { createElement, StrictMode, version } from 'react';
import { createRoot } from 'react-dom/client';
element.defineIntakelet();
window.sdk = { ...core, ...element };
window.reactVersion = version;
const root = createRoot(document.getElementById('react-root'));
window.renderIntakelet = props => root.render(createElement(StrictMode, null, createElement(Intakelet, props)));
window.unmountIntakelet = () => root.unmount();
window.fixtureReady = true;
