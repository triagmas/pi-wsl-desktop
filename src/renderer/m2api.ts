/** Typed facade for the M2 resource-manager bridge surface (Issue #7). */
import type { DesktopApi } from './api';
import type {
  BuiltinInfoT,
  McpServerInfoT,
  PackageInfoT,
  ResourceOpPlanT,
  SkillInfoT,
} from './types';

const call = <T>(api: DesktopApi, method: string, params?: Record<string, unknown>): Promise<T> =>
  api.request(method, params) as Promise<T>;

export type PreviewOpInput =
  | { kind: 'package-install' | 'package-remove' | 'package-update'; source: string; local?: boolean }
  | { kind: 'mcp-add'; source: string; url?: string; command?: string[]; env?: Record<string, string>; local?: boolean }
  | { kind: 'mcp-remove'; source: string; local?: boolean }
  | { kind: 'skill-set'; source: string; disable?: boolean };

export const m2 = {
  listSkills: (api: DesktopApi): Promise<{ skills: SkillInfoT[]; diagnostics: string[] }> => call(api, 'listSkills'),
  listPackages: (api: DesktopApi): Promise<{ packages: PackageInfoT[]; builtins: BuiltinInfoT[]; settingsExtensions: string[]; diagnostics: string[] }> =>
    call(api, 'listPackages'),
  listMcpServers: (api: DesktopApi): Promise<{ servers: McpServerInfoT[]; builtinEnabled: boolean; logDiagnostics: string[]; diagnostics: string[] }> =>
    call(api, 'listMcpServers'),
  preview: (api: DesktopApi, input: PreviewOpInput): Promise<{ plan: ResourceOpPlanT }> =>
    call(api, 'previewResourceOp', input as Record<string, unknown>),
  apply: (api: DesktopApi, planId: string): Promise<{ ok: boolean; opId: string; output: string; backupId: string | null; filesTouched: string[]; verified: boolean }> =>
    call(api, 'applyResourceOp', { planId, confirm: true }),
  rollback: (api: DesktopApi, opId: string): Promise<{ ok: boolean; restored: string[]; conflicts?: string[] }> =>
    call(api, 'rollbackResourceOp', { opId, confirm: true }),
};
