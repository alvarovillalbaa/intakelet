import { createElement, useEffect, useRef } from 'react';
import { defineIntakelet } from './element.mjs';
import { defineOnboarding } from './onboarding-elements.mjs';
import { defineMigration } from './migration-elements.mjs';
import { canonical, requireValue } from './values.mjs';
export function Intakelet({ workspaceId, host, research, onCommit, className, id }) {
  const ref = useRef(null), commit = useRef(onCommit); commit.current = onCommit;
  useEffect(() => { defineIntakelet(); const element = ref.current; const listener = event => commit.current?.(event.detail); element.addEventListener('intakelet-commit', listener); element.configure({ workspaceId, host, ...(research ? { research } : {}) }); return () => element.removeEventListener('intakelet-commit', listener); }, [workspaceId, host, research]);
  return createElement('intakelet-onboarding', { ref, class: className, id });
}

function Flow({ flow, submit, onAcknowledged, onComplete, className, id, tag }) {
  const ref = useRef(null), callbacks = useRef({ flow, submit, onAcknowledged, onComplete }); callbacks.current = { flow, submit, onAcknowledged, onComplete };
  useEffect(() => {
    defineOnboarding(); const element = ref.current, identity = canonical(flow);
    const acknowledged = event => callbacks.current.onAcknowledged?.(event.detail), completed = event => { if (canonical(callbacks.current.flow) === identity) callbacks.current.onComplete?.(event.detail); };
    element.addEventListener('intakelet-onboarding-acknowledged', acknowledged); element.addEventListener('intakelet-onboarding-complete', completed);
    element.configure({ flow, submit: (...args) => { requireValue(canonical(callbacks.current.flow) === identity, 'stale_context', 'Onboarding context changed before the application action'); return callbacks.current.submit(...args); } });
    return () => { element.removeEventListener('intakelet-onboarding-acknowledged', acknowledged); element.removeEventListener('intakelet-onboarding-complete', completed); };
  }, [flow]);
  return createElement(tag, { ref, class: className, id });
}
export function IntakeletSetup(props) { return createElement(Flow, { ...props, tag: 'intakelet-setup' }); }
export function IntakeletQuickstart(props) { return createElement(Flow, { ...props, tag: 'intakelet-quickstart' }); }
export function IntakeletTour({ steps, prepare, onComplete, onClose, active = false, startStepId, className, id }) {
  const ref = useRef(null), callbacks = useRef({ steps, prepare, onComplete, onClose }); callbacks.current = { steps, prepare, onComplete, onClose };
  useEffect(() => {
    defineOnboarding(); const identity = canonical(steps);
    ref.current.configure({ steps, prepare: (...args) => { requireValue(canonical(callbacks.current.steps) === identity, 'stale_context', 'Tour steps changed before preparation'); return callbacks.current.prepare?.(...args); }, onComplete: () => { if (canonical(callbacks.current.steps) === identity) callbacks.current.onComplete?.(); }, onClose: detail => callbacks.current.onClose?.(detail) });
  }, [steps]);
  useEffect(() => { const element = ref.current; if (active) void element.start(startStepId); else element.close(); return () => element.close('react-cleanup'); }, [active, startStepId, steps]);
  return createElement('intakelet-tour', { ref, class: className, id });
}

export function IntakeletMigration({ spec, source, host, maxBatches, readTimeoutMs, reviewTimeoutMs, onAcknowledged, className, id }) {
  const ref = useRef(null), identity = canonical(spec), callbacks = useRef(null); callbacks.current = { identity, source, host, onAcknowledged };
  useEffect(() => {
    defineMigration(); const element = ref.current;
    const current = () => callbacks.current.identity === identity && callbacks.current.source === source && callbacks.current.host === host;
    const guard = () => requireValue(current(), 'stale_context', 'Migration context changed before the application action');
    const guardedSource = { identity: source.identity, readPage: (...args) => { guard(); return source.readPage(...args); } };
    const guardedHost = Object.fromEntries(['status', 'claim', 'renew', 'release', 'readRecords', 'commitBatch'].map(method => [method, (...args) => { if (method !== 'release') guard(); return host[method](...args); }]));
    const acknowledged = event => callbacks.current.onAcknowledged?.({ ...event.detail, appliedToView: event.detail.appliedToView && current() });
    element.addEventListener('intakelet-migration-acknowledged', acknowledged);
    element.configure({ spec, source: guardedSource, host: guardedHost, ...(maxBatches === undefined ? {} : { maxBatches }), ...(readTimeoutMs === undefined ? {} : { readTimeoutMs }), ...(reviewTimeoutMs === undefined ? {} : { reviewTimeoutMs }) });
    return () => { element.cancel('react-cleanup'); element.removeEventListener('intakelet-migration-acknowledged', acknowledged); };
  }, [identity, source, host, maxBatches, readTimeoutMs, reviewTimeoutMs]);
  return createElement('intakelet-migration', { ref, class: className, id });
}
