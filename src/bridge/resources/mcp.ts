/**
 * M2 MCP inventory (Issue #7) — CONFIG-ONLY, read-only.
 *
 * Installed Pi 1.3.0 warning (Issue #7 checkpoint): `pi mcp list` CONNECTS to
 * every enabled server and starts subprocesses. This module therefore never
 * shells out — no subprocess API is imported (regression-pinned by test):
 * it parses `~/.pi/agent/mcp.json` and the trusted project `.pi/mcp.json`
 * exactly as docs/mcp.md describes (project entry shadows user entry by
 * name) and reports diagnostics.
 *
 * Redaction invariants:
 * - env VALUES are never read into results (keys only);
 * - OAuth credential files are never opened;
 * - `mcp.log` contributes LEVEL COUNTS only — raw lines may embed private
 *   server output and never travel.
 */
import path from 'node:path';
import type { McpServerInfoT } from '../../shared/m2Protocol';
import type { FsLike } from '../sessions';
import type { AgentConfig } from './agentConfig';

export type McpDiscoveryResult = ReturnType<typeof emptyResult>;

function emptyResult() {
  return {
    servers: [] as McpServerInfoT[],
    builtinEnabled: true,
    logDiagnostics: [] as string[],
    diagnostics: [] as string[],
  };
}

const NAME_RE = /^[A-Za-z0-9_-]+$/;
const MAX_SERVERS = 200;

async function readJson(fs: FsLike, file: string): Promise<{ raw: Record<string, unknown> | null; malformed: boolean; missing: boolean }> {
  try {
    const text = await fs.readHead(file, 512 * 1024);
    if (text.trim() === '') return { raw: null, malformed: false, missing: true };
    const parsed = JSON.parse(text) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return { raw: null, malformed: true, missing: false };
    return { raw: parsed as Record<string, unknown>, malformed: false, missing: false };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { raw: null, malformed: false, missing: true };
    return { raw: null, malformed: true, missing: false };
  }
}

function parseServer(name: string, scope: 'user' | 'project', hasProjectOverride: boolean, raw: unknown): { info: McpServerInfoT | null; diagnostics: string[] } {
  const diagnostics: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { info: null, diagnostics: [`server "${name}": entry is not an object`] };
  }
  const cfg = raw as Record<string, unknown>;
  const url = typeof cfg.url === 'string' ? cfg.url : null;
  const transport = cfg.type === 'http' || url !== null ? 'http' as const : 'stdio' as const;
  const command = transport === 'http' ? url : typeof cfg.command === 'string' ? cfg.command : null;
  const args = Array.isArray(cfg.args) ? cfg.args.filter((a): a is string => typeof a === 'string').slice(0, 64) : [];
  const envKeys =
    cfg.env !== null && typeof cfg.env === 'object' && !Array.isArray(cfg.env)
      ? Object.keys(cfg.env as Record<string, unknown>).slice(0, 64) // VALUES stay unread
      : [];
  if (command === null) diagnostics.push(`server "${name}": neither command nor url configured`);
  const oauthConfigured = Object.keys(cfg).some((k) => k.startsWith('oauth'));
  return {
    info: {
      name,
      scope,
      transport,
      command,
      args,
      envKeys,
      hasProjectOverride,
      oauthConfigured,
      diagnostics,
    },
    diagnostics: [],
  };
}

export async function discoverMcp(input: { fs: FsLike; cfg: AgentConfig }): Promise<McpDiscoveryResult> {
  const { fs, cfg } = input;
  const result = emptyResult();
  result.diagnostics.push(...cfg.diagnostics);

  const userFile = path.posix.join(cfg.agentDir, 'mcp.json');
  const userJson = await readJson(fs, userFile);
  if (userJson.malformed) result.diagnostics.push(`mcp.json: malformed JSON (ignored)`);
  const userServers = ((userJson.raw as { mcpServers?: unknown } | null)?.mcpServers ?? null) as Record<string, unknown> | null;
  if (userJson.raw && userServers === null && userJson.raw.mcpServers !== undefined) {
    result.diagnostics.push('mcp.json: mcpServers is not an object');
  }

  const merged = new Map<string, { entry: unknown; scope: 'user' | 'project' }>();
  if (userServers && typeof userServers === 'object') {
    for (const [name, entry] of Object.entries(userServers)) merged.set(name, { entry, scope: 'user' });
  }

  if (cfg.projectTrusted) {
    const projFile = path.posix.join(cfg.projectRoot, '.pi', 'mcp.json');
    const projJson = await readJson(fs, projFile);
    if (projJson.malformed) result.diagnostics.push(`project .pi/mcp.json: malformed JSON (ignored)`);
    const projServers = ((projJson.raw as { mcpServers?: unknown } | null)?.mcpServers ?? null) as Record<string, unknown> | null;
    if (projServers && typeof projServers === 'object') {
      for (const [name, entry] of Object.entries(projServers)) {
        merged.set(name, { entry, scope: 'project' }); // project replaces user by name (mcp.md)
      }
    }
  }

  for (const [name, { entry, scope }] of merged) {
    if (result.servers.length >= MAX_SERVERS) break;
    if (!NAME_RE.test(name)) {
      result.diagnostics.push(`invalid server name "${name}" (letters, digits, _ and - only) — skipped`);
      continue;
    }
    const hasProjectOverride = scope === 'project' && merged.has(name) && (userServers ? name in userServers : false);
    const { info, diagnostics } = parseServer(name, scope, hasProjectOverride, entry);
    result.diagnostics.push(...diagnostics);
    if (info) result.servers.push(info);
  }

  // Built-in MCP session support (settings.md): default on, extensions adjust;
  // a trusted project entry overrides the user entry.
  let builtinEnabled = true;
  const applyExt = (entries: string[]): void => {
    for (const raw of entries) {
      const m = /^([+-]?)builtin:mcp$/.exec(raw);
      if (m) builtinEnabled = (m[1] ?? '') !== '-';
    }
  };
  applyExt(cfg.userSettings.extensions);
  if (cfg.projectTrusted) applyExt(cfg.projectSettings.extensions);
  result.builtinEnabled = builtinEnabled;

  // mcp.log → LEVEL counts only (never raw lines).
  try {
    const tail = await fs.readTail(path.posix.join(cfg.agentDir, 'mcp.log'), 64 * 1024);
    const counts = new Map<string, number>();
    for (const line of tail.split('\n')) {
      const m = /\[([^\]]+)\]\s+(error|warn|warning|info|debug|trace)\b/i.exec(line);
      if (!m) continue;
      const server = m[1] ?? '';
      const levelRaw = (m[2] ?? '').toLowerCase();
      const level = levelRaw.startsWith('warn') ? 'WARNING' : levelRaw.toUpperCase();
      const key = `${server} ${level}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    result.logDiagnostics = [...counts.entries()]
      .filter(([key]) => / (ERROR|WARNING)$/.test(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, count]) => `${key} ${count}`)
      .slice(0, 10);
  } catch {
    /* absent mcp.log is normal */
  }

  return result;
}
