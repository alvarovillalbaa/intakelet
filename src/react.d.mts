import type { ReactElement } from 'react';
import type { Host, Receipt, ResearchAdapter } from './index.mjs';
export interface IntakeletProps { workspaceId: string; host: Host; research?: ResearchAdapter; onCommit?: (receipt: Receipt) => void; className?: string; id?: string }
export declare function Intakelet(props: IntakeletProps): ReactElement;
