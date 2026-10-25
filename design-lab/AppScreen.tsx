/**
 * Design Lab — «Приложение»: целостный главный экран (Issue #21, D1, этап 2).
 *
 * Эталон: Reference/01-chat-review-terminal.png (холст 1586×992, замер PIL —
 * --dl-app-* в layout.css). Композиция ТОЛЬКО из одобренных компонентов
 * src/renderer/ui/* + токены --pw-*; управление — локальный UI-state
 * (терминал / панель изменений), без Electron, Pi, WSL, IPC и user ~/.pi.
 *
 * Геометрические альтернативы (?variant=a|b) — owner-gate, применяются ЦЕЛИКОМ
 * на уровне CSS-переменных, варианты не смешиваются:
 *   a — IMPLEMENTATION-PROMPT.md: titlebar 44, statusbar 28, left 260, right 340;
 *   b — DESIGN-UPDATE.md v3:      titlebar 36, statusbar 26, left 240, right 360;
 *   без variant — текущий замер эталона D: 39 / 48 / 321 / 385.
 */
import { useState } from 'react';
import { AppFrame } from '../src/renderer/ui/AppFrame';
import { ChatView } from '../src/renderer/ui/ChatView';
import { Sidebar } from '../src/renderer/ui/Sidebar';
import { StatusBar } from '../src/renderer/ui/StatusBar';
import { TerminalPane } from '../src/renderer/ui/TerminalPane';
import { IconChevronDown, IconDots, IconPanelExpand } from '../src/renderer/ui/icons';
import * as F from './fixtures';

export type AppVariant = 'a' | 'b';

export function AppScreen({ variant }: { variant?: AppVariant }) {
  const [terminal, setTerminal] = useState(true);
  const [details, setDetails] = useState(true);

  const frame = (
    <AppFrame
      layout="app"
      theme="dark"
      side={
        <Sidebar
          header={F.SIDEBAR_HEADER}
          projectsTitle={
            <span className="dl-side-label-app">
              <IconChevronDown size={15} />
              Проекты
            </span>
          }
          searchFirst
          searchPlaceholder="Поиск диалогов"
          projects={F.APP_SIDEBAR_PROJECTS}
          nav={F.APP_NAV}
          activeSessionId="search-history"
        />
      }
      details={
        details
          ? {
              header: F.CHANGES_HEAD,
              body: F.CHANGES_BODY,
            }
          : null
      }
      statusBar={
        <StatusBar
          branch={F.STATUS_BRANCH}
          connection={{ label: 'Pi готов' }}
          distro="Ubuntu · WSL"
          right={F.STATUS_RIGHT}
          terminalLabel="Терминал"
          onTerminalToggle={() => setTerminal((on) => !on)}
          terminalActive={terminal}
        />
      }
      terminal={terminal}
    >
      <div className="dl-app-crumb">
        <div className="dl-crumb">{F.BREADCRUMB_APP}</div>
        <div className="dl-toolbar-actions">
          <button type="button" className="dl-btn-ghost dl-toolbar-dots" aria-label="Ещё действия">
            <IconDots size={19} />
          </button>
          <button
            type="button"
            className={details ? 'dl-btn-accent dl-toolbar-expand' : 'dl-btn-ghost dl-toolbar-dots'}
            aria-label="Показать панель изменений"
            aria-expanded={details}
            onClick={() => setDetails((on) => !on)}
          >
            <IconPanelExpand size={22} />
          </button>
        </div>
      </div>
      <ChatView
        turns={F.TURNS_APP}
        composer={{ density: 'compact', context: 'Контекст 18%', placeholder: 'Сообщение или /команда', model: 'Модель А' }}
        stepCircle={32}
        showIdentity={false}
        terminal={terminal ? <TerminalPane tabs={F.APP_TERMINAL_TABS} lines={F.APP_TERMINAL_LINES} /> : undefined}
      />
    </AppFrame>
  );

  if (!variant) {
    return frame;
  }
  return (
    <div className="dl-variant-root" data-variant={variant}>
      {frame}
    </div>
  );
}
