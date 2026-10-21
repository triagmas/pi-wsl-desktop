import { ALL_METHODS } from './codes';

/**
 * Renderer-facing method whitelist. Enforced twice: in the preload (before
 * any IPC leaves the renderer) and again in the main-process IPC handler —
 * a compromised renderer must not reach anything beyond M0 read-only calls
 * plus the M1 Sessions & Chat surface and the M2 resource surface. The M1
 * write boundary (openSession/sendPrompt/interrupt) and the M2 write
 * boundary (previewResourceOp/applyResourceOp/rollbackResourceOp) are
 * intentionally reachable here: they are driven by explicit user gestures
 * and gated a second time by bridge policy (SESSION_CONFLICT / RESOURCE_BUSY
 * / active-write re-checks for M1; for M2: literal confirm: true + single-use
 * expiring plan + backup/rollback — resource ops have no busy-gate, they are
 * serialized only by their own plan lifecycle).
 */
export function isAllowedRendererMethod(method: string): boolean {
  return (ALL_METHODS as readonly string[]).includes(method);
}
