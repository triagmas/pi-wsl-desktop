/**
 * M2 Skills inventory (Issue #7) — discovery with provenance and static
 * loadability status, per installed Pi 1.3.0 skills.md:
 * - sources: user/project `settings.skills` (agent dir / trusted project),
 *   `~/.agents/skills`, ancestor `.agents/skills` up to the repo root,
 *   conventional `<package>/skills/` for installed packages;
 * - a directory counts only with a `SKILL.md` that has frontmatter
 *   `description` (otherwise `invalid` — Pi does not load it);
 * - a `-path` settings entry marks a skill `excluded`;
 * - name collisions keep the FIRST discovered skill (mirrored as a
 *   diagnostic); discovery order is documented above `MAX_DEPTH`.
 * Read-only: only readdir/stat/readHead, no writes, no session access.
 */
import path from 'node:path';
import type { SkillInfoT, SkillSourceT } from '../../shared/m2Protocol';
import type { FsLike } from '../sessions';
import { resolveResourceEntry, type AgentConfig } from './agentConfig';

export interface SkillDiscoveryInput {
  fs: FsLike;
  cfg: AgentConfig;
  packageDirs: Array<{ source: string; dir: string }>;
}

export interface SkillDiscoveryResult {
  skills: SkillInfoT[];
  diagnostics: string[];
}

/** Discovery order (first wins on name collisions): user-settings →
 * project-settings → user-agents → project-agents → package. */
const MAX_DEPTH = 5;
const MAX_SKILLS = 2_000;
const SKILL_MD_BYTES = 16 * 1024;

interface Frontmatter {
  name: string | null;
  description: string | null;
  disableModelInvocation: boolean;
}

function parseFrontmatter(text: string): Frontmatter {
  const fm: Frontmatter = { name: null, description: null, disableModelInvocation: false };
  if (!text.startsWith('---\n')) return fm;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return fm;
  for (const line of text.slice(4, end).split('\n')) {
    const m = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    const value = m[2].trim().replace(/^["'](.*)["']$/, '$1');
    if (key === 'name') fm.name = value;
    else if (key === 'description') fm.description = value;
    else if (key === 'disable-model-invocation') fm.disableModelInvocation = value === 'true';
  }
  return fm;
}

export async function discoverSkills(input: SkillDiscoveryInput): Promise<SkillDiscoveryResult> {
  const { fs, cfg, packageDirs } = input;
  const skills: SkillInfoT[] = [];
  const diagnostics: string[] = [];
  const seen = new Set<string>(); // discovery order index → first wins
  const excluded = new Set<string>();

  const add = async (dirPath: string, source: SkillSourceT, pkg: string | null): Promise<void> => {
    if (skills.length >= MAX_SKILLS) return;
    const normalized = path.posix.normalize(dirPath);
    const skillMd = normalized.endsWith('.md') ? normalized : path.posix.join(normalized, 'SKILL.md');
    const entry: SkillInfoT = {
      name: path.posix.basename(normalized).replace(/\.md$/, ''),
      dir: normalized,
      source,
      package: pkg,
      description: null,
      status: 'missing',
      disableModelInvocation: false,
      diagnostics: [],
    };

    let text: string;
    try {
      text = await fs.readHead(skillMd, SKILL_MD_BYTES);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      entry.status = code === 'ENOENT' ? 'missing' : 'invalid';
      entry.diagnostics.push(`SKILL.md: ${code === 'ENOENT' ? 'not found' : String(error)}`);
      skills.push(entry);
      return;
    }

    const fm = parseFrontmatter(text);
    entry.name = fm.name && fm.name.length > 0 ? fm.name : path.posix.basename(normalized).replace(/\.md$/, '');
    entry.description = fm.description;
    entry.disableModelInvocation = fm.disableModelInvocation;
    if (!fm.description) {
      entry.status = 'invalid';
      entry.diagnostics.push('no description in SKILL.md frontmatter — Pi does not load it');
    } else {
      entry.status = 'ok';
    }
    if (excluded.has(normalized) || excluded.has(skillMd)) entry.status = 'excluded';

    if (entry.status === 'ok') {
      // Only LOADABLE skills occupy a name (skills.md: excluded/invalid/
      // missing skills are not loaded by Pi — they must not hide a
      // loadable same-name skill from another source) [review r1 MINOR f].
      if (seen.has(entry.name)) {
        diagnostics.push(`skill name collision: "${entry.name}" — first discovered wins, later source ignored`);
        return;
      }
      seen.add(entry.name);
    }
    skills.push(entry);
  };

  const walkSkillsRoot = async (root: string, source: SkillSourceT, pkg: string | null, depth = 0): Promise<void> => {
    if (depth > MAX_DEPTH || skills.length >= MAX_SKILLS) return;
    let items;
    try {
      items = await fs.readdir(root);
    } catch {
      return; // absent skills root is normal
    }
    for (const item of items) {
      if (skills.length >= MAX_SKILLS) return;
      const child = path.posix.join(root, item.name);
      if (item.isFile() && item.name === 'SKILL.md') {
        await add(path.posix.dirname(child), source, pkg); // skills root itself holds SKILL.md (file entry)
      } else if (item.isDirectory()) {
        const hasMd = await fs
          .readHead(path.posix.join(child, 'SKILL.md'), 1)
          .then(() => true, () => false);
        if (hasMd) await add(child, source, pkg);
        else await walkSkillsRoot(child, source, pkg, depth + 1);
      }
    }
  };

  const settingsEntries = (entries: string[], source: SkillSourceT, baseDir: string): void => {
    for (const raw of entries) {
      const resolved = resolveResourceEntry(raw, baseDir, cfg.home);
      if (resolved.glob) {
        diagnostics.push(`glob resource entry not expanded in static inventory: ${raw}`);
        continue;
      }
      if (resolved.path === null) continue;
      if (raw.startsWith('-') || raw.startsWith('!')) {
        excluded.add(resolved.path);
        continue;
      }
      // Concrete path entries are added after the exclusion set is complete —
      // collected first, emitted in source order below.
      pendingSettings.push({ path: resolved.path, source });
    }
  };

  const pendingSettings: Array<{ path: string; source: SkillSourceT }> = [];

  settingsEntries(cfg.userSettings.skills, 'user-settings', cfg.agentDir);
  if (cfg.projectTrusted) {
    // settings.md:153 — project-settings paths resolve from <projectRoot>/.pi
    settingsEntries(cfg.projectSettings.skills, 'project-settings', path.posix.join(cfg.projectRoot, '.pi'));
  }

  for (const p of pendingSettings.filter((x) => x.source === 'user-settings')) await add(p.path, 'user-settings', null);
  for (const p of pendingSettings.filter((x) => x.source === 'project-settings')) await add(p.path, 'project-settings', null);

  await walkSkillsRoot(path.posix.join(cfg.home, '.agents', 'skills'), 'user-agents', null);
  for (let cur = path.posix.resolve(cfg.cwd), depth = 0; depth < 10; depth += 1) {
    await walkSkillsRoot(path.posix.join(cur, '.agents', 'skills'), 'project-agents', null);
    if (cur === cfg.projectRoot) break;
    const parent = path.posix.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }

  for (const pkgDir of packageDirs) {
    await walkSkillsRoot(path.posix.join(pkgDir.dir, 'skills'), 'package', pkgDir.source);
  }

  return { skills, diagnostics: [...cfg.diagnostics, ...diagnostics] };
}
