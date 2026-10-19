/**
 * Connection orchestrator: drives the state machine through discovery →
 * spawn → ready, with capped auto-retries, backoff and manual retry.
 * One persistent bridge per connection; selectDistro restarts the stack.
 */
import { BridgeError } from '../shared/errors';
import { BridgeClient } from './bridgeClient';
import { initialState, reduce, type ConnEvent, type ConnSnapshot } from './state';
import { listDistros, probeNode, startBridgeProcess } from './wsl';
import { windowsPathToWslPath } from './wslParse';

export interface Timeouts {
  listMs?: number;
  probeMs?: number;
  readyMs?: number;
  requestMs?: number;
}

export interface ConnectionOptions {
  bridgeWinPath: string;
  wslPath?: string;
  env?: Record<string, string | undefined>;
  distro?: string;
  maxAutoAttempts?: number;
  backoffMs?: number[];
  timeouts?: Timeouts;
}

export interface ConnectionSnapshot extends ConnSnapshot {
  distro: string | null;
  runtime: unknown;
  distros: string[] | null;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class WslConnection {
  private state: ConnSnapshot = initialState();
  private readonly subscribers = new Set<(s: ConnectionSnapshot) => void>();
  private client: BridgeClient | null = null;
  private backoffTimer: NodeJS.Timeout | null = null;
  private runToken = 0;
  private closed = false;
  private currentDistro: string;
  private distrosCache: string[] | null = null;
  private runtime: unknown = null;

  constructor(private readonly opts: ConnectionOptions) {
    this.currentDistro = opts.distro ?? opts.env?.PI_WS_DESKTOP_DISTRO ?? '';
  }

  snapshot(): ConnectionSnapshot {
    return {
      ...this.state,
      distro: this.currentDistro || null,
      runtime: this.runtime,
      distros: this.distrosCache,
    };
  }

  subscribe(cb: (s: ConnectionSnapshot) => void): () => void {
    this.subscribers.add(cb);
    cb(this.snapshot());
    return () => this.subscribers.delete(cb);
  }

  private dispatch(e: ConnEvent): void {
    this.state = reduce(this.state, e, { maxAutoAttempts: this.opts.maxAutoAttempts ?? 5 });
    const snap = this.snapshot();
    for (const cb of this.subscribers) cb(snap);
  }

  listDistros(): Promise<string[]> {
    return listDistros({
      wslPath: this.opts.wslPath,
      env: this.opts.env,
      timeoutMs: this.opts.timeouts?.listMs ?? 10_000,
    });
  }

  start(): void {
    if (this.closed) return;
    this.dispatch({ type: 'DISCOVER_START' });
    void this.attempt();
  }

  retry(): void {
    if (this.closed) return;
    this.dispatch({ type: 'RETRY_MANUAL' });
    void this.attempt();
  }

  selectDistro(distro: string): void {
    if (this.closed) return;
    this.currentDistro = distro;
    this.restart();
  }

  private restart(): void {
    this.runToken += 1;
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
    this.client?.close();
    this.client = null;
    this.runtime = null;
    this.dispatch({ type: 'DISCOVER_START' });
    void this.attempt();
  }

  private async attempt(): Promise<void> {
    const token = ++this.runToken;
    const t = this.opts.timeouts ?? {};
    try {
      const distros = await listDistros({
        wslPath: this.opts.wslPath,
        env: this.opts.env,
        timeoutMs: t.listMs ?? 10_000,
      });
      if (token !== this.runToken) return;
      this.distrosCache = distros;
      const distro = this.currentDistro || this.opts.env?.PI_WS_DESKTOP_DISTRO || distros[0];
      if (!distros.includes(distro)) {
        throw new BridgeError('WSL_UNAVAILABLE', `distribution not found: ${distro}`);
      }
      this.currentDistro = distro;

      const bridgeWslPath =
        windowsPathToWslPath(this.opts.bridgeWinPath) ??
        (this.opts.bridgeWinPath.startsWith('/') ? this.opts.bridgeWinPath : null);
      if (!bridgeWslPath) {
        throw new BridgeError('WSL_UNAVAILABLE', `unsupported bridge path: ${this.opts.bridgeWinPath}`);
      }

      const probe = await probeNode({
        wslPath: this.opts.wslPath,
        env: this.opts.env,
        distro,
        bridgeWslPath,
        nodeOverride: this.opts.env?.PI_WS_DESKTOP_NODE,
        timeoutMs: t.probeMs ?? 10_000,
      });
      if (token !== this.runToken) return;
      if (!probe.ok || !probe.nodePath) {
        throw new BridgeError('NODE_NOT_FOUND', probe.reason ?? 'node not found in WSL');
      }
      if (probe.bridgeOk === false) {
        throw new BridgeError('WSL_UNAVAILABLE', 'bridge bundle is not reachable inside WSL');
      }

      this.dispatch({ type: 'DISCOVER_OK' });

      const child = startBridgeProcess({
        wslPath: this.opts.wslPath,
        env: this.opts.env,
        distro,
        nodePath: probe.nodePath,
        bridgeWslPath,
      });
      if (token !== this.runToken) {
        child.kill('SIGTERM');
        return;
      }
      this.dispatch({ type: 'SPAWNED' });

      const client = new BridgeClient({ spawn: () => child, requestTimeoutMs: t.requestMs ?? 10_000 });
      this.client = client;
      client.on('lost', () => {
        if (token !== this.runToken || this.closed) return;
        this.dispatch({ type: 'LOST' });
        this.scheduleBackoff(token);
      });

      let readyResolved = false;
      const ready = new Promise<void>((resolve) => {
        client.on('ready', () => {
          readyResolved = true;
          resolve();
        });
      });
      client.connect();
      await Promise.race([ready, delay(t.readyMs ?? 10_000)]);
      if (token !== this.runToken) return;
      if (!readyResolved) {
        client.close();
        this.dispatch({ type: 'CONNECT_TIMEOUT' });
        this.scheduleBackoff(token);
        return;
      }

      try {
        this.runtime = await client.request('getRuntimeInfo', {}, { timeoutMs: t.requestMs ?? 10_000 });
      } catch {
        this.runtime = null; // ready without runtime info is still a live connection
      }
      if (token !== this.runToken) return;
      this.dispatch({ type: 'READY' });
    } catch (err) {
      if (token !== this.runToken) return;
      this.dispatch({
        type: 'DISCOVER_FAIL',
        retryable: true,
        error: {
          code: err instanceof BridgeError ? err.code : 'WSL_UNAVAILABLE',
          message: err instanceof Error ? err.message : String(err),
        },
      });
      this.scheduleBackoff(token);
    }
  }

  private scheduleBackoff(token: number): void {
    if (this.closed || token !== this.runToken) return;
    if (this.state.phase !== 'backoff') return; // retries exhausted → manual retry only
    const delays = this.opts.backoffMs ?? [1000, 2000, 5000, 10_000, 10_000];
    const idx = Math.max(Math.min(this.state.attempt - 1, delays.length - 1), 0);
    this.backoffTimer = setTimeout(() => {
      if (token !== this.runToken || this.closed) return;
      this.dispatch({ type: 'BACKOFF_DONE' });
      void this.attempt();
    }, delays[idx]);
  }

  request(method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<unknown> {
    if (!this.client || this.state.phase !== 'ready') {
      return Promise.reject(new BridgeError('DISCONNECTED', 'connection is not ready'));
    }
    return this.client.request(method, params, options);
  }

  close(): void {
    this.closed = true;
    this.runToken += 1;
    if (this.backoffTimer) {
      clearTimeout(this.backoffTimer);
      this.backoffTimer = null;
    }
    this.client?.close();
    this.client = null;
    this.runtime = null;
    this.state = initialState();
    const snap = this.snapshot();
    for (const cb of this.subscribers) cb(snap);
  }
}
