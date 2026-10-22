/**
 * M3 R04 contract: typed Desktop↔WSL IPC for external module discovery and
 * enable/disable persistence (Issue #10, PR #11 R04).
 *
 * The bridge owns both paths: `listModules` takes NO parameters (no
 * caller-controlled path can reach the filesystem) and `setModuleState` only
 * accepts a strict {id, enabled} pair — every other shape fails closed.
 */
import { describe, expect, it } from 'vitest';
import { ALL_METHODS, M3_METHODS } from '../../src/shared/codes';
import { isAllowedRendererMethod } from '../../src/shared/whitelist';
import {
  ListModulesParamsSchema,
  ListModulesResultSchema,
  MAX_MODULE_DIAGNOSTICS,
  MAX_MODULE_FILE_BYTES,
  MAX_MODULE_FILES,
  MODULES_SUBDIR,
  MODULE_STATE_SUBPATH,
  SetModuleStateParamsSchema,
  SetModuleStateResultSchema,
  STATE_FILE_VERSION,
} from '../../src/shared/m3Ipc';

interface ResultPayload {
  available: boolean;
  files: Array<{ file: string; status: string; raw?: unknown; errors: string[] }>;
  diagnostics: string[];
  state: Record<string, boolean>;
}

function validResult(): ResultPayload {
  return {
    available: true,
    files: [
      { file: 'alpha.json', status: 'ok', raw: { id: 'alpha' }, errors: [] },
      { file: 'link.json', status: 'error', errors: ['symlink rejected (not a regular file)'] },
    ],
    diagnostics: ['module files limit (64) reached; extra files ignored'],
    state: { alpha: false },
  };
}

describe('m3Ipc — method allowlist', () => {
  it('declares exactly the two M3 methods and ALL_METHODS carries them', () => {
    expect([...M3_METHODS]).toEqual(['listModules', 'setModuleState']);
    for (const method of M3_METHODS) {
      expect(ALL_METHODS as readonly string[]).toContain(method);
      expect(isAllowedRendererMethod(method)).toBe(true);
    }
  });

  it('keeps unknown lookalikes out of the renderer whitelist', () => {
    expect(isAllowedRendererMethod('listModulesX')).toBe(false);
    expect(isAllowedRendererMethod('setModuleState2')).toBe(false);
    expect(isAllowedRendererMethod('writeModuleState')).toBe(false);
  });
});

describe('m3Ipc — bridge-owned locations and bounds', () => {
  it('pins the app-owned (non-~/.pi) state locations and caps', () => {
    expect(MODULES_SUBDIR).toBe('.pi-desktop/modules');
    expect(MODULE_STATE_SUBPATH).toBe('.pi-desktop/module-state.json');
    expect(MAX_MODULE_FILE_BYTES).toBe(65_536);
    expect(MAX_MODULE_FILES).toBe(64);
    expect(MAX_MODULE_DIAGNOSTICS).toBe(64);
    expect(STATE_FILE_VERSION).toBe(1);
  });
});

describe('m3Ipc — params schemas are strict', () => {
  it('listModules accepts only an empty params object', () => {
    expect(ListModulesParamsSchema.safeParse({}).success).toBe(true);
    expect(ListModulesParamsSchema.safeParse({ root: '/etc' }).success).toBe(false);
    expect(ListModulesParamsSchema.safeParse({ path: '../x' }).success).toBe(false);
  });

  it('setModuleState accepts {id, enabled} and nothing else', () => {
    expect(SetModuleStateParamsSchema.safeParse({ id: 'alpha', enabled: false }).success).toBe(true);
    expect(SetModuleStateParamsSchema.safeParse({}).success).toBe(false);
    expect(SetModuleStateParamsSchema.safeParse({ id: 'alpha' }).success).toBe(false);
    expect(SetModuleStateParamsSchema.safeParse({ id: '../evil', enabled: true }).success).toBe(false);
    expect(SetModuleStateParamsSchema.safeParse({ id: 'UPPER', enabled: true }).success).toBe(false);
    expect(SetModuleStateParamsSchema.safeParse({ id: 'alpha', enabled: 'yes' }).success).toBe(false);
    expect(SetModuleStateParamsSchema.safeParse({ id: 'alpha', enabled: true, extra: 1 }).success).toBe(false);
  });

  it('setModuleState result echoes the saved pair', () => {
    expect(SetModuleStateResultSchema.safeParse({ id: 'alpha', enabled: true }).success).toBe(true);
    expect(SetModuleStateResultSchema.safeParse({ id: 'alpha' }).success).toBe(false);
  });
});

describe('m3Ipc — result schema is bounded and fail-closed', () => {
  it('accepts a full valid payload', () => {
    expect(ListModulesResultSchema.safeParse(validResult()).success).toBe(true);
  });

  it('rejects an unknown file status', () => {
    const payload = validResult();
    payload.files[0]!.status = 'bogus';
    expect(ListModulesResultSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects more than MAX_MODULE_FILES file entries', () => {
    const payload = validResult();
    payload.files = Array.from({ length: MAX_MODULE_FILES + 1 }, (_, i) => ({
      file: `f${i}.json`,
      status: 'ok' as const,
      raw: {},
      errors: [],
    }));
    expect(ListModulesResultSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects more than MAX_MODULE_DIAGNOSTICS diagnostics', () => {
    const payload = validResult();
    payload.diagnostics = Array.from({ length: MAX_MODULE_DIAGNOSTICS + 1 }, (_, i) => `diag ${i}`);
    expect(ListModulesResultSchema.safeParse(payload).success).toBe(false);
  });

  it('rejects a state record over 512 entries or with a non-slug key', () => {
    const payload = validResult();
    payload.state = Object.fromEntries(
      Array.from({ length: 513 }, (_, i): [string, boolean] => [`m${i}`, true]),
    );
    expect(ListModulesResultSchema.safeParse(payload).success).toBe(false);
    expect(ListModulesResultSchema.safeParse({ ...validResult(), state: { '../x': true } }).success).toBe(false);
  });
});
