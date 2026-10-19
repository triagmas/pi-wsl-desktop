import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { listDistros, probeNode, startBridgeProcess } from '../../src/main/wsl';

const FAKE = path.join(__dirname, '..', 'fixtures', 'fake-wsl');

function tmpLog(): string {
  return path.join(mkdtempSync(path.join(os.tmpdir(), 'piwsd-log-')), 'wsl.log');
}

describe('listDistros (fake wsl.exe)', () => {
  it('decodes UTF-16LE distro list incl. non-ASCII names', async () => {
    const distros = await listDistros({ wslPath: FAKE, timeoutMs: 5000 });
    expect(distros).toEqual(['Ubuntu', 'Ubuntu中文']);
  });

  it('fails with WSL_UNAVAILABLE when wsl.exe hangs (killed by timeout)', async () => {
    const started = Date.now();
    await expect(
      listDistros({ wslPath: FAKE, timeoutMs: 300, env: { FAKE_WSL_LIST_MODE: 'hang' } }),
    ).rejects.toMatchObject({ code: 'WSL_UNAVAILABLE' });
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('fails with WSL_UNAVAILABLE when wsl.exe crashes with no output', async () => {
    await expect(
      listDistros({ wslPath: FAKE, timeoutMs: 3000, env: { FAKE_WSL_LIST_MODE: 'crash' } }),
    ).rejects.toMatchObject({ code: 'WSL_UNAVAILABLE' });
  });

  it('fails with WSL_UNAVAILABLE when the distro list is empty', async () => {
    await expect(
      listDistros({ wslPath: FAKE, timeoutMs: 3000, env: { FAKE_WSL_LIST_MODE: 'empty' } }),
    ).rejects.toMatchObject({ code: 'WSL_UNAVAILABLE' });
  });
});

describe('startBridgeProcess (fake wsl.exe)', () => {
  it('passes the selected distro to the bridge process environment', async () => {
    const log = tmpLog();
    const child = startBridgeProcess({
      wslPath: FAKE,
      distro: 'Ubuntu中文',
      nodePath: '/fake/node',
      bridgeWslPath: '/mnt/f/bridge.cjs',
      env: { FAKE_WSL_LOG: log },
    });
    const exited = new Promise((r) => child.once('exit', () => r(null)));
    await exited;
    const argv = readFileSync(log, 'utf8');
    expect(argv).toContain('[-d] [Ubuntu中文]');
    expect(argv).toContain('DISTRO=[Ubuntu中文]');
  });
});

describe('probeNode (fake wsl.exe)', () => {
  it('returns the probe JSON fields on success', async () => {
    const probe = await probeNode({
      wslPath: FAKE,
      distro: 'Ubuntu',
      bridgeWslPath: '/mnt/f/bridge.cjs',
      timeoutMs: 3000,
    });
    expect(probe).toEqual({
      ok: true,
      nodePath: '/fake/node',
      nodeVersion: 'v22.1.0',
      home: '/home/fake',
      bridgeOk: true,
    });
  });

  it('fails with WSL_UNAVAILABLE when the probe hangs', async () => {
    await expect(
      probeNode({
        wslPath: FAKE,
        distro: 'Ubuntu',
        bridgeWslPath: '/mnt/f/bridge.cjs',
        timeoutMs: 300,
        env: { FAKE_WSL_PROBE_MODE: 'hang' },
      }),
    ).rejects.toMatchObject({ code: 'WSL_UNAVAILABLE' });
  });

  it('fails with WSL_UNAVAILABLE on unparseable probe output', async () => {
    await expect(
      probeNode({
        wslPath: FAKE,
        distro: 'Ubuntu',
        bridgeWslPath: '/mnt/f/bridge.cjs',
        timeoutMs: 3000,
        env: { FAKE_WSL_PROBE_MODE: 'bad-probe' },
      }),
    ).rejects.toMatchObject({ code: 'WSL_UNAVAILABLE' });
  });

  it('passes the node override through to the probe environment', async () => {
    const log = tmpLog();
    await probeNode({
      wslPath: FAKE,
      distro: 'Ubuntu 中文',
      bridgeWslPath: '/mnt/f/dir with space/bridge.cjs',
      nodeOverride: '/custom dir/node',
      timeoutMs: 3000,
      env: { FAKE_WSL_LOG: log },
    });
    const argv = readFileSync(log, 'utf8');
    // bracket framing in the log proves each value arrived as ONE argv element
    expect(argv).toContain('[/custom dir/node]');
    expect(argv).toContain('[/mnt/f/dir with space/bridge.cjs]');
    expect(argv).toContain('[Ubuntu 中文]');
  });
});
