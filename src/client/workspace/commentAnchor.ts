import type { ThreadMessage } from '../../api/workspace.js';

/** Match current source coordinates only; never guess from an outdated original line. */
export function commentAnchor(view: Element, message: ThreadMessage): HTMLElement | null {
  if (message.line === undefined || message.line === null || message.line <= 0) return null;
  const side = message.side ?? 'new';
  return view.querySelector<HTMLElement>(
    `.diff-line[data-${side}-line="${message.line}"], .diff-line[data-side="${side}"][data-line="${message.line}"]`,
  );
}
