/** Only a click on rendered text may open the description editor. */
export function clickedDescriptionText(event: MouseEvent, body: HTMLElement): boolean {
  const target = event.target;
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
    || !(target instanceof Element) || !body.contains(target)
    || target.closest('a, summary, input, button, select, textarea, label, [contenteditable]')
    || document.getSelection()?.isCollapsed === false) return false;
  const caretDocument: Partial<Pick<Document, 'caretPositionFromPoint' | 'caretRangeFromPoint'>> = document;
  const position = caretDocument.caretPositionFromPoint?.(event.clientX, event.clientY);
  // WebKit exposes the older range API; both APIs can snap to nearby whitespace.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- required by the desktop WebKit runtime
  const node = position?.offsetNode ?? caretDocument.caretRangeFromPoint?.(event.clientX, event.clientY)?.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE || !body.contains(node) || (node.textContent?.trim() ?? '') === '') return false;
  const range = document.createRange();
  range.selectNodeContents(node);
  return [...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0
    && event.clientX >= rect.left && event.clientX < rect.right
    && event.clientY >= rect.top && event.clientY < rect.bottom);
}
