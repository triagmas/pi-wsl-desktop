/**
 * UI Owner Review R02 (Issue #21, #6566550672) — контракт раскладки.
 *
 * Владелец просил: одна сетка левого сайдбара (иконки 14–16, общая колонка,
 * одинаковый зазор до имени, отдельная правая колонка «+»), плотная вертикаль
 * только в сайдбаре, центрированный чат в пределах одобренной меры текста и
 * приглушённый предпросмотр шрифта в Settings.
 *
 * Тест читает реальные CSS-файлы, чтобы правка «на глаз» в компоненте не
 * разошлась с контрактом токенов.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const designDir = path.join(__dirname, '..', '..', 'src', 'renderer', 'design');
const tokens = readFileSync(path.join(designDir, 'tokens-contract.css'), 'utf8');
const components = readFileSync(path.join(designDir, 'components.css'), 'utf8');

/** Тело правила по точному селектору (первое вхождение). */
function rule(css: string, selector: string): string {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`нет правила ${selector}`);
  const end = css.indexOf('}', at);
  return css.slice(at + selector.length, end);
}

describe('R02 · левый сайдбар — один каркас', () => {
  it('колонка иконок 16 px и общий зазор 8 px заданы токенами', () => {
    expect(tokens).toMatch(/--shell-icon-col:\s*16px/);
    expect(tokens).toMatch(/--shell-icon-gap:\s*var\(--sp-2\)/);
    expect(tokens).toMatch(/--shell-side-pad:\s*var\(--sp-3\)/);
    expect(tokens).toMatch(/--shell-action-col:\s*var\(--shell-plus-size\)/);
  });

  it('иконка строки — квадрат токена, svg не выходит за колонку', () => {
    const icon = rule(tokens, ".dl-frame[data-layout='app'] .dl-row-icon");
    expect(icon).toMatch(/width:\s*var\(--shell-icon-col\)/);
    expect(icon).toMatch(/height:\s*var\(--shell-icon-col\)/);
    expect(rule(tokens, ".dl-frame[data-layout='app'] .dl-row-icon svg")).toMatch(
      /width:\s*var\(--shell-icon-col\)/,
    );
  });

  it('строки проекта, сессии и навигации имеют один зазор до имени', () => {
    const rows = rule(tokens, ".dl-frame[data-layout='app'] .dl-row,\n.dl-frame[data-layout='app'] .dl-row-nav,\n.dl-frame[data-layout='app'] .dl-row-session");
    expect(rows).toMatch(/gap:\s*var\(--shell-icon-gap\)/);
    expect(rows).toMatch(/padding:\s*0/);
    expect(rows).toMatch(/height:\s*var\(--shell-row-h\)/);
  });

  it('правая колонка действий зарезервирована под «+» 28×28', () => {
    const project = rule(tokens, ".dl-frame[data-layout='app'] .dl-row-project");
    expect(project).toMatch(/padding-right:\s*calc\(var\(--shell-action-col\) \+ var\(--sp-2\)\)/);
    expect(rule(tokens, ".dl-frame[data-layout='app'] .dl-project-new")).toMatch(
      /width:\s*var\(--shell-action-col\)/,
    );
    // «+» стоит в своей колонке, а не поверх имени
    const plus = rule(tokens, ".dl-frame[data-layout='app'] .dl-row-slot .dl-project-new");
    expect(plus).toMatch(/position:\s*absolute/);
    expect(plus).toMatch(/right:\s*0/);
  });

  it('старые app-переопределения высот/отступов строк удалены из components.css', () => {
    expect(components).not.toMatch(/\.dl-frame\[data-layout="app"\] \.dl-row \{/);
    expect(components).not.toMatch(/\.dl-frame\[data-layout="app"\] \.dl-search \{/);
    expect(components).not.toMatch(/\.dl-frame\[data-layout="app"\] \.dl-side-label \{/);
  });
});

describe('R02 · чат и предпросмотр шрифта', () => {
  it('сообщения и композер ограничены одной мерой и центрированы', () => {
    expect(tokens).toMatch(/--shell-chat-col:\s*788px/);
    expect(rule(tokens, ".dl-frame[data-layout='app'] .dl-msgs > *")).toMatch(
      /max-width:\s*var\(--shell-chat-col\)/,
    );
    const wrap = rule(tokens, ".dl-frame[data-layout='app'] .dl-composer-wrap");
    expect(wrap).toMatch(/max-width:\s*var\(--shell-chat-col\)/);
    expect(wrap).toMatch(/margin-inline:\s*auto/);
    expect(rule(tokens, ".dl-frame[data-layout='app'] .dl-msgs")).toMatch(
      /align-items:\s*center/,
    );
  });

  it('длинный код не растягивает ленту по горизонтали', () => {
    const block = rule(
      tokens,
      ".dl-frame[data-layout='app'] .dl-md pre,\n.dl-frame[data-layout='app'] .dl-md table,\n.dl-frame[data-layout='app'] .dl-md .dl-tool-output",
    );
    expect(block).toMatch(/max-width:\s*100%/);
    expect(block).toMatch(/overflow-x:\s*auto/);
    // и неразрывный inline-токен не расширяет абзац
    expect(rule(tokens, ".dl-frame[data-layout='app'] .dl-md")).toMatch(
      /overflow-wrap:\s*break-word/,
    );
  });

  it('предпросмотр приглушён токеном темы; кегль задаёт компонент, не CSS', () => {
    expect(rule(tokens, ".dl-frame[data-layout='app'] .dl2-preview")).toMatch(
      /color:\s*var\(--pw-muted-text-color\)/,
    );
    // R03-2: размер предпросмотра задаётся компонентом (одна ступень ниже
    // рабочего), поэтому в CSS-контракте размера предпросмотра быть не должно —
    // иначе два источника истины разойдутся.
    expect(tokens).not.toMatch(/\.dl2-preview\s*\{[^}]*font-size/);
  });
});
