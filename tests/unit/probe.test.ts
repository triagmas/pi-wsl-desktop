import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { probePi } from '../../src/bridge/probe';

function makeHomeWithUserPi(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-probe-'));
  const bin = path.join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  // node exists ONLY in ~/.local/bin (mirrors this WSL machine)
  symlinkSync(process.execPath, path.join(bin, 'node'));
  // pi is a JS entry with `#!/usr/bin/env node` — needs node on PATH to run
  writeFileSync(path.join(bin, 'pi'), '#!/usr/bin/env node\nconsole.log("1.2.3");\n');
  chmodSync(path.join(bin, 'pi'), 0o755);
  return home;
}

// probePi spawns `#!/usr/bin/env node` candidates — a POSIX shebang semantic;
// Windows cannot exec shebang files. The behaviour is covered by the Linux CI
// job and the local/real WSL smoke; the Windows job skips it honestly instead
// of faking a pass.
describe.skipIf(process.platform === 'win32')('probePi (user install under ~/.local/bin)', () => {
  it('runs a user pi whose shebang needs `env node` when node is not on the system PATH', async () => {
    const home = makeHomeWithUserPi();
    const probe = await probePi({
      env: { HOME: home, PATH: '/nonexistent-bin' },
      home,
      timeoutMs: 10_000,
    });
    expect(probe).not.toBeNull();
    expect(probe!.version).toBe('1.2.3');
    expect(probe!.path).toBe(path.join(home, '.local', 'bin', 'pi'));
    expect(probe!.rpcSupported).toBe(false); // fixture help has no --mode rpc
  });

  it('returns null when no pi exists anywhere', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-probe-'));
    const probe = await probePi({ env: { HOME: home, PATH: '/nonexistent-bin' }, home, timeoutMs: 5000 });
    expect(probe).toBeNull();
  });

  it('honours the PI_WS_DESKTOP_PI override first', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'piwsd-probe-'));
    const override = path.join(home, 'mypiv2');
    writeFileSync(override, '#!/usr/bin/env node\nconsole.log("7.7.7");\n');
    chmodSync(override, 0o755);
    const probe = await probePi({
      env: { HOME: home, PATH: '/nonexistent-bin', PI_WS_DESKTOP_PI: override },
      home,
      timeoutMs: 10_000,
    });
    expect(probe?.version).toBe('7.7.7');
  });
});
