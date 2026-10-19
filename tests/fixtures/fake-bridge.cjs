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
 */
const fs = require('node:fs');

const mode = process.env.FAKE_BRIDGE_MODE || 'ok';
const log = process.env.FAKE_BRIDGE_LOG;
const logLine = (s) => {
  if (log) fs.appendFileSync(log, s + '\n');
};

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

if (mode !== 'never-ready') {
  send({ v: 1, type: 'event', event: 'ready', payload: { fixture: true } });
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
      send({
        v: 1,
        type: 'response',
        requestId: f.requestId,
        status: 'ok',
        result: {
          distro: 'FakeDistro',
          node: { path: '/fake/node', version: 'v22.1.0' },
          pi: { path: '/home/fake/.local/bin/pi', version: '9.9.9', rpcSupported: true },
          agentDir: '/home/fake/.pi/agent',
        },
      });
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
