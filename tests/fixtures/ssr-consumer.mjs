import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Intakelet } from '@alvarovillalbaa/intakelet/react';
import { MemoryHost } from '@alvarovillalbaa/intakelet';
assert.equal(typeof window, 'undefined');
const html = renderToString(createElement(Intakelet, { workspaceId: 'ssr', host: new MemoryHost({ workspaceId: 'ssr' }), id: 'ssr-onboarding' }));
assert.match(html, /intakelet-onboarding/); assert.match(html, /ssr-onboarding/); assert.doesNotMatch(html, /undefined|NaN/);
console.log(JSON.stringify({ serverRendered: true, browserGlobalRequired: false, html }));
