/**
 * Design Lab — «Приложение»: адаптер ЕДИНОЙ композиции ui/AppScreen
 * над fixture-данными (Issue #21, D1/D3).
 *
 * Композиция больше не задаётся здесь: её владеет src/renderer/ui/AppScreen
 * (одна для Design Lab и Electron). Этот файл — только data+callbacks.
 * Геометрические альтернативы (?variant=a|b) — owner-gate, применяются
 * ЦЕЛИКОМ на уровне CSS-переменных, варианты не смешиваются.
 */
import { useState } from 'react';
import { AppScreen } from '../src/renderer/ui/AppScreen';
import { ChatView } from '../src/renderer/ui/ChatView';
import { SessionTabs, type SessionTabMode } from '../src/renderer/ui/SessionTabs';
import { Sidebar } from '../src/renderer/ui/Sidebar';
import { TerminalPane } from '../src/renderer/ui/TerminalPane';
import { IconChevronDown, IconDots, IconPanelExpand } from '../src/renderer/ui/icons';
import * as F from './fixtures';

export type AppVariant = 'a' | 'b';

export function AppScreenLab({ variant }: { variant?: AppVariant }) {
  const [terminal, setTerminal] = useState(true);
  const [details, setDetails] = useState(true);
  // L1: тот же таб-переключатель, что в продукте (общий ui/SessionTabs).
  const [sessionTab, setSessionTab] = useState<SessionTabMode>('chat');

  const frame = (
    <AppScreen
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
      statusBar={{
        branch: F.STATUS_BRANCH,
        connection: { label: 'Pi готов' },
        distro: 'Ubuntu · WSL',
        right: F.STATUS_RIGHT,
        terminalLabel: 'Терминал',
        onTerminalToggle: () => setTerminal((on) => !on),
        terminalActive: terminal,
      }}
      header={{
        crumb: F.BREADCRUMB_APP,
        actions: (
          <>
            <SessionTabs mode={sessionTab} onChange={setSessionTab} />
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
          </>
        ),
      }}
      body={
        sessionTab === 'history' ? (
          /* L1: честный слот истории Design Lab (без Pi/WSL/IPC — как PTY-слот) */
          <div className="dl-notice" data-testid="history-stub">
            Лента истории читается из сессии Pi в WSL — Design Lab показывает честный
            пустой слот (fixture-режим).
          </div>
        ) : (
        <ChatView
          turns={F.TURNS_APP}
          composer={{ density: 'compact', context: 'Контекст 18%', placeholder: 'Сообщение или /команда', model: 'Модель А' }}
          stepCircle={32}
          showIdentity={false}
          terminal={terminal ? <TerminalPane tabs={F.APP_TERMINAL_TABS} lines={F.APP_TERMINAL_LINES} /> : undefined}
        />
        )
      }
    />
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
