/**
 * Task routing — task_type → model role → requested thinking (Issue #12).
 *
 * This is process tooling, NOT a new runtime router: Pi 1.3.0 already
 * assigns levels natively per task (`--thinking <level>`,
 * `--model <id>:<level>`, RPC `set_thinking_level`, readback via
 * `get_state.thinkingLevel` and `get_available_thinking_levels`). This
 * module is the fail-closed gate used BEFORE dispatching work:
 *  - it maps a task type to the owner-approved role and target level;
 *  - it decides whether the requested level can actually be assigned on
 *    the installed Pi + configured model, refusing silent success when Pi
 *    would clamp the request (mirroring Pi's upward-first clamp);
 *  - it blocks coding/security/review work below `high`, including when
 *    the effective readback is unknown.
 *
 * Provider/model identifiers stay local and are never part of this file.
 */

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type TaskType = 'mechanical' | 'documentation' | 'analysis' | 'coding' | 'security' | 'review';

export interface TaskRoute {
  role: 'PRIMARY' | 'CODING' | 'INDEPENDENT_REVIEW';
  target: ThinkingLevel;
}

/** Owner-approved matrix (AGENTS.md §5.1, TOKEN_EFFICIENCY.md §2). */
export const TASK_MATRIX: Record<TaskType, TaskRoute> = {
  mechanical: { role: 'PRIMARY', target: 'off' },
  documentation: { role: 'PRIMARY', target: 'low' },
  analysis: { role: 'PRIMARY', target: 'medium' },
  coding: { role: 'CODING', target: 'high' },
  security: { role: 'CODING', target: 'high' },
  review: { role: 'INDEPENDENT_REVIEW', target: 'high' },
};

/** Pi 1.3.0 level order (verified against installed CLI --help). */
const EXTENDED_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

const RISKY_TYPES: TaskType[] = ['coding', 'security', 'review'];

export function classifyTaskType(type: string): TaskType {
  if (!(type in TASK_MATRIX)) {
    throw new Error(`unknown task type "${type}" — classify before dispatch (fail closed)`);
  }
  return type as TaskType;
}

/**
 * When a light task turns into a source edit, it MUST be re-dispatched as
 * coding (high) before any write — never continue at the lighter level.
 */
export function escalateForSourceEdit(current: TaskType): TaskType {
  return RISKY_TYPES.includes(current) ? current : 'coding';
}

/**
 * Sanitized handoff line for worker/subagent dispatch records:
 * task_type, role, requested level, assignment status and the effective
 * level (disclosed clamp, never silent). Takes no provider/model input by
 * construction, so no provider identifiers can leak into the record.
 */
export function formatHandoff(
  type: TaskType,
  requested: ThinkingLevel,
  plan: AssignmentPlan,
): string {
  const route = TASK_MATRIX[type];
  const effective =
    plan.status === 'ok'
      ? plan.level
      : plan.status === 'UNSUPPORTED' && plan.clampedTo !== undefined
        ? `${plan.clampedTo} (clamped)`
        : 'UNKNOWN';
  return `task_type=${type} role=${route.role} requested=${requested} status=${plan.status} effective=${effective}`;
}

/** Minimum-level gate: code/security/review work requires effective `high`. */
export function assertLevelAllowsWrite(
  type: TaskType,
  effective: ThinkingLevel | null | undefined,
): void {
  if (RISKY_TYPES.includes(type)) {
    if (effective !== 'high') {
      throw new Error(
        `refusing ${type} work at effective thinking "${String(effective)}" — ${type} requires high (escalate before acting)`,
      );
    }
    return;
  }
  const target = TASK_MATRIX[type].target;
  if (effective === null || effective === undefined) {
    throw new Error(
      `refusing ${type} work with unknown effective thinking — read back the level first (fail closed)`,
    );
  }
  if (EXTENDED_LEVELS.indexOf(effective) < EXTENDED_LEVELS.indexOf(target)) {
    throw new Error(
      `refusing ${type} work at effective thinking "${effective}" — ${type} requires at least ${target}`,
    );
  }
}

export type AssignmentPlan =
  | { status: 'ok'; level: ThinkingLevel }
  | {
      status: 'UNSUPPORTED' | 'MAPPING_NEEDS_REVIEW';
      requested: ThinkingLevel;
      available?: ThinkingLevel[];
      /** The level Pi would silently clamp the request to, when known. */
      clampedTo?: ThinkingLevel;
    };

/**
 * Mirror of Pi 1.3.0 clampThinkingLevel (upward-first search over the
 * level order) — used to REPORT what Pi would do, never to mask it.
 */
export function clampLikePi(
  requested: ThinkingLevel,
  available: ThinkingLevel[],
): ThinkingLevel | undefined {
  if (available.length === 0) return undefined;
  if (available.includes(requested)) return requested;
  const from = EXTENDED_LEVELS.indexOf(requested);
  if (from === -1) return available[0];
  for (let i = from; i < EXTENDED_LEVELS.length; i++) {
    if (available.includes(EXTENDED_LEVELS[i])) return EXTENDED_LEVELS[i];
  }
  for (let i = from - 1; i >= 0; i--) {
    if (available.includes(EXTENDED_LEVELS[i])) return EXTENDED_LEVELS[i];
  }
  return undefined;
}

/**
 * Fail-closed readback gate. Call BEFORE dispatching a task:
 *   const levels = await rpc('get_available_thinking_levels');
 *   const plan = planThinkingAssignment(target, levels);
 *   if (plan.status !== 'ok') -> report UNSUPPORTED/MAPPING_NEEDS_REVIEW,
 *   never proceed as if the requested level were in effect.
 */
export function planThinkingAssignment(
  requested: ThinkingLevel,
  available: ThinkingLevel[],
): AssignmentPlan {
  if (!Array.isArray(available) || available.length === 0) {
    return { status: 'MAPPING_NEEDS_REVIEW', requested };
  }
  if (available.includes(requested)) return { status: 'ok', level: requested };
  const clampedTo = clampLikePi(requested, available);
  return { status: 'UNSUPPORTED', requested, available, clampedTo };
}
