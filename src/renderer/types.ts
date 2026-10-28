/** Renderer-only view types (no Node imports — the renderer stays sandboxed). */

export type ConnPhase = 'idle' | 'discovering' | 'connecting' | 'ready' | 'backoff' | 'error';

export interface RuntimeInfo {
  distro?: string | null;
  node: { path: string; version: string };
  pi: { path: string; version: string; rpcSupported: boolean };
  agentDir?: string | null;
}

export interface RendererSnapshot {
  phase: ConnPhase;
  attempt: number;
  lastError?: { code: string; message: string };
  distro: string | null;
  distros: string[] | null;
  runtime: RuntimeInfo | null;
}

/* M1 Sessions & Chat — shared contract types (type-only, no zod runtime). */
export type {
  ProjectInfoT,
  SessionInfoT,
  SessionEntryT,
  ReadSessionResultT,
  SearchResultT,
  RpcStateT,
  ChatEventT,
  ModelInfoT,
} from '../shared/m1Protocol';

/* M2 Pi Resource Manager — shared contract types (type-only, no zod runtime). */
export type {
  SkillInfoT,
  SkillSourceT,
  PackageInfoT,
  BuiltinInfoT,
  McpServerInfoT,
  ResourceOpPlanT,
  ResourceOpKindT,
} from '../shared/m2Protocol';
