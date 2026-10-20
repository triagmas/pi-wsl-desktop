/**
 * M2 agent configuration loader (Issue #7).
 *
 * Read-only view over the user's Pi configuration, exactly as the installed
 * Pi 1.3.0 resolves it (docs/configuration.md + settings.md):
 * - user settings: `<home>/.pi/agent/settings.json`;
 * - project settings: `<projectRoot>/.pi/settings.json` — read ONLY when
 *   `trust.json` grants trust to that project root (fail-closed inventory:
 *   untrusted project resources are reported as NOT loaded);
 * - malformed files degrade to empty views + diagnostics, never a crash.
 * Never writes, never reads auth/mcp-auth/credentials.
 */
import path from 'node:path';
import type { FsLike } from '../sessions';

export interface SettingsView {
  skills: string[];
  extensions: string[];
  packages: string[];
}

export interface AgentConfig {
  home: string;
  cwd: string;
  agentDir: string;
  /** Project root used for trust lookup (`.git` ancestor, else cwd). */
  projectRoot: string;
  userSettings: SettingsView;
  projectSettings: SettingsView;
  projectTrusted: boolean;
  diagnostics: string[];
}

const emptySettings = (): SettingsView => ({ skills: [], extensions: [], packages: [] });

function pick(raw: unknown): SettingsView {
  const s = (raw ?? {}) as Record<string, unknown>;
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { skills: list(s.skills), extensions: list(s.extensions), packages: list(s.packages) };
}

/** Walk cwd → ancestors for a `.git` entry; repo root when found, else cwd. */
export async function findProjectRoot(fs: FsLike, cwd: string): Promise<string> {
  let current = path.posix.resolve(cwd);
  for (let depth = 0; depth < 10; depth += 1) {
    try {
      const items = await fs.readdir(current);
      if (items.some((i) => i.name === '.git')) return current;
    } catch {
      return current; // unreadable ancestor chain → treat cwd as the root
    }
    const parent = path.posix.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return path.posix.resolve(cwd);
}

async function readJson(fs: FsLike, file: string): Promise<{ raw: unknown | null; missing: boolean; malformed: boolean }> {
  try {
    const text = await fs.readHead(file, 256 * 1024);
    if (text.trim() === '') return { raw: null, missing: true, malformed: false };
    return { raw: JSON.parse(text) as unknown, missing: false, malformed: false };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { raw: null, missing: true, malformed: false };
    return { raw: null, missing: false, malformed: true };
  }
}

export async function loadAgentConfig(input: { fs: FsLike; home: string; cwd: string }): Promise<AgentConfig> {
  const { fs, home, cwd } = input;
  const agentDir = path.posix.join(home, '.pi', 'agent');
  const diagnostics: string[] = [];

  const user = await readJson(fs, path.posix.join(agentDir, 'settings.json'));
  if (user.malformed) diagnostics.push(`user settings.json: malformed JSON (treated as empty)`);
  const userSettings = pick(user.raw);

  const trust = await readJson(fs, path.posix.join(agentDir, 'trust.json'));
  if (trust.malformed) diagnostics.push(`trust.json: malformed JSON (treated as untrusted)`);
  const trustMap = (trust.raw ?? {}) as Record<string, unknown>;

  const projectRoot = await findProjectRoot(fs, cwd);
  const projectTrusted = trustMap[projectRoot] === true;

  let projectSettings = emptySettings();
  if (projectTrusted) {
    const proj = await readJson(fs, path.posix.join(projectRoot, '.pi', 'settings.json'));
    if (proj.malformed) diagnostics.push(`project .pi/settings.json: malformed JSON (treated as empty)`);
    projectSettings = pick(proj.raw);
  } else {
    diagnostics.push(`project ${projectRoot}: not trusted — project settings/resources not loaded`);
  }

  return { home, cwd, agentDir, projectRoot, userSettings, projectSettings, projectTrusted, diagnostics };
}

/** Strip a +/-/! prefix and resolve against the settings-file base dir. */
export function resolveResourceEntry(
  entry: string,
  agentDir: string,
  home: string,
): { excluded: boolean; glob: boolean; path: string | null; raw: string } {
  const excluded = entry.startsWith('-') || entry.startsWith('!');
  const plus = entry.startsWith('+');
  const body = entry.startsWith('-') || entry.startsWith('!') || plus ? entry.slice(1) : entry;
  const glob = /[*?[\]]/.test(body);
  if (glob) return { excluded, glob, path: null, raw: entry };
  const expanded = body.startsWith('~/') ? path.posix.join(home, body.slice(2)) : body;
  const resolved = path.posix.isAbsolute(expanded) ? path.posix.normalize(expanded) : path.posix.resolve(agentDir, expanded);
  return { excluded, glob, path: resolved, raw: entry };
}
