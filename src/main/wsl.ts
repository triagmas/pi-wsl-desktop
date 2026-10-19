/**
 * Windows-side WSL launcher.
 *
 * Every wsl.exe call is bounded, gets stdin ignored (a previous capture
 * attempt hung on interactive stdin — see Issue #2) and is killed on
 * timeout. Arguments are passed as an array — never through a shell string.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { BridgeError } from '../shared/errors';
import { decodeWslOutput, parseDistroList } from './wslParse';

export const DEFAULT_WSL_PATH = 'C:\\Windows\\System32\\wsl.exe';

export interface WslCallOptions {
  wslPath?: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

export interface ProbeOutput {
  ok: boolean;
  reason?: string;
  nodePath?: string;
  nodeVersion?: string;
  home?: string;
  bridgeOk?: boolean;
}

/**
 * Static, non-interactive probe (no login shell, no startup files).
 * argv: $1 = bridge bundle path inside WSL, $2 = optional node override.
 */
export const PROBE_SCRIPT = [
  'p=""',
  'if [ -n "$2" ] && [ -x "$2" ]; then p="$2"; fi',
  'if [ -z "$p" ] && command -v node >/dev/null 2>&1; then p="$(command -v node)"; fi',
  'if [ -z "$p" ] && [ -x "$HOME/.local/bin/node" ]; then p="$HOME/.local/bin/node"; fi',
  'if [ -z "$p" ] && [ -x "/usr/local/bin/node" ]; then p="/usr/local/bin/node"; fi',
  'if [ -z "$p" ] && [ -x "/usr/bin/node" ]; then p="/usr/bin/node"; fi',
  'b=false',
  'if [ -n "$1" ] && [ -f "$1" ]; then b=true; fi',
  'if [ -z "$p" ]; then printf \'{"ok":false,"reason":"NODE_NOT_FOUND","bridgeOk":%s}\\n\' "$b"; exit 0; fi',
  'v="$("$p" --version 2>/dev/null | head -n 1)"',
  'printf \'{"ok":true,"nodePath":"%s","nodeVersion":"%s","home":"%s","bridgeOk":%s}\\n\' "$p" "$v" "$HOME" "$b"',
].join('\n');

interface RunResult {
  code: number | null;
  stdout: Buffer;
  stderr: string;
}

function runWsl(wslPath: string, args: string[], opts: WslCallOptions & { timeoutMs: number }): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(wslPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: opts.env ? { ...process.env, ...opts.env } : process.env,
    });
    const stdout: Buffer[] = [];
    const stderrChunks: string[] = [];
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new BridgeError('WSL_UNAVAILABLE', `wsl.exe timed out after ${opts.timeoutMs}ms`));
    }, opts.timeoutMs);
    child.stdout.on('data', (c: Buffer) => stdout.push(c));
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c.toString('utf8')));
    child.once('error', (err) => {
      clearTimeout(timer);
      reject(new BridgeError('WSL_UNAVAILABLE', `cannot start ${wslPath}: ${err.message}`));
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(stdout), stderr: stderrChunks.join('') });
    });
  });
}

export async function listDistros(opts: WslCallOptions = {}): Promise<string[]> {
  const wslPath = opts.wslPath ?? DEFAULT_WSL_PATH;
  const res = await runWsl(wslPath, ['--list', '--quiet'], {
    ...opts,
    timeoutMs: opts.timeoutMs ?? 10_000,
  });
  const distros = parseDistroList(decodeWslOutput(res.stdout));
  if (res.code !== 0 || distros.length === 0) {
    throw new BridgeError('WSL_UNAVAILABLE', `no WSL distributions detected (exit ${res.code})`);
  }
  return distros;
}

export interface ProbeOptions extends WslCallOptions {
  distro: string;
  bridgeWslPath: string;
  nodeOverride?: string;
}

export async function probeNode(opts: ProbeOptions): Promise<ProbeOutput> {
  const wslPath = opts.wslPath ?? DEFAULT_WSL_PATH;
  const res = await runWsl(
    wslPath,
    ['-d', opts.distro, '--exec', '/bin/sh', '-c', PROBE_SCRIPT, 'sh', opts.bridgeWslPath, opts.nodeOverride ?? ''],
    { ...opts, timeoutMs: opts.timeoutMs ?? 10_000 },
  );
  if (res.code !== 0) {
    throw new BridgeError('WSL_UNAVAILABLE', `node probe exited ${res.code}: ${res.stderr.slice(0, 200)}`);
  }
  const firstLine = res.stdout.toString('utf8').split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    throw new BridgeError('WSL_UNAVAILABLE', `unparseable probe output: ${firstLine.slice(0, 120)}`);
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new BridgeError('WSL_UNAVAILABLE', 'unparseable probe output (not an object)');
  }
  return parsed as ProbeOutput;
}

export interface StartBridgeOptions extends WslCallOptions {
  distro: string;
  nodePath: string;
  bridgeWslPath: string;
}

/** Launch the long-lived bridge. No timeout by design — the client owns the lifecycle. */
export function startBridgeProcess(opts: StartBridgeOptions): ChildProcessWithoutNullStreams {
  const wslPath = opts.wslPath ?? DEFAULT_WSL_PATH;
  return spawn(
    wslPath,
    // env(1) inside WSL sets the distro for the bridge: wsl.exe does not carry
    // arbitrary spawning-process env into the distro (WSLENV only covers a
    // fixed set), while argv is passed through verbatim.
    ['-d', opts.distro, '--exec', '/usr/bin/env', `PI_WS_DESKTOP_DISTRO=${opts.distro}`, opts.nodePath, opts.bridgeWslPath],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...(opts.env ? { ...process.env, ...opts.env } : process.env),
        // also set on the spawning side for direct (non-wsl) test harnesses
        PI_WS_DESKTOP_DISTRO: opts.distro,
      },
    },
  );
}
