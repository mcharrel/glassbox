import { toElement } from '../dom.js';
import type { DescriptionClick } from './description.js';
import { descriptionSourceOffset } from './descriptionSource.js';

export function descriptionEditOffset(source: string, body: HTMLElement, click: DescriptionClick): number {
  let rendered = '';
  let offset = 0;
  const visit = (node: Node) => {
    const block = node instanceof Element && /^(P|DIV|H[1-6]|LI|TH|TD|BLOCKQUOTE|PRE|BR|HR|DT|DD)$/.test(node.tagName);
    if (block) rendered += '\n';
    if (node === click.node) offset = rendered.length + click.offset;
    if (node.nodeType === Node.TEXT_NODE) rendered += node.textContent ?? '';
    else for (const child of node.childNodes) visit(child);
    if (block) rendered += '\n';
  };
  visit(body);
  // Textareas normalize CRLF; selection offsets must refer to their normalized value.
  return descriptionSourceOffset(source.replace(/\r\n?/g, '\n'), rendered, offset);
}

export function resizeDescriptionEditor(textarea: HTMLTextAreaElement): void {
  const parent = textarea.closest<HTMLElement>('.pr-description');
  const scroll = parent?.scrollTop ?? 0;
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
  if (parent) parent.scrollTop = scroll;
}

/** Measure wrapping using the same typography, without changing the textarea's text. */
function caretTop(textarea: HTMLTextAreaElement, offset: number): number {
  const style = getComputedStyle(textarea);
  const mirror = toElement(<div aria-hidden="true">{textarea.value.slice(0, offset)}<span>{textarea.value.slice(offset) || '\u200b'}</span></div>);
  Object.assign(mirror.style, {
    position: 'fixed', visibility: 'hidden', pointerEvents: 'none', top: '0', left: '0',
    width: `${textarea.clientWidth}px`, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
    fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
    fontStyle: style.fontStyle, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
    tabSize: style.tabSize, textIndent: style.textIndent, direction: style.direction,
  });
  document.body.append(mirror);
  try {
    const rect = mirror.querySelector('span')?.getClientRects()[0];
    return textarea.getBoundingClientRect().top + (rect?.top ?? 0) - mirror.getBoundingClientRect().top;
  } finally { mirror.remove(); }
}

export function focusDescriptionEditor(textarea: HTMLTextAreaElement, container: HTMLElement, offset: number, clickedTop: number, previousScroll: number): void {
  resizeDescriptionEditor(textarea);
  container.scrollTop = previousScroll;
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(offset, offset);
  container.scrollTop += caretTop(textarea, offset) - clickedTop;
  const scroll = container.scrollTop;
  // WebKit may reveal the selection after layout; retain our anchor unless the user has moved on.
  requestAnimationFrame(() => {
    if (textarea.isConnected && document.activeElement === textarea && textarea.selectionStart === offset && textarea.selectionEnd === offset)
      container.scrollTop = scroll;
  });
}
