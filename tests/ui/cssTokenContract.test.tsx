/**
 * UI-A review fix (P1): design-token delivery contract.
 * Every `var(--pw-…)` the stylesheet consumes must be either
 *  (a) declared locally in index.css (geometry/base constants), or
 *  (b) produced by the design system: applyTheme (theme tokens) or
 *      applyTypography (4 properties × 8 areas) — and each of those
 *      produced variables must actually be consumed by the stylesheet,
 *      so no theme/typography knob can be silently dead again.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cssVarName } from '../../src/renderer/design/applyTheme';
import { typographyCssVarNames } from '../../src/renderer/design/applyTypography';
import { THEME_PRESETS } from '../../src/shared/design/presets';
import { TYPOGRAPHY_AREAS } from '../../src/shared/appearance';

const cssPath = path.join(__dirname, '..', '..', 'src', 'renderer', 'index.css');
const designPaths = ['components.css', 'layout.css'].map((f) =>
  path.join(__dirname, '..', '..', 'src', 'renderer', 'design', f),
);
// D3: одобренные компоненты живут в design-слое — контракт читает и его,
// иначе потребление токена вне legacy index.css считается «мёртвым».
const css =
  readFileSync(cssPath, 'utf8') + designPaths.map((p) => readFileSync(p, 'utf8')).join('\n');

const used = new Set([...css.matchAll(/var\((--pw-[a-z0-9-]+)/g)].map((m) => m[1]));
const declaredLocally = new Set(
  [...css.matchAll(/^\s*(--pw-[a-z0-9-]+)\s*:/gm)].map((m) => m[1]),
);

const produced = new Set<string>();
for (const key of Object.keys(THEME_PRESETS.dark.tokens)) produced.add(cssVarName(key));
const typographyVars = new Map<string, string>();
for (const area of TYPOGRAPHY_AREAS) {
  for (const [prop, name] of Object.entries(typographyCssVarNames(area))) {
    produced.add(name);
    typographyVars.set(`${area}:${prop}`, name);
  }
}

/**
 * Round-2 review: the CSS text can consume a zone variable in a DEAD selector.
 * These links pin each zone to the elements that actually render content.
 */
const REQUIRED_ZONE_LINKS: Array<{ selector: string; zone: string; vars: string[] }> = [
  { selector: '.project-row', zone: 'sidebar', vars: Object.values(typographyCssVarNames('sidebar')) },
  { selector: '.session-row', zone: 'sidebar', vars: Object.values(typographyCssVarNames('sidebar')) },
  { selector: '.bubble-tool', zone: 'toolOutput', vars: Object.values(typographyCssVarNames('toolOutput')) },
];

function cssBlocks(): Array<{ selectors: string; body: string }> {
  const blocks: Array<{ selectors: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const selectors = m[1].trim();
    if (selectors.startsWith('@') || selectors.includes('@')) continue;
    blocks.push({ selectors, body: m[2] });
  }
  return blocks;
}

describe('zone → real content element links (round-2 review)', () => {
  for (const link of REQUIRED_ZONE_LINKS) {
    it(`${link.zone} zone drives ${link.selector}`, () => {
      const bodies = cssBlocks()
        .filter((b) => b.selectors.split(',').some((sel) => sel.trim() === link.selector))
        .map((b) => b.body)
        .join('\n');
      const missing = link.vars.filter((v) => !bodies.includes(`var(${v}`));
      expect(
        missing,
        `${link.selector} does not consume ${link.zone} variables:\n${missing.join('\n')}`,
      ).toEqual([]);
    });
  }
});

describe('C4: toolbar fields keep a visible keyboard focus indicator', () => {
  const componentsCss = readFileSync(designPaths[0], 'utf8');

  it('the search/filter fields do not silence :focus-visible with outline:none', () => {
    const rules =
      componentsCss.match(
        /\.(dl-input-box input\.dl-input-field|dl-select select\.dl-select-field)\s*\{[^}]*\}/g,
      ) ?? [];
    expect(rules).toHaveLength(2);
    for (const rule of rules) expect(rule).not.toMatch(/outline\s*:\s*none/);
  });

  it('both wrappers glow with the focus ring on :focus-within', () => {
    const block = componentsCss.match(/\.dl-input-box:focus-within[^{]*\{[^}]*\}/);
    expect(block).not.toBeNull();
    expect(block![0]).toContain('var(--pw-focus-ring-color)');
    expect(componentsCss).toContain('.dl-select:focus-within');
  });
});

