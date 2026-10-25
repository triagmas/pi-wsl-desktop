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
}

export type ChatTurn = ChatTurnUser | ChatTurnAssistant;

export type ComposerDensity = 'relaxed' | 'standard' | 'compact';

export interface ComposerProps {
  placeholder?: string;
  model?: string;
  context?: string;
  density?: ComposerDensity;
}

export interface ChatViewProps {
  /** Правый верхний элемент над перепиской (ref2/ref4: кнопка «…»). */
  header?: ReactNode;
  turns: ChatTurn[];
  composer: ComposerProps;
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
          <div className="dl-steps" style={{ '--dl-step-circle': `${stepCircle}px` } as CSSProperties}>
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

function Composer({ placeholder = 'Напишите сообщение…', model = 'MiMo v2.6', context, density = 'relaxed' }: ComposerProps) {
  return (
    <div className="dl-composer" data-density={density}>
      <div className="dl-composer-row1">
        <span className="dl-composer-attach" aria-hidden="true">
          <IconPaperclip size={24} />
        </span>
        <div className="dl-composer-placeholder">{placeholder}</div>
      </div>
      <div className="dl-composer-row2">
        <button type="button" className="dl-chip">
          {model}
          <span className="dl-chip-chevron" aria-hidden="true">
            <IconChevronDown size={16} />
          </span>
        </button>
        {context ? (
          <span className="dl-context">
            {context}
            <IconInfo size={16} />
          </span>
        ) : null}
      </div>
      <button type="button" className="dl-btn-primary dl-send" aria-label="Отправить">
        <IconArrowUp size={20} />
      </button>
    </div>
  );
}

export function ChatView({
  header,
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
        <Composer {...composer} />
        {hint ? <div className="dl-hint">{hint}</div> : null}
      </div>
      {terminal}
    </>
  );
}
