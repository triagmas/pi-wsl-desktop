import type { ErrorCode } from './protocol';

/** Error type used across bridge, client and discovery; carries a stable protocol error code. */
export class BridgeError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BridgeError';
  }
}
