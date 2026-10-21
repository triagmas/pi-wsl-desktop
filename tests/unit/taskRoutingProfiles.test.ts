/**
 * Task routing → existing builtin subagent profiles (Issue #12,
 * coordinator directive 2026-10-21).
 *
 * The dispatch proof chain uses pi-subagents' STANDARD frontmatter, not a
 * custom orchestrator: builtin profiles already declare `thinking`
 * (scout=low, researcher=medium, worker/reviewer/oracle/evidence-auditor=
 * high), and per-run overrides accept `model: <provider>/<id>:<level>`,
 * which pi-subagents applies to the child Pi process via
 * `applyThinkingSuffix` → `--model <fullId>:<level>` (source-verified in
 * pi-subagents@0.79.2; real past run recorded
 * `model=<provider>/<id>:high, thinking=high` in its launch contract).
 *
 * AGENT_PROFILES is the documented mapping from owner task classes to
 * those existing agents. It is pure data + a consistency linter; it does
 * not spawn anything and is not imported by runtime code.
 *
 * RED first: written before the export exists.
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_PROFILES,
  assertAgentProfileConsistent,
  type AgentProfileMap,
} from '../../scripts/lib/taskRouting';

describe('AGENT_PROFILES (task_type → builtin pi-subagents profile)', () => {
  it('maps every task type to an existing builtin agent and the matrix target level', () => {
    expect(Object.keys(AGENT_PROFILES).sort()).toEqual([
      'analysis',
      'coding',
      'documentation',
      'mechanical',
      'review',
      'security',
    ]);
    // Builtin agent names verified against pi-subagents@0.79.2 agents/.
    expect(AGENT_PROFILES.mechanical.agent).toBe('scout');
    expect(AGENT_PROFILES.mechanical.thinking).toBe('off');
    expect(AGENT_PROFILES.documentation.agent).toBe('scout');
    expect(AGENT_PROFILES.documentation.thinking).toBe('low');
    expect(AGENT_PROFILES.analysis.agent).toBe('researcher');
    expect(AGENT_PROFILES.analysis.thinking).toBe('medium');
    expect(AGENT_PROFILES.coding.agent).toBe('worker');
    expect(AGENT_PROFILES.coding.thinking).toBe('high');
    expect(AGENT_PROFILES.security.agent).toBe('oracle');
    expect(AGENT_PROFILES.security.thinking).toBe('high');
    expect(AGENT_PROFILES.review.agent).toBe('reviewer');
    expect(AGENT_PROFILES.review.thinking).toBe('high');
  });

  it('records where each profile value comes from (frontmatter vs per-run override)', () => {
    // scout's frontmatter is low; mechanical needs off → per-run override.
    expect(AGENT_PROFILES.mechanical.source).toBe('per-run-override');
    expect(AGENT_PROFILES.documentation.source).toBe('frontmatter');
    expect(AGENT_PROFILES.analysis.source).toBe('frontmatter');
    expect(AGENT_PROFILES.coding.source).toBe('frontmatter');
    expect(AGENT_PROFILES.security.source).toBe('frontmatter');
    expect(AGENT_PROFILES.review.source).toBe('frontmatter');
  });

  it('passes the consistency linter against TASK_MATRIX targets', () => {
    expect(() => assertAgentProfileConsistent()).not.toThrow();
  });

  it('linter rejects a profile whose thinking is below the matrix target (fail closed)', () => {
    const forged: AgentProfileMap = {
      ...AGENT_PROFILES,
      coding: { ...AGENT_PROFILES.coding, thinking: 'low' },
    };
    expect(() => assertAgentProfileConsistent(forged)).toThrow(/coding/i);
  });

  it('linter rejects a profile naming a non-builtin agent', () => {
    const forged: AgentProfileMap = {
      ...AGENT_PROFILES,
      review: { ...AGENT_PROFILES.review, agent: 'made-up-agent' },
    };
    expect(() => assertAgentProfileConsistent(forged)).toThrow(/reviewer|unknown agent/i);
  });
});
