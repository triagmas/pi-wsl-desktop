/**
 * UI-B R01 — PTY-помощник внутри WSL.
 *
 * Скрипт на python3 (stdlib: pty/fcntl/termios/select) поднимает настоящий
 * `/dev/pts/N` для выбранного шелла и говорит с main-процессом по NDJSON:
 *   main -> helper: {"t":"in","d":"<b64>"} | {"t":"resize","c":N,"r":N} | {"t":"close"}
 *   helper -> main: {"t":"ready","pid":N,"cwd":"/p"} | {"t":"out","d":"<b64>"}
 *                   {"t":"notice","code":"CWD_FALLBACK","message":"…"} | {"t":"exit","code":N}
 *
 * Почему python, а не node-pty: node в WSL не умеет allocate pty без нативного
 * модуля (rebuild под ABI Electron, ConPTY на стороне Windows), а python3 в
 * Ubuntu WSL уже есть. Скрипт передаётся base64-строкой и не интерполируется —
 * ни distro, ни cwd не попадают в текст программы.
 */
import { TerminalError, clampCols, clampRows, isSafeDistroName, isTerminalCwd } from '../shared/terminal';

export const PTY_HELPER_SOURCE = `import os, sys, json, base64, select, signal, struct, fcntl, termios


def send(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\\n")
    sys.stdout.flush()


def main():
    cols = int(sys.argv[1]); rows = int(sys.argv[2]); cwd = sys.argv[3]; shell = sys.argv[4] or "/bin/bash"
    notice = None
    try:
        os.chdir(cwd)
    except OSError:
        os.chdir(os.path.expanduser("~"))
        notice = {"t": "notice", "code": "CWD_FALLBACK",
                  "message": "Проект недоступен: терминал открыт в домашнем каталоге"}
    if not os.access(shell, os.X_OK):
        for cand in ("/bin/bash", "/usr/bin/bash", "/bin/sh"):
            if os.access(cand, os.X_OK):
                shell = cand
                break
        else:
            send({"t": "notice", "code": "SHELL_FALLBACK",
                  "message": "Шелл не найден в дистрибутиве: терминал не запущен"})
            send({"t": "exit", "code": 127})
            return
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env.setdefault("LANG", "C.UTF-8")
    pid, master = os.forkpty()
    if pid == 0:
        try:
            os.execvpe(shell, [shell, "-l"], env)
        except Exception:
            os._exit(127)
    try:
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    except OSError:
        pass
    send({"t": "ready", "pid": pid, "cwd": os.getcwd()})
    if notice:
        send(notice)
    stdin_fd = sys.stdin.fileno()
    buf = b""
    while True:
        r, _, _ = select.select([master, stdin_fd], [], [], 0.25)
        if master in r:
            try:
                data = os.read(master, 65536)
            except OSError:
                data = b""
            if not data:
                break
            send({"t": "out", "d": base64.b64encode(data).decode("ascii")})
        if stdin_fd in r:
            chunk = os.read(stdin_fd, 65536)
            if not chunk:
                try:
                    os.kill(pid, signal.SIGHUP)
                except OSError:
                    pass
                break
            buf += chunk
            while b"\\n" in buf:
                line, buf = buf.split(b"\\n", 1)
                if not line.strip():
                    continue
                try:
                    msg = json.loads(line.decode("utf-8"))
                except ValueError:
                    continue
                kind = msg.get("t")
                if kind == "in":
                    try:
                        os.write(master, base64.b64decode(msg.get("d") or ""))
                    except OSError:
                        pass
                elif kind == "resize":
                    try:
                        c = max(2, min(400, int(msg.get("c") or cols)))
                        rr = max(1, min(200, int(msg.get("r") or rows)))
                        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rr, c, 0, 0))
                        os.kill(pid, signal.SIGWINCH)
                    except (OSError, ValueError):
                        pass
                elif kind == "close":
                    try:
                        os.kill(pid, signal.SIGHUP)
                    except OSError:
                        pass
                    buf = b""
                    break
        try:
            wpid, status = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            send({"t": "exit", "code": 0})
            return
        if wpid == pid:
            while True:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    break
                if not data:
                    break
                send({"t": "out", "d": base64.b64encode(data).decode("ascii")})
            try:
                code = os.waitstatus_to_exitcode(status)
            except ValueError:
                code = None
            send({"t": "exit", "code": code})
            return
    try:
        os.close(master)
    except OSError:
        pass
    send({"t": "exit", "code": None})


main()
`;

/**
 * Обёртка вокруг скрипта: раскодирует base64 и подставляет argv так, будто
 * запущен файл (argv[0] — имя программы, argv[1] — cols).
 */
export const PYTHON_RUNNER =
  'import base64,sys;src=base64.b64decode(sys.argv[1]);sys.argv=sys.argv[1:];exec(compile(src,"<pty-helper>","exec"))';

export const PTY_HELPER_B64 = Buffer.from(PTY_HELPER_SOURCE, 'utf8').toString('base64');

export interface PtyArgvOptions {
  distro: string;
  cwd: string;
  cols: number;
  rows: number;
  pythonPath?: string;
  shell?: string;
}

/**
 * argv для wsl.exe (без строки shell): distro/cwd уже провалидированы,
 * размеры клэмпятся, скрипт передаётся одной base64-строкой.
 */
export function buildPtyArgv(options: PtyArgvOptions): string[] {
  if (!isSafeDistroName(options.distro)) {
    throw new TerminalError('TERMINAL_BAD_DISTRO', `недопустимое имя дистрибутива: ${String(options.distro)}`);
  }
  if (!isTerminalCwd(options.cwd)) {
    throw new TerminalError('TERMINAL_BAD_CWD', `недопустимый путь проекта: ${String(options.cwd)}`);
  }
  const cols = clampCols(options.cols);
  const rows = clampRows(options.rows);
  return [
    '-d',
    options.distro,
    '--exec',
    options.pythonPath ?? 'python3',
    '-u',
    '-c',
    PYTHON_RUNNER,
    PTY_HELPER_B64,
    String(cols),
    String(rows),
    options.cwd,
    options.shell ?? '/bin/bash',
  ];
}
