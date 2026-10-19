import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeWslOutput,
  parseDistroList,
  windowsPathToWslPath,
} from '../../src/main/wslParse';

const fixtures = path.join(__dirname, '..', 'fixtures');
const realList = readFileSync(path.join(fixtures, 'wsl-list-quiet-utf16.bin'));
const bomCjkList = readFileSync(path.join(fixtures, 'wsl-list-quiet-utf16-bom-cjk.bin'));

describe('decodeWslOutput', () => {
  it('decodes real wsl.exe -l -q UTF-16LE capture to the distro list text', () => {
    expect(decodeWslOutput(realList)).toBe('Ubuntu\r\n');
  });

  it('decodes UTF-16LE with BOM and CRLF incl. non-ASCII names', () => {
    expect(decodeWslOutput(bomCjkList)).toBe('Ubuntu\r\nUbuntu中文\r\n');
  });

  it('passes plain UTF-8 through', () => {
    expect(decodeWslOutput(Buffer.from('Ubuntu\nDebian\n', 'utf8'))).toBe('Ubuntu\nDebian\n');
  });

  it('handles empty output', () => {
    expect(decodeWslOutput(Buffer.alloc(0))).toBe('');
  });

  it('decodes UTF-16BE with BOM', () => {
    const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('Ubuntu\r\n', 'utf16le').swap16()]);
    expect(decodeWslOutput(buf)).toBe('Ubuntu\r\n');
  });
});

describe('parseDistroList', () => {
  it('parses the real fixture into ["Ubuntu"]', () => {
    expect(parseDistroList(decodeWslOutput(realList))).toEqual(['Ubuntu']);
  });

  it('parses multiple distros with CRLF and non-ASCII names', () => {
    expect(parseDistroList(decodeWslOutput(bomCjkList))).toEqual(['Ubuntu', 'Ubuntu中文']);
  });

  it('parses LF-only lists and trims stray spaces', () => {
    expect(parseDistroList('Ubuntu\n Debian \n\n')).toEqual(['Ubuntu', 'Debian']);
  });

  it('returns [] for empty or blank output', () => {
    expect(parseDistroList('')).toEqual([]);
    expect(parseDistroList('\r\n\r\n')).toEqual([]);
  });

  it('strips a defensive " (Default)" suffix', () => {
    expect(parseDistroList('Ubuntu (Default)\r\nDebian\r\n')).toEqual(['Ubuntu', 'Debian']);
  });
});

describe('windowsPathToWslPath', () => {
  it.each([
    ['F:\\a\\b', '/mnt/f/a/b'],
    ['F:/a/b', '/mnt/f/a/b'],
    ['f:\\a', '/mnt/f/a'],
    ['F:', '/mnt/f'],
    ['F:\\', '/mnt/f'],
    ['C:\\Users\\user\\x', '/mnt/c/Users/user/x'],
    ['\\\\wsl$\\Ubuntu\\home\\user', '/home/user'],
    ['\\\\wsl.localhost\\Ubuntu\\home\\user\\sub dir', '/home/user/sub dir'],
  ])('converts %s -> %s', (input, expected) => {
    expect(windowsPathToWslPath(input)).toBe(expected);
  });

  it('supports a custom automount root', () => {
    expect(windowsPathToWslPath('F:\\a', '/x')).toBe('/x/f/a');
  });

  it('returns null for relative, empty, generic UNC and garbage input', () => {
    expect(windowsPathToWslPath('relative/path')).toBeNull();
    expect(windowsPathToWslPath('')).toBeNull();
    expect(windowsPathToWslPath('\\\\server\\share\\x')).toBeNull();
    expect(windowsPathToWslPath('nota path:')).toBeNull();
  });
});
