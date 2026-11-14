import { createElement, useEffect, useRef } from 'react';
import { defineIntakelet } from './element.mjs';
export function Intakelet({ workspaceId, host, research, onCommit, className, id }) {
  const ref = useRef(null), commit = useRef(onCommit); commit.current = onCommit;
  useEffect(() => { defineIntakelet(); const element = ref.current; const listener = event => commit.current?.(event.detail); element.addEventListener('intakelet-commit', listener); element.configure({ workspaceId, host, ...(research ? { research } : {}) }); return () => element.removeEventListener('intakelet-commit', listener); }, [workspaceId, host, research]);
  return createElement('intakelet-onboarding', { ref, class: className, id });
}
