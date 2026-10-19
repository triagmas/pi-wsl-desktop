import { build } from 'esbuild';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const repoRoot = path.join(__dirname, '..', '..');
let cached: string | null = null;

/** Bundle src/bridge/index.ts to a temp CJS file (the same artifact shipped into WSL). */
export async function buildBridgeBundle(): Promise<string> {
  if (cached) return cached;
  const outfile = path.join(os.tmpdir(), `piwsd-bridge-${process.pid}.cjs`);
  await build({
    entryPoints: [path.join(repoRoot, 'src/bridge/index.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile,
    logLevel: 'silent',
  });
  cached = outfile;
  return outfile;
}

export async function removeBridgeBundle(): Promise<void> {
  if (cached) {
    const { rm } = await import('node:fs/promises');
    await rm(cached, { force: true });
    cached = null;
  }
}

export interface SpawnedBridge extends ChildProcessWithoutNullStreams {
  stdoutText: string;
  stderrText: string;
}

/** Spawn the bundled bridge as a real subprocess with piped stdio. */
export async function spawnBridge(env: Record<string, string> = {}): Promise<SpawnedBridge> {
  const bundle = await buildBridgeBundle();
  const child = spawn(process.execPath, [bundle], {
    env: { PATH: '/usr/bin:/bin', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  }) as SpawnedBridge;
  child.stdoutText = '';
  child.stderrText = '';
  child.stdout.on('data', (c: Buffer) => {
    child.stdoutText += c.toString('utf8');
  });
  child.stderr.on('data', (c: Buffer) => {
    child.stderrText += c.toString('utf8');
  });
  return child;
}
