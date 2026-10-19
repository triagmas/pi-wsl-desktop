/**
 * Read-only Pi discovery inside WSL.
 *
 * Order: PI_WS_DESKTOP_PI override → ~/.local/bin/pi (user install) → PATH.
 * Runs only bounded, non-interactive commands (`pi --version`, `pi --help`)
 * with hard timeouts; never launches a session, model call or interactive
 * startup script.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

export interface PiProbe {
  path: string;
  version: string;
  rpcSupported: boolean;
}

export interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type SpawnFn = (
  command: string,
  args: string[],
  opts: { env?: NodeJS.ProcessEnv; timeoutMs: number },
) => Promise<SpawnResult>;

export const defaultSpawn: SpawnFn = (command, args, opts) =>
  new Promise<SpawnResult>((resolve, reject) => {
    const child = spawn(command, args, {
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`spawn timed out after ${opts.timeoutMs}ms: ${command}`));
    }, opts.timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf8');
    });
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });

const VERSION_RE = /(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/;

function candidatePaths(env: NodeJS.ProcessEnv, home: string): string[] {
  const list: string[] = [];
  if (env.PI_WS_DESKTOP_PI) list.push(env.PI_WS_DESKTOP_PI);
  if (home) list.push(path.posix.join(home, '.local', 'bin', 'pi'));
  for (const dir of (env.PATH ?? '').split(':')) {
    if (dir) list.push(path.posix.join(dir, 'pi'));
  }
  return [...new Set(list)];
}

export async function probePi(
  opts: { env?: NodeJS.ProcessEnv; home?: string; spawnFn?: SpawnFn; timeoutMs?: number } = {},
): Promise<PiProbe | null> {
  const env = opts.env ?? process.env;
  const home = opts.home ?? env.HOME ?? '';
  const spawnFn = opts.spawnFn ?? defaultSpawn;
  const timeoutMs = opts.timeoutMs ?? 8000;
  // Candidates may be `#!/usr/bin/env node` scripts (the real ~/.local/bin/pi
  // is), so probes must run with a PATH that can actually resolve node:
  // the bridge's own node directory, the user's ~/.local/bin, then system dirs.
  const probePath = [
    path.dirname(process.execPath),
    home ? path.posix.join(home, '.local', 'bin') : '',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
  ]
    .filter(Boolean)
    .join(':');
  const childEnv = { PATH: probePath };

  for (const candidate of candidatePaths(env, home)) {
    let versionOut: SpawnResult;
    try {
      versionOut = await spawnFn(candidate, ['--version'], { env: childEnv, timeoutMs });
    } catch {
      continue; // unreadable, not executable or hung → next candidate
    }
    if (versionOut.code !== 0) continue;
    const match = VERSION_RE.exec(versionOut.stdout);
    if (!match) continue;

    let rpcSupported: boolean;
    try {
      const help = await spawnFn(candidate, ['--help'], { env: childEnv, timeoutMs });
      rpcSupported = help.code === 0 && /--mode/.test(help.stdout) && /\brpc\b/.test(help.stdout);
    } catch {
      rpcSupported = false;
    }
    return { path: candidate, version: match[1], rpcSupported };
  }
  return null;
}
