/**
 * M2 packages/extensions inventory (Issue #7), mirroring installed Pi 1.3.0:
 * - `pi list` reads `packages` from user + trusted project settings
 *   (packages.md); entries are strings or resource-filter objects;
 * - install layout (observed on this machine and documented): npm →
 *   `<agentDir>/npm/node_modules/<name>`, git/URL → `<agentDir>/git/<host>/<repo>`,
 *   local → resolved from the settings file that declares it;
 * - built-in extensions (`builtin:<name>`, `-builtin:<name>`) resolve per
 *   settings.md: defaults on, user entries adjust, trusted project entries
 *   override;
 * - read-only: presence via readdir, no writes, no network, no `pi update`.
 */
import path from 'node:path';
import { resolveResourceEntry, type AgentConfig, type SettingsView } from './agentConfig';
import type { BuiltinInfoT, PackageInfoT, PackageKindT } from '../../shared/m2Protocol';
import type { FsLike } from '../sessions';

export interface PackageDiscoveryInput {
  fs: FsLike;
  cfg: AgentConfig;
}

export interface PackageDiscoveryResult {
  packages: PackageInfoT[];
  builtins: BuiltinInfoT[];
  /** Raw `extensions` entries (paths AND builtin:… declarations). */
  settingsExtensions: string[];
  /** Present package roots for Skills provenance (source → dir). */
  packageDirs: Array<{ source: string; dir: string }>;
  diagnostics: string[];
}

const BUILTIN_DEFAULTS = ['mcp', 'llama.cpp', 'codemode', 'tool-search'];

interface ParsedEntry {
  source: string;
}

function classify(source: string): { kind: PackageKindT; ref: string | null; dirParts: string[] | null; unknown: boolean } {
  if (source.startsWith('npm:')) {
    const spec = source.slice(4);
    const at = spec.lastIndexOf('@');
    const name = at > 0 ? spec.slice(0, at) : spec;
    const ref = at > 0 ? spec.slice(at + 1) : null;
    return { kind: 'npm', ref, dirParts: ['npm', 'node_modules', ...name.split('/')], unknown: false };
  }
  if (source.startsWith('git:')) {
    const body = source.slice(4);
    const slash = body.lastIndexOf('/');
    const at = body.lastIndexOf('@');
    const ref = at > slash && at > 0 ? body.slice(at + 1) : null;
    const repo = ref ? body.slice(0, at) : body;
    return { kind: 'git', ref, dirParts: ['git', ...repo.replace(/^[a-z]+:\/\//i, '').split('/')], unknown: false };
  }
  const url = /^https?:\/\/([^/]+)(\/.*)?$/.exec(source);
  if (url) {
    const host = url[1] ?? '';
    const repoPath = (url[2] ?? '').replace(/^\//, '').replace(/\.git$/, '');
    return { kind: 'url', ref: null, dirParts: ['git', host, ...repoPath.split('/').filter(Boolean)], unknown: repoPath === '' };
  }
  if (source.startsWith('.') || path.posix.isAbsolute(source)) {
    return { kind: 'local', ref: null, dirParts: null, unknown: false };
  }
  if (source.includes(':')) {
    // scheme-looking (e.g. `wheel:bogus`) — not a documented source
    return { kind: 'local', ref: null, dirParts: null, unknown: true };
  }
  // Bare name: the real CLI stores local packages inside the agent dir as a
  // plain relative name — resolve it exactly like Pi does (from settings dir).
  return { kind: 'local', ref: null, dirParts: null, unknown: false };
}

export async function discoverPackages(input: PackageDiscoveryInput): Promise<PackageDiscoveryResult> {
  const { fs, cfg } = input;
  const packages: PackageInfoT[] = [];
  const settingsExtensions: string[] = [];
  const packageDirs: Array<{ source: string; dir: string }> = [];
  const diagnostics: string[] = [];

  const declared: Array<{ entry: ParsedEntry; scope: 'user' | 'project'; baseDir: string }> = [];
  const take = (view: SettingsView, scope: 'user' | 'project', baseDir: string): void => {
    for (const raw of view.packages) {
      const source =
        typeof raw === 'string'
          ? raw.trim()
          : typeof raw.source === 'string' && raw.source.trim().length > 0
            ? raw.source.trim()
            : null;
      if (source === null) {
        diagnostics.push('malformed package declaration (no source) — skipped');
        continue;
      }
      declared.push({ entry: { source }, scope, baseDir });
    }
    for (const raw of view.extensions) settingsExtensions.push(raw);
  };

  take(cfg.userSettings, 'user', cfg.agentDir);
  if (cfg.projectTrusted) {
    const projBase = path.posix.join(cfg.projectRoot, '.pi');
    take(cfg.projectSettings, 'project', projBase);
  }

  for (const { entry, scope, baseDir } of declared) {
    const { kind, ref, dirParts, unknown } = classify(entry.source);
    if (unknown) diagnostics.push(`unknown/unsupported package source: ${entry.source}`);
    let resolvedPath: string | null = null;
    if (dirParts) resolvedPath = path.posix.join(cfg.agentDir, ...dirParts);
    else if (kind === 'local') {
      const r = resolveResourceEntry(entry.source, baseDir, cfg.home);
      resolvedPath = r.path;
    }
    let present = false;
    if (resolvedPath) {
      try {
        await fs.readdir(resolvedPath);
        present = true;
      } catch {
        present = false;
      }
    }
    packages.push({
      source: entry.source,
      kind,
      scope,
      path: resolvedPath,
      present,
      declaredRef: ref,
      diagnostics: present ? [] : ['not present on disk'],
    });
    if (present && resolvedPath) packageDirs.push({ source: entry.source, dir: resolvedPath });
  }

  // Built-ins per settings.md: defaults on → user adjustments → trusted project overrides.
  const enabled = new Map<string, boolean>(BUILTIN_DEFAULTS.map((n) => [n, true]));
  const apply = (view: SettingsView): void => {
    for (const raw of view.extensions) {
      const m = /^([+-]?)builtin:([\w.-]+)$/.exec(raw);
      if (!m) continue;
      const [, sign = '', name] = m;
      enabled.set(name === 'llama.cpp' ? 'llama.cpp' : name, sign !== '-');
    }
  };
  apply(cfg.userSettings);
  if (cfg.projectTrusted) apply(cfg.projectSettings);
  const builtins: BuiltinInfoT[] = BUILTIN_DEFAULTS.map((name) => ({ name, enabled: enabled.get(name) ?? true }));

  return { packages, builtins, settingsExtensions, packageDirs, diagnostics };
}
