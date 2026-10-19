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
}

declare global {
  interface Window {
    piDesktop?: DesktopApi;
  }
}

export function getDesktopApi(): DesktopApi | null {
  return window.piDesktop ?? null;
}
