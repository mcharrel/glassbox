/** Reuse the visible delete control so keyboard deletion has the same ownership and sync rules. */
export function deleteHoveredComment(event: KeyboardEvent, hovered: Element | null): boolean {
  if (event.key !== 'd' || event.defaultPrevented || event.repeat || event.isComposing
    || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
    || (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable], dialog'))
    || document.querySelector('dialog[open], [role="dialog"]')) return false;
  const comment = hovered?.closest('.pr-message, .annotation-item');
  if (comment?.isConnected !== true) return false;
  const button = comment.querySelector<HTMLButtonElement>('.pr-message-actions > [data-comment-action="delete"], .annotation-actions > [data-action="delete"]');
  if (!button || button.disabled) return false;
  event.preventDefault();
  button.click();
  return true;
}
export function initCommentDelete(): void {
  let pointer: { x: number; y: number } | null = null;
  document.addEventListener('pointermove', event => { pointer = { x: event.clientX, y: event.clientY }; });
  document.addEventListener('pointerleave', () => { pointer = null; });
  window.addEventListener('blur', () => { pointer = null; });
  document.addEventListener('keydown', event => {
    if (pointer && event.key === 'd') deleteHoveredComment(event, document.elementFromPoint(pointer.x, pointer.y));
  });
}
