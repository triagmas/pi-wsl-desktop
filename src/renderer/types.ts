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
