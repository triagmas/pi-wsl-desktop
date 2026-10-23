/**
 * M4 R01 security closure (owner variant B): the ONLY sanctioned NSIS
 * extension is build/nsis-guard.nsh — three electron-builder hook macros
 * (customInit before any file operation, customInstall marker write,
 * customUnInstall ownership check). The contract pins the include name and
 * an instruction allow-list so the guard can never grow install-time
 * capabilities (no process execution, no registry writes, no deletion).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  build?: { nsis?: Record<string, unknown> };
};
const guardPath = path.join(root, 'build', 'nsis-guard.nsh');

describe('NSIS security guard contract', () => {
  it('is wired as the single sanctioned nsis.include', () => {
    expect(pkg.build?.nsis?.include).toBe('nsis-guard.nsh');
  });

  it('exists at build/nsis-guard.nsh', () => {
    expect(existsSync(guardPath)).toBe(true);
  });

  it('defines the three lifecycle hooks and the ownership marker', () => {
    const src = readFileSync(guardPath, 'utf8');
    expect(src).toContain('!macro customInit');
    expect(src).toContain('!macro customInstall');
    expect(src).toContain('!macro customUnInstall');
    expect(src).toContain('!define INSTALL_MARKER');
    expect(src).toContain('.pi-desktop-install-marker');
  });

  it('rejects dangerous /D= installs before any file operation', () => {
    const src = readFileSync(guardPath, 'utf8');
    const init = src.slice(src.indexOf('!macro customInit'), src.indexOf('!macro customInstall'));
    expect(init).toContain('Abort');
    expect(init).toContain('$INSTDIR');
    // the marker check must gate the abort decision
    expect(init).toContain('INSTALL_MARKER');
    // and this must run before extraction: customInit only (customInstall
    // is documented as post-extraction) — init must NOT write files
    expect(init).not.toMatch(/FileOpen|FileWrite|RMDir|Delete /);
  });

  it('quits the uninstaller when ownership cannot be proven', () => {
    const src = readFileSync(guardPath, 'utf8');
    const un = src.slice(src.indexOf('!macro customUnInstall'));
    expect(un).toContain('Quit');
    expect(un).toContain('INSTALL_MARKER');
    // no direct deletion in the guard — the default template handles
    // removal only after the ownership check passes
    expect(un).not.toMatch(/RMDir \/r|Delete /);
  });

  /**
   * TRUE instruction allow-list: strip comments, then every statement must
   * be one of the sanctioned operations — anything else (Exec, Delete,
   * WriteRegDWORD, lowercase spellings, ...) is a contract violation.
   */
  const ALLOWED_STATEMENTS = new Set(
    [
      'strcmp', 'strlen', 'findfirst', 'findnext', 'findclose', 'clearerrors', 'iferrors',
      'goto', 'iffileexists', 'fileopen', 'filewrite', 'fileclose',
      'messagebox', 'abort', 'quit',
      '${if}', '${ifnot}', '${endif}', '${silent}', '${fileexists}',
      '!ifndef', '!define', '!endif', '!macro', '!macroend',
    ].map((t) => t.toLowerCase()),
  );
  const assertAllowList = (src: string, label: string) => {
    const lines = src
      .split('\n')
      .map((l) => l.replace(/;.*/, '').trim())
      .filter((l) => l.length > 0);
    for (const line of lines) {
      if (line.endsWith(':')) continue; // labels
      const token = line.split(/\s+/)[0].toLowerCase();
      if (!ALLOWED_STATEMENTS.has(token)) {
        throw new Error(`${label}: statement not on the allow-list: "${line}"`);
      }
    }
  };

  it('passes a strict statement allow-list (comments stripped)', () => {
    const src = readFileSync(guardPath, 'utf8');
    assertAllowList(src, 'nsis-guard.nsh');
  });

  it('rejects injected statements outside the allow-list (mutations)', () => {
    const src = readFileSync(guardPath, 'utf8');
    const injections = [
      'Exec "notepad.exe"',
      'ExecWait "$INSTDIR\\evil.exe"',
      'ExecShell "open" "http://x"',
      'Delete "$INSTDIR\\important.file"',
      'RMDir /r "$INSTDIR"',
      'WriteRegDWORD HKCU "Software\\x" "v" 1',
      'nsExec::ExecToLog "cmd /c del"',
      'wsl.exe --unregister Ubuntu',
      'taskkill /F /IM explorer.exe',
    ];
    for (const payload of injections) {
      const mutated = src.replace('!macro customInstall', `${payload}\n!macro customInstall`);
      expect(() => assertAllowList(mutated, payload), `must reject: ${payload}`).toThrow();
    }
  });

  it('only ever opens/writes the ownership marker file (fail-closed)', () => {
    const src = readFileSync(guardPath, 'utf8');
    const lines = src
      .split('\n')
      .map((l) => l.replace(/;.*/, ''))
      .filter((l) => l.trim().length > 0);
    // canonical: fileopen $h "$INSTDIR\${INSTALL_MARKER}" w — anything else
    // (unquoted paths, other handles, other modes, hidden mid-line uses) is
    // rejected fail-closed: NSIS accepts unquoted operands, so a bare
    // regex over quoted forms would be bypassable.
    const canonicalOpen =
      /^\s*fileopen\s+\$[a-z]\w*\s+"\$instdir\\\$\{install_marker\}"\s+w\s*$/i;
    const openedHandles = new Set<string>();
    let openCount = 0;
    for (const line of lines) {
      if (/\bfileopen\b/i.test(line)) {
        if (!canonicalOpen.test(line)) {
          throw new Error(`non-canonical FileOpen rejected: "${line.trim()}"`);
        }
        openCount += 1;
        const h = line.trim().split(/\s+/)[1];
        openedHandles.add(h.toLowerCase());
      }
      if (/\bfilewrite\b/i.test(line)) {
        const m = line.match(/^\s*filewrite\s+(\$\w+)\s+/i);
        if (!m || !openedHandles.has(m[1].toLowerCase())) {
          throw new Error(`FileWrite to a non-marker handle rejected: "${line.trim()}"`);
        }
      }
    }
    expect(openCount).toBeGreaterThan(0);
  });

  it('rejects every non-canonical file operation form (fail-closed)', () => {
    const src = readFileSync(guardPath, 'utf8');
    const bad = [
      'FileOpen $R6 $TEMP\\foreign.txt w',
      "FileOpen $R6 '$TEMP\\foreign.txt' w",
      'FileOpen $R7 "$INSTDIR\\foreign.txt" w',
      'FileOpen $R6 "$INSTDIR\\${INSTALL_MARKER}" r',
      'fileopen $R6 "$INSTDIR\\foreign.txt" w',
      'StrCmp $R8 "." x0 FileOpen $R6 $TEMP\\x w',
      'FileWrite $R7 "untrusted"',
    ];
    for (const payload of bad) {
      const mutated = src.replace('!macro customInstall', `${payload}\n!macro customInstall`);
      const lines = mutated
        .split('\n')
        .map((l) => l.replace(/;.*/, ''))
        .filter((l) => l.trim().length > 0);
      const canonicalOpen =
        /^\s*fileopen\s+\$[a-z]\w*\s+"\$instdir\\\$\{install_marker\}"\s+w\s*$/i;
      const handles = new Set<string>();
      let threw = false;
      try {
        for (const line of lines) {
          if (/\bfileopen\b/i.test(line)) {
            if (!canonicalOpen.test(line)) throw new Error('open');
            handles.add(line.trim().split(/\s+/)[1].toLowerCase());
          }
          if (/\bfilewrite\b/i.test(line)) {
            const m = line.match(/^\s*filewrite\s+(\$\w+)\s+/i);
            if (!m || !handles.has(m[1].toLowerCase())) throw new Error('write');
          }
        }
      } catch {
        threw = true;
      }
      expect(threw, `must reject: ${payload}`).toBe(true);
    }
  });

  it('never performs process execution or registry writes', () => {
    const src = readFileSync(guardPath, 'utf8');
    for (const banned of ['ExecShell', 'ExecWait', 'nsExec', 'WScript', 'WriteRegStr', 'DeleteRegKey', 'RegDelete', 'wsl.exe', 'taskkill']) {
      expect(src).not.toContain(banned);
    }
  });
});
