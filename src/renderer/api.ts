import type { RendererSnapshot } from './types';
import type { TerminalEvent, TerminalOpenRequest, TerminalSession } from '../shared/terminal';
import type { MetricsSample } from '../shared/terminalMetrics';

/** Typed facade over the preload contextBridge API. */
export interface DesktopApi {
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  getStatus(): Promise<RendererSnapshot>;
  retry(): Promise<RendererSnapshot>;
  listDistros(): Promise<string[]>;
  selectDistro(distro: string): Promise<RendererSnapshot>;
  onStateChange(callback: (snapshot: RendererSnapshot) => void): () => void;
  onChatEvent(callback: (payload: unknown) => void): () => void;
  /** Versioned appearance settings (theme/typography/layout), §9.1 item 5. */
  getAppearance(): Promise<unknown>;
  saveAppearance(settings: unknown): Promise<unknown>;
  resetAppearance(): Promise<unknown>;
  /**
   * UI-B: настоящий PTY в WSL. Каналы типизированы и узки: открыть/писать/
   * изменить размер/закрыть — никакого произвольного shell IPC у renderer нет.
   * Отсутствует на тестовых хостах и до инъекции preload (fail closed).
   */
  terminal?: {
    open(request: TerminalOpenRequest): Promise<TerminalSession>;
    write(id: string, dataB64: string): Promise<boolean>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    close(id: string): Promise<void>;
    onEvent(callback: (event: TerminalEvent) => void): () => void;
  };
  /** UI-B: снимок CPU/RAM Windows-хоста из main-процесса. */
  getMetrics?(): Promise<MetricsSample>;
  /** D2 frameless window: absent on test hosts and before preload injection. */
  windowControls?: {
    minimize(): Promise<void>;
    maximize(): Promise<void>;
    close(): Promise<void>;
  };
}

declare global {
  interface Window {
    piDesktop?: DesktopApi;
  }
}

export function getDesktopApi(): DesktopApi | null {
  return window.piDesktop ?? null;
}
