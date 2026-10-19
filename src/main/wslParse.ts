/**
 * Parsers for Windows-side WSL interop output.
 *
 * Empirically (Windows 11, WSL 2.7.11): `wsl.exe -l -q` writes UTF-16LE with
 * CRLF and no BOM. The decoder never assumes encoding — it strips a BOM when
 * present, uses a NUL-byte heuristic for BOM-less UTF-16, and otherwise reads
 * UTF-8. No JSON or localized-output assumptions are made.
 */

const utf16Le = new TextDecoder('utf-16le');
const utf16Be = new TextDecoder('utf-16be');
const utf8 = new TextDecoder('utf-8');

export function decodeWslOutput(buf: Uint8Array): string {
  if (buf.length === 0) return '';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return utf16Le.decode(buf.subarray(2));
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return utf16Be.decode(buf.subarray(2));
  }
  const probe = Math.min(buf.length, 2048);
  for (let i = 0; i < probe; i++) {
    if (buf[i] === 0) {
      return utf16Le.decode(buf);
    }
  }
  const text = utf8.decode(buf);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function parseDistroList(output: string): string[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s*\(Default\)$/, '').trim())
    .filter((line) => line.length > 0);
}

/**
 * Convert a Windows path to its WSL counterpart.
 * `F:\a\b` → `/mnt/f/a/b`; `\\wsl$\Distro\home\u` → `/home/u`.
 * Returns null for relative paths, generic UNC paths and anything unrecognised.
 */
export function windowsPathToWslPath(winPath: string, mountRoot = '/mnt'): string | null {
  if (!winPath) return null;

  const wslUnc = /^\\\\wsl(?:\$|\.localhost)\\[^\\]+(\\.*)?$/.exec(winPath);
  if (wslUnc) {
    const rest = (wslUnc[1] ?? '').replace(/\\/g, '/');
    return rest === '' ? '/' : rest;
  }

  const drive = /^([a-zA-Z]):(?:[\\/](.*))?$/.exec(winPath);
  if (drive) {
    const rest = (drive[2] ?? '').replace(/\\/g, '/').replace(/\/+$/, '');
    const base = `${mountRoot}/${drive[1].toLowerCase()}`;
    return rest === '' ? base : `${base}/${rest}`;
  }

  return null;
}
