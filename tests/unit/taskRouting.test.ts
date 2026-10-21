/**
 * Task routing — task_type → model role → requested thinking (Issue #12,
 * plan Tasks 1-2).
 *
 * Process tooling for dispatching real development work across the four
 * target levels (off/low/medium/high) using Pi's NATIVE controls
 * (`--thinking`, `--model <id>:<level>`, RPC `set_thinking_level` +
 * `get_available_thinking_levels` readback). This is NOT a new runtime
 * router: it is the fail-closed gate that decides whether a requested
 * level can actually be assigned on the installed Pi + configured model,
 * refuses to report silent success when Pi would clamp, and blocks
 * code/security/review work from running below high.
 *
 * RED first: written before scripts/lib/taskRouting.ts exists.
 */
import { describe, expect, it } from 'vitest';
import {
  TASK_MATRIX,
  assertLevelAllowsWrite,
  classifyTaskType,
  escalateForSourceEdit,
  formatHandoff,
  planThinkingAssignment,
} from '../../scripts/lib/taskRouting';

describe('TASK_MATRIX (owner-approved 4-level policy)', () => {
  it('maps each task type to the owner-approved role and target level', () => {
    expect(TASK_MATRIX.mechanical).toMatchObject({ target: 'off' });
    expect(TASK_MATRIX.documentation).toMatchObject({ target: 'low' });
    expect(TASK_MATRIX.analysis).toMatchObject({ target: 'medium' });
    expect(TASK_MATRIX.coding).toMatchObject({ target: 'high' });
    expect(TASK_MATRIX.security).toMatchObject({ target: 'high' });
    expect(TASK_MATRIX.review).toMatchObject({ target: 'high' });
  });

  it('prefers the MiMo coding role for coding work (no provider id published)', () => {
    expect(TASK_MATRIX.coding.role).toBe('CODING');
    expect(TASK_MATRIX.review.role).toBe('INDEPENDENT_REVIEW');
  });

  it('classifies known task types and rejects unknown ones', () => {
    expect(classifyTaskType('coding')).toBe('coding');
    expect(classifyTaskType('security')).toBe('security');
    expect(() => classifyTaskType('refactor-unknown' as never)).toThrow(/unknown/i);
  });

  it('keeps targets monotone off < low < medium < high across the ladder', () => {
    const order = ['off', 'low', 'medium', 'high'];
    const ladder = ['mechanical', 'documentation', 'analysis', 'coding'] as const;
    const targets = ladder.map((t) => TASK_MATRIX[t].target);
    for (let i = 1; i < targets.length; i++) {
      expect(order.indexOf(targets[i])).toBeGreaterThan(order.indexOf(targets[i - 1]));
    }
  });
});

describe('escalateForSourceEdit (risk growth never lowers the level)', () => {
  it('reclassifies light tasks as coding when they turn into source edits', () => {
    for (const t of ['mechanical', 'documentation', 'analysis'] as const) {
      expect(escalateForSourceEdit(t)).toBe('coding');
    }
  });

  it('keeps coding/security/review as-is', () => {
    expect(escalateForSourceEdit('coding')).toBe('coding');
    expect(escalateForSourceEdit('security')).toBe('security');
    expect(escalateForSourceEdit('review')).toBe('review');
  });
});

describe('assertLevelAllowsWrite (fail-closed minimum level gate)', () => {
  it('blocks coding/security/review below high, including unknown readback', () => {
    expect(() => assertLevelAllowsWrite('coding', 'off')).toThrow(/high/i);
    expect(() => assertLevelAllowsWrite('coding', 'low')).toThrow(/high/i);
    expect(() => assertLevelAllowsWrite('security', 'medium')).toThrow(/high/i);
    expect(() => assertLevelAllowsWrite('review', 'low')).toThrow(/high/i);
    expect(() => assertLevelAllowsWrite('coding', null)).toThrow(/high/i);
  });

  it('allows coding/security/review at high', () => {
    expect(() => assertLevelAllowsWrite('coding', 'high')).not.toThrow();
    expect(() => assertLevelAllowsWrite('security', 'high')).not.toThrow();
    expect(() => assertLevelAllowsWrite('review', 'high')).not.toThrow();
  });

  it('allows mechanical/documentation/analysis at their own targets', () => {
    expect(() => assertLevelAllowsWrite('mechanical', 'off')).not.toThrow();
    expect(() => assertLevelAllowsWrite('documentation', 'low')).not.toThrow();
    expect(() => assertLevelAllowsWrite('analysis', 'medium')).not.toThrow();
  });
});

describe('planThinkingAssignment (fail-closed readback gate)', () => {
  it('accepts a requested level present in the available list', () => {
    expect(planThinkingAssignment('high', ['off', 'high'])).toEqual({ status: 'ok', level: 'high' });
    expect(planThinkingAssignment('off', ['off', 'high'])).toEqual({ status: 'ok', level: 'off' });
  });

  it('rejects low/medium when the model map only offers off/high', () => {
    for (const level of ['low', 'medium'] as const) {
      const r = planThinkingAssignment(level, ['off', 'high']);
      expect(r.status).toBe('UNSUPPORTED');
      if (r.status === 'UNSUPPORTED') {
        expect(r.requested).toBe(level);
        expect(r.available).toEqual(['off', 'high']);
        // Pi would clamp UP to high — that must never be reported as success.
        expect(r.clampedTo).toBe('high');
      }
    }
  });

  it('accepts low/medium when the model really offers them', () => {
    expect(planThinkingAssignment('low', ['off', 'low', 'medium', 'high'])).toEqual({
      status: 'ok',
      level: 'low',
    });
    expect(planThinkingAssignment('medium', ['low', 'medium', 'high'])).toEqual({
      status: 'ok',
      level: 'medium',
    });
  });

  it('fails closed on an empty or missing available list', () => {
    expect(planThinkingAssignment('high', []).status).toBe('MAPPING_NEEDS_REVIEW');
    expect(planThinkingAssignment('high', undefined as never).status).toBe('MAPPING_NEEDS_REVIEW');
  });

  it('treats a requested level Pi would clamp downward as UNSUPPORTED', () => {
    const r = planThinkingAssignment('off', ['low', 'medium']);
    expect(r.status).toBe('UNSUPPORTED');
    if (r.status === 'UNSUPPORTED') expect(r.clampedTo).toBe('low');
  });
});

describe('formatHandoff (sanitized task handoff record)', () => {
  it('records task_type, role, requested and effective without provider data', () => {
    const plan = planThinkingAssignment('low', ['off', 'high']);
    const line = formatHandoff('documentation', 'low', plan);
    expect(line).toContain('task_type=documentation');
    expect(line).toContain('role=PRIMARY');
    expect(line).toContain('requested=low');
    expect(line).toContain('status=UNSUPPORTED');
    expect(line).toContain('effective=high'); // what Pi would clamp to — disclosed, not silent
    expect(line).not.toMatch(/provider|modelId|token|secret/i);
  });

  it('records a clean effective level when the assignment is ok', () => {
    const plan = planThinkingAssignment('off', ['off', 'high']);
    const line = formatHandoff('mechanical', 'off', plan);
    expect(line).toContain('status=ok');
    expect(line).toContain('effective=off');
  });

  it('reports MAPPING_NEEDS_REVIEW with unknown effective (fail closed)', () => {
    const plan = planThinkingAssignment('high', []);
    const line = formatHandoff('coding', 'high', plan);
    expect(line).toContain('status=MAPPING_NEEDS_REVIEW');
    expect(line).toContain('effective=UNKNOWN');
  });
});
