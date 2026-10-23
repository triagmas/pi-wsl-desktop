/** Minimal window typing for Playwright evaluate() callbacks (node tsconfig has no DOM lib). */
declare const window: {
  piDesktop?: {
    request(method: string, params?: Record<string, unknown>): Promise<unknown>;
    getStatus(): Promise<unknown>;
    retry(): Promise<unknown>;
    listDistros(): Promise<string[]>;
    selectDistro(distro: string): Promise<unknown>;
    onStateChange(callback: (snapshot: unknown) => void): () => void;
    onChatEvent(callback: (payload: unknown) => void): () => void;
    getAppearance(): Promise<unknown>;
    saveAppearance(settings: unknown): Promise<unknown>;
    resetAppearance(): Promise<unknown>;
  };
  process?: unknown;
  require?: unknown;
  module?: unknown;
};
