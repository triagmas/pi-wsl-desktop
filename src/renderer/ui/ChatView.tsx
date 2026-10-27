/**
 * Design Lab — экран чата (Issue #21, D1; состояния ref1, ref2, ref4, ref5).
 * Только представление: переписка (user-пузырь + ответ Pi со steps/tool-cards),
 * композер, hint, опциональный терминал. Markdown-тело — ReactNode из фикстур
 * ( SafeMarkdown из src/renderer/SafeMarkdown.tsx — инертный рендерер, без API ).
 */
import type { CSSProperties, ReactNode } from 'react';
import { IconArrowUp, IconCheckCircle, IconChevronDown, IconChevronRight, IconInfo, IconPaperclip } from './icons';

export interface ChatStep {
  id: string;
  text: string;
  /** подсветка активного шага (ref1/ref5: «Добавлен поиск по истории»). */
  active?: boolean;
  /** ссылка «Подробнее» справа (только у active). */
  more?: string;
}

export interface ChatAction {
  id: string;
  label: string;
  icon: ReactNode;
}

export interface ChatTurnUser {
  kind: 'user';
  id: string;
  text: string;
}

export interface ChatTurnAssistant {
  kind: 'assistant';
  id: string;
  /** Тело ответа: абзацы/список/код — ReactNode (SafeMarkdown или JSX). */
  body: ReactNode;
  /** app (D1-этап 2): свёрнутая строка-сводка над ответом (эталон 01-chat-review-terminal). */
  pre?: ReactNode;
  /** app: блок после bullets и до actions (например «Изменены 2 файла»). */
  post?: ReactNode;
  name?: string;
  steps?: ChatStep[];
  heading?: string;
  bullets?: string[];
  actions?: ChatAction[];
  /** D2: data-testid контейнера steps (продуктовый контракт «инструменты живые»). */
  stepsTestId?: string;
}

export type ChatTurn = ChatTurnUser | ChatTurnAssistant;

export type ComposerDensity = 'relaxed' | 'standard' | 'compact';

export interface ComposerProps {
  placeholder?: string;
  model?: string;
  context?: string;
  density?: ComposerDensity;
  /** D2: управляемый ввод (продуктовый чат). Без value остаётся статичный дизайн-вид. */
  value?: string;
  onValueChange?: (value: string) => void;
  /** D2: отправка (клик по кнопке/Enter в textarea). */
  onSubmit?: () => void;
  /** D2: кнопка отправки disabled (нет открытой сессии/пусто/идёт генерация). */
  submitDisabled?: boolean;
  /** D2: поле ввода disabled (явный write-gate: до/после открытой сессии). */
  inputDisabled?: boolean;
  /** UI21-F2: модель/провайдер приходят из Pi get_state — не из констант. */
  onModelClick?: () => void;
  modelDisabled?: boolean;
  /** UI21-F2: текущий thinking level из Pi + его поддерживаемые уровни. */
  thinking?: string;
  onThinkingClick?: () => void;
  thinkingDisabled?: boolean;
  /** UI21-F2: выпадающий список (модели/уровни) — рендерится над композером. */
  menu?: ReactNode;
}

export interface ChatViewProps {
  /** Правый верхний элемент над перепиской (ref2/ref4: кнопка «…»). */
  header?: ReactNode;
  /** D2: блок-уведомление в начале ленты (banner/error/спиннер/статус чата). */
  notice?: ReactNode;
  turns: ChatTurn[];
  /** D2/M1 write-boundary: null → композер не рендерится вообще (textarea
   * появляется только после явного «Открыть чат»); объект → своя зона. */
  composer?: ComposerProps | null;
  /** Подсказка под композером (ref2/ref4). */
  hint?: string;
  /** false → ответы без аватара и имени (эталон 05: контент от x442). */
  showIdentity?: boolean;
  terminal?: ReactNode;
  /** Диаметр кружка шага, измеренный по состоянию: ref1/ref5 ≈ 32, ref2/4 ≈ 24. */
  stepCircle?: number;
}

