import { ALL_METHODS } from './codes';

/**
 * Renderer-facing method whitelist. Enforced twice: in the preload (before
 * any IPC leaves the renderer) and again in the main-process IPC handler —
 * a compromised renderer must not reach anything beyond M0 read-only calls
 * plus the M1 Sessions & Chat surface. The M1 write boundary
 * (openSession/sendPrompt/interrupt) is intentionally reachable here: it is
 * driven by explicit user gestures and gated a second time by bridge policy
 * (SESSION_CONFLICT / RESOURCE_BUSY / active-write re-checks).
 */
export function isAllowedRendererMethod(method: string): boolean {
  return (ALL_METHODS as readonly string[]).includes(method);
}
