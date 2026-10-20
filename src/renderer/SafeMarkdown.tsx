/**
 * Inert text renderer for history/chat content (Issue #5 gate 3: safe
 * Markdown — NO arbitrary HTML, no scripts, no handlers).
 *
 * Everything is rendered as React text children (React escapes them), fenced
 * code becomes <pre><code>, paragraphs split on blank lines. There is
 * deliberately NO HTML/markdown-tag parsing: hostile input like
 * `<img onerror=…>` or `[x](javascript:…)` stays literal visible text.
 */
import type { ReactNode } from 'react';

function fenceLabel(line: string): boolean {
  return /^[a-z0-9#+.-]{0,16}$/i.test(line.trim());
}

function inlineCode(paragraph: string, keyBase: string): ReactNode[] {
  const parts = paragraph.split('`');
  return parts.map((part, i) => (i % 2 === 1 ? <code key={`${keyBase}-c${i}`}>{part}</code> : <span key={`${keyBase}-t${i}`}>{part}</span>));
}

export function SafeMarkdown({ text }: { text: string }) {
  const blocks = text.split('```');
  const out: ReactNode[] = [];
  blocks.forEach((block, i) => {
    if (i % 2 === 1) {
      const lines = block.replace(/^\r?\n/, '').split('\n');
      const body = lines.length > 1 && fenceLabel(lines[0]) ? lines.slice(1).join('\n') : lines.join('\n');
      out.push(
        <pre key={`f${i}`}>
          <code>{body.replace(/\n$/, '')}</code>
        </pre>,
      );
      return;
    }
    block
      .split(/\n{2,}/)
      .forEach((para, j) => {
        if (para.trim() === '') return;
        out.push(
          <p className="md-para" key={`p${i}-${j}`}>
            {inlineCode(para, `p${i}-${j}`)}
          </p>,
        );
      });
  });
  return <>{out}</>;
}