function AssistantTurn({
  turn,
  stepCircle,
  showIdentity = true,
}: {
  turn: ChatTurnAssistant;
  stepCircle: number;
  showIdentity?: boolean;
}) {
  return (
    <>
      {turn.pre ? <div className="dl-turn-pre">{turn.pre}</div> : null}
      <div className="dl-turn-assistant">
        {showIdentity ? (
        <div className="dl-avatar" aria-hidden="true">
          π
        </div>
      ) : null}
      <div className="dl-assistant-body">
        {showIdentity ? <div className="dl-name">{turn.name ?? 'Pi'}</div> : null}
        <div className="dl-md">{turn.body}</div>
        {turn.steps?.length ? (
          <div
            className="dl-steps"
            data-testid={turn.stepsTestId}
            style={{ '--dl-step-circle': `${stepCircle}px` } as CSSProperties}
          >
            {turn.steps.map((step) => (
              <div key={step.id} className={`dl-step${step.active ? ' dl-step-active' : ''}`}>
                <span className="dl-step-check" aria-hidden="true">
                  <IconCheckCircle size={stepCircle} />
                </span>
                <span className="dl-step-text">{step.text}</span>
                <span className="dl-step-chevron" aria-hidden="true">
                  <IconChevronDown size={17} />
                </span>
                {step.more ? (
                  <span className="dl-step-more">
                    <span>{step.more}</span>
                    <IconChevronRight size={16} />
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}
        {turn.heading ? <div className="dl-heading">{turn.heading}</div> : null}
        {turn.bullets?.length ? (
          <ul className="dl-bullets">
            {turn.bullets.map((bullet) => (
              <li key={bullet}>{bullet}</li>
            ))}
          </ul>
        ) : null}
        {turn.post ? <div className="dl-turn-post">{turn.post}</div> : null}
        {turn.actions?.length ? (
          <div className="dl-actions">
            {turn.actions.map((action) => (
              <button key={action.id} type="button" className="dl-action">
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      </div>
    </>
  );
}

function Composer({
  placeholder = 'Напишите сообщение…',
  model,
  context,
  density = 'relaxed',
  value,
  onValueChange,
  onSubmit,
  submitDisabled = false,
  inputDisabled = false,
  onModelClick,
  modelDisabled = false,
  thinking,
  onThinkingClick,
  thinkingDisabled = false,
  menu,
}: ComposerProps) {
  const controlled = value !== undefined && onValueChange !== undefined;
  return (
    <div className="dl-composer" data-density={density}>
      {menu}
      <div className="dl-composer-row1">
        <span className="dl-composer-attach" aria-hidden="true">
          <IconPaperclip size={24} />
        </span>
        {controlled ? (
          <textarea
            className="dl-composer-input"
            rows={1}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            placeholder={placeholder}
            aria-label={placeholder}
            disabled={inputDisabled}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && onSubmit && !submitDisabled && !inputDisabled) {
                e.preventDefault();
                onSubmit();
              }
            }}
          />
        ) : (
          <div className="dl-composer-placeholder">{placeholder}</div>
        )}
      </div>
      <div className="dl-composer-row2">
        {/* Review P1-1: без подтверждённого источника модели чип не рендерится —
         * выдуманный runtime-идентификатор в рабочем приложении запрещён. */}
        {model ? (
          <button
            type="button"
            className="dl-chip"
            data-testid="model-selector"
            onClick={onModelClick}
            disabled={modelDisabled || !onModelClick}
            title={model}
          >
            {model}
            <span className="dl-chip-chevron" aria-hidden="true">
              <IconChevronDown size={16} />
            </span>
          </button>
        ) : null}
        {thinking ? (
          <button
            type="button"
            className="dl-chip dl-chip-thinking"
            data-testid="thinking-selector"
            onClick={onThinkingClick}
            disabled={thinkingDisabled || !onThinkingClick}
            title={`Thinking: ${thinking}`}
          >
            {thinking}
            <span className="dl-chip-chevron" aria-hidden="true">
              <IconChevronDown size={16} />
            </span>
          </button>
        ) : null}
        {context ? (
          <span className="dl-context">
            {context}
            <IconInfo size={16} />
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="dl-btn-primary dl-send"
        aria-label="Отправить"
        disabled={submitDisabled}
        onClick={onSubmit}
      >
        <IconArrowUp size={20} />
      </button>
    </div>
  );
}

export function ChatView({
  header,
  notice,
  turns,
  composer,
  hint,
  showIdentity = true,
  terminal,
  stepCircle = 26,
}: ChatViewProps) {
  return (
    <>
      {header ? <div className="dl-chat-head">{header}</div> : null}
      <div className="dl-msgs">
        {notice ? <div className="dl-notice">{notice}</div> : null}
        {turns.map((turn) =>
          turn.kind === 'user' ? (
            <div key={turn.id} className="dl-turn-user">
              <div className="dl-bubble-user">{turn.text}</div>
            </div>
          ) : (
            <AssistantTurn key={turn.id} turn={turn} stepCircle={stepCircle} showIdentity={showIdentity} />
          ),
        )}
      </div>
      <div className="dl-composer-wrap">
        {composer ? <Composer {...composer} /> : null}
        {hint ? <div className="dl-hint">{hint}</div> : null}
      </div>
      {terminal}
    </>
  );
}
