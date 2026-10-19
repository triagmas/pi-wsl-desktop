import { M0_METHODS } from './protocol';

/**
 * Renderer-facing method whitelist. Enforced twice: in the preload (before
 * any IPC leaves the renderer) and again in the main-process IPC handler —
 * a compromised renderer must not reach anything beyond M0 read-only calls.
 */
export function isAllowedRendererMethod(method: string): boolean {
  return (M0_METHODS as readonly string[]).includes(method);
}
