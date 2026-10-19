/* Fake bridge process for integration tests. Speaks the M0 protocol on
 * stdio; behavior selected via FAKE_BRIDGE_MODE:
 *   ok (default)        ready + real answers
 *   silent              ready, never answers requests
 *   die-after-ready     ready, exit(3) after 150ms
 *   die-on-request      ready, exit(3) on first request
 *   never-ready         no ready event
 *   garbage             ready + three non-JSON stdout lines
 *   oversize            ready + one >2MiB stdout line
 * Received frames are appended to $FAKE_BRIDGE_LOG as `frame:…`/`cancel:…`.
 *
 * Pi discovery mirrors src/bridge/probe.ts semantics (review P1#1 ready-gate):
 *   PI_WS_DESKTOP_PI set   → authoritative; nonexistent → PI_NOT_FOUND,
 *                            fakepi-norpc → rpcSupported false
 *   PI_WS_DESKTOP_PI unset → healthy fixture pi 9.9.9 with RPC advertised
 */
const fs = require('node:fs');

const mode = process.env.FAKE_BRIDGE_MODE || 'ok';
const log = process.env.FAKE_BRIDGE_LOG;
const piOverride = process.env.PI_WS_DESKTOP_PI;

function probeFixture() {
  if (piOverride) {
    if (piOverride.includes('fakepi-norpc')) {
      return { path: piOverride, version: '9.9.9', rpcSupported: false };
    }
    if (!fs.existsSync(piOverride)) return null; // strict override: no fallback
    return { path: piOverride, version: '9.9.9', rpcSupported: true };
  }
  return { path: '/home/fake/.local/bin/pi', version: '9.9.9', rpcSupported: true };
}
const logLine = (s) => {
  if (log) fs.appendFileSync(log, s + '\n');
};

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

if (mode !== 'never-ready') {
  send({ v: 1, type: 'event', event: 'ready', payload: { fixture: true } });
}
if (process.env.FAKE_BRIDGE_EMIT_CHAT === '1') {
  // M1: a chat event frame that the connection must relay to chat subscribers.
  send({ v: 1, type: 'event', event: 'chat', payload: { kind: 'pi', name: 'agent_start', data: {} } });
}
if (mode === 'die-after-ready') setTimeout(() => process.exit(3), 150);
if (mode === 'garbage') {
  process.stdout.write('not-json\n{broken\nalso-not-json\n');
}
if (mode === 'oversize') {
  process.stdout.write('{"v":1,"type":"event","event":"noise","payload":"' + 'x'.repeat(2 * 1024 * 1024) + '"}\n');
}

let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx);
    buf = buf.slice(idx + 1);
    if (line === '') continue;
    logLine('frame:' + line);
    let f;
    try {
      f = JSON.parse(line);
    } catch {
      continue;
    }
    if (f.type === 'cancel') {
      logLine('cancel:' + f.requestId);
      continue;
    }
    if (f.type !== 'request') continue;
    if (mode === 'silent') continue;
    if (mode === 'die-on-request') process.exit(3);
    if (f.method === 'health') {
      send({
        v: 1,
        type: 'response',
        requestId: f.requestId,
        status: 'ok',
        result: { status: 'ok', fixture: true, tag: (f.params || {}).tag || null },
      });
    } else if (f.method === 'getRuntimeInfo') {
      const p = probeFixture();
      if (!p) {
        // mirrors pi() throwing PI_NOT_FOUND in src/bridge/handlers.ts
        send({
          v: 1,
          type: 'response',
          requestId: f.requestId,
          status: 'error',
          error: { code: 'PI_NOT_FOUND', message: 'Pi executable not found (fixture)' },
        });
        continue;
      }
      send({
        v: 1,
        type: 'response',
        requestId: f.requestId,
        status: 'ok',
        result: {
          distro: 'FakeDistro',
          node: { path: '/fake/node', version: 'v22.1.0' },
          pi: p,
          agentDir: '/home/fake/.pi/agent',
        },
      });
    } else if (f.method === 'getCapabilities') {
      const p = probeFixture();
      if (!p) {
        send({
          v: 1,
          type: 'response',
          requestId: f.requestId,
          status: 'error',
          error: { code: 'PI_NOT_FOUND', message: 'Pi executable not found (fixture)' },
        });
      } else if (!p.rpcSupported) {
        send({
          v: 1,
          type: 'response',
          requestId: f.requestId,
          status: 'error',
          error: { code: 'PI_INCOMPATIBLE', message: 'Pi 9.9.9 does not advertise RPC mode (fixture)' },
        });
      } else {
        send({
          v: 1,
          type: 'response',
          requestId: f.requestId,
          status: 'ok',
          result: {
            protocolVersion: 1,
            methods: ['health', 'getRuntimeInfo', 'getCapabilities', 'ping'],
            pi: { version: p.version, rpcSupported: p.rpcSupported },
          },
        });
      }
    } else {
      send({
        v: 1,
        type: 'response',
        requestId: f.requestId,
        status: 'error',
        error: { code: 'METHOD_NOT_ALLOWED', message: 'no' },
      });
    }
  }
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
