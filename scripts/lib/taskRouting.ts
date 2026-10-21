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

/**
 * Dispatch mapping onto the EXISTING builtin pi-subagents profiles
 * (pi-subagents@0.79.2 agents/: scout, researcher, worker, reviewer,
 * oracle, evidence-auditor, delegate, …). `source` records where the
 * thinking value comes from: the profile's own frontmatter, or a per-run
 * override needed when it differs from the matrix target (dispatched as
 * `subagent({ agent, model: '<provider>/<id>:<level>' })`, which
 * pi-subagents applies to the child Pi process via applyThinkingSuffix →
 * `--model <fullId>:<level>`). Pure data + linter; nothing here spawns
 * anything and no runtime code imports it.
 */
export interface AgentProfileRoute {
  agent: string;
  thinking: ThinkingLevel;
  source: 'frontmatter' | 'per-run-override';
}

export const BUILTIN_AGENTS = [
  'claude-code',
  'claude-code-writer',
  'codex-exec',
  'codex-exec-writer',
  'cursor-agent',
  'cursor-agent-writer',
  'delegate',
  'evidence-auditor',
  'oracle',
  'researcher',
  'reviewer',
  'scout',
  'worker',
] as const;

export type AgentProfileMap = Record<TaskType, AgentProfileRoute>;

export const AGENT_PROFILES: AgentProfileMap = {
  mechanical: { agent: 'scout', thinking: 'off', source: 'per-run-override' },
  documentation: { agent: 'scout', thinking: 'low', source: 'frontmatter' },
  analysis: { agent: 'researcher', thinking: 'medium', source: 'frontmatter' },
  coding: { agent: 'worker', thinking: 'high', source: 'frontmatter' },
  security: { agent: 'oracle', thinking: 'high', source: 'frontmatter' },
  review: { agent: 'reviewer', thinking: 'high', source: 'frontmatter' },
};

/**
 * Fail-closed consistency check: every profile must name a real builtin
 * agent and must not sit below its TASK_MATRIX target level.
 */
export function assertAgentProfileConsistent(profiles: AgentProfileMap = AGENT_PROFILES): void {
  for (const type of Object.keys(TASK_MATRIX) as TaskType[]) {
    const profile = profiles[type];
    if (!profile) throw new Error(`agent profiles missing task type "${type}" (fail closed)`);
    if (!(BUILTIN_AGENTS as readonly string[]).includes(profile.agent)) {
      throw new Error(
        `agent profiles: task type "${type}" names unknown agent "${profile.agent}" — expected one of the builtin pi-subagents agents (fail closed)`,
      );
    }
    const target = TASK_MATRIX[type].target;
    if (EXTENDED_LEVELS.indexOf(profile.thinking) < EXTENDED_LEVELS.indexOf(target)) {
      throw new Error(
        `agent profiles: task type "${type}" sits at thinking "${profile.thinking}" below matrix target "${target}" (fail closed)`,
      );
    }
  }
}

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
  // Object.hasOwn: prototype-chain keys (constructor/toString/…) must not
  // pass the membership check (independent review P1, fail closed).
  if (!Object.hasOwn(TASK_MATRIX, type)) {
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
  // Same fail-closed guard as classifyTaskType: a forged prototype-chain
  // "type" must never unlock a write (independent review P1).
  if (!Object.hasOwn(TASK_MATRIX, type)) {
    throw new Error(`unknown task type "${String(type)}" — classify before dispatch (fail closed)`);
  }
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
