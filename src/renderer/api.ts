import type { RendererSnapshot } from './types';

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
