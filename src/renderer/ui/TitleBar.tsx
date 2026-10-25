/**
 * Design Lab — TitleBar (Issue #21, D1). Только представление: кросс-платформенные
 * кнопки окна декоративны до интеграции (обработчики — опциональные пропсы D2/D3).
 * inline-layout: wordmark | breadcrumb (отступ = sidebar + 44px) | window controls.
 * split-layout: breadcrumb живёт в Toolbar (см. AppFrame), здесь только wordmark.
 */
import type { ReactNode } from 'react';
import { IconMaximize, IconMinimize, IconClose } from './icons';

export interface TitleBarProps {
  wordmark?: string;
  breadcrumb?: ReactNode;
  onMinimize?: () => void;
  onMaximize?: () => void;
  onClose?: () => void;
}

export function TitleBar({ wordmark = 'π Pi WSL Desktop', breadcrumb, onMinimize, onMaximize, onClose }: TitleBarProps) {
  return (
    <header className="dl-titlebar">
      <div className="dl-wordmark">{wordmark}</div>
      {breadcrumb ? <div className="dl-crumb">{breadcrumb}</div> : <span />}
      <div className="dl-wc">
        <button type="button" className="dl-wc-btn" aria-label="Свернуть" onClick={onMinimize}>
          <IconMinimize size={15} />
        </button>
        <button type="button" className="dl-wc-btn" aria-label="Развернуть" onClick={onMaximize}>
          <IconMaximize size={15} />
        </button>
        <button type="button" className="dl-wc-btn" aria-label="Закрыть" onClick={onClose}>
          <IconClose size={14} />
        </button>
      </div>
    </header>
  );
}