describe('design token delivery contract (index.css ↔ design system)', () => {
  it('every var(--pw-…) consumed by the stylesheet is declared locally or produced by applyTheme/applyTypography', () => {
    const dead = [...used].filter(
      (v) => !declaredLocally.has(v) && !produced.has(v),
    );
    expect(
      dead,
      `dead stylesheet variables (never written by the design system):\n${dead.join('\n')}`,
    ).toEqual([]);
  });

  it('interface theme colors produced by applyTheme are consumed (terminal/syntax groups may wait for UI-B)', () => {
    const DEFERRED = /^(syntax|terminal)/; // code/terminal styling lands with UI-B highlighting/PTY
    const unusedTheme = [...produced]
      .filter((v) => !v.startsWith('--pw-font-'))
      .filter((v) => !used.has(v))
      .filter((v) => !DEFERRED.test(v.replace('--pw-', '')));
    expect(
      unusedTheme,
      `theme variables produced but never used in index.css:\n${unusedTheme.join('\n')}`,
    ).toEqual([]);
  });

  it('each of the 8 typography areas consumes all four properties (family/size/line-height/weight)', () => {
    const missing: string[] = [];
    for (const [key, name] of typographyVars) {
      if (!used.has(name)) missing.push(`${key} → ${name}`);
    }
    expect(
      missing,
      `typography properties written by applyTypography but not consumed by index.css:\n${missing.join('\n')}`,
    ).toEqual([]);
  });
});

describe('C1: legacy panel heading parity (modules panel h2 = approved 15px scale)', () => {
  it('index.css limits .panel-header h2 like .panel-header h3 (Design Lab modules panel)', () => {
    const rule = css.match(/\.panel-header\s+h2\s*\{[^}]*\}/);
    expect(rule, '.panel-header h2 rule missing in index.css').not.toBeNull();
    expect(rule?.[0]).toMatch(/font-size:\s*15px/);
    expect(rule?.[0]).toMatch(/margin:\s*0/);
  });
});

describe('C5.1: app-layout TitleBar keeps window controls in the rightmost track', () => {
  // Frameless window: without an explicit app-layout column template the
  // .dl-wc stack falls into a lower grid row and is covered by the sidebar
  // head — window controls become invisible/unclickable (DOM-verified C5).
  it('components.css pins .dl-titlebar columns for data-layout="app" (wordmark | empty | wc auto)', () => {
    const rule = cssBlocks().find(
      (b) => b.selectors.includes('.dl-frame[data-layout="app"] .dl-titlebar'),
    );
    expect(rule, 'app-layout .dl-titlebar grid-template-columns rule missing').toBeTruthy();
    expect(rule?.body).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*0px\s*auto/);
  });
});

describe('C5.2: typography group keeps the approved row without UA fieldset chrome', () => {
  // Ревью P2: fieldset по умолчанию рисует groove-бордер и margins, легенда
  // садится сверху — ряд теряет одобренную анатомию. Сброс обязателен.
  it('components.css resets border/margin/padding on the .dl-type-group fieldset', () => {
    const rule = cssBlocks().find((b) => {
      const sels = b.selectors
        .replace(/\/\*[\s\S]*?\*\//g, '') // cssBlocks сохраняет комментарии перед правилом
        .split(',')
        .map((s) => s.trim());
      return sels.includes('.dl-type-group');
    });
    expect(rule, '.dl-type-group reset rule missing').toBeTruthy();
    expect(rule?.body).toMatch(/border:\s*(0|none)/);
    expect(rule?.body).toMatch(/margin:\s*0/);
    expect(rule?.body).toMatch(/padding:\s*0/);
  });
});

describe('UI21-C5 R02: spaced chat status + shared responsive type rows (owner #6415236125)', () => {
  const findRule = (exact: string) =>
    cssBlocks().find((b) => {
      const sels = b.selectors
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(',')
        .map((s) => s.trim());
      return sels.includes(exact);
    });

  it('chat-status-row lays out as a spaced flex row (no «Чат открытЗакрыть чат» jam)', () => {
    const rule = findRule('.chat-status-row');
    expect(rule, '.chat-status-row rule missing').toBeTruthy();
    expect(rule?.body).toMatch(/display:\s*flex/);
    expect(rule?.body).toMatch(/gap:\s*\d/);
    expect(rule?.body).toMatch(/flex-wrap:\s*wrap/);
  });

  it('base .dl-type-row wraps and base .dl-type-preview keeps a readable column (lab@1000 == product)', () => {
    const row = findRule('.dl-type-row');
    expect(row, '.dl-type-row base rule missing').toBeTruthy();
    expect(row?.body, 'row must wrap on narrow columns').toMatch(/flex-wrap:\s*wrap/);
    const preview = findRule('.dl-type-preview');
    expect(preview, '.dl-type-preview base rule missing').toBeTruthy();
    expect(preview?.body).toMatch(/flex:\s*1 1 240px/);
    expect(preview?.body).toMatch(/min-width:\s*200px/);
  });
});
