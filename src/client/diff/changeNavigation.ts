import { JUMP_HIGHLIGHT_DURATION_MS } from '../timing.js';

/** Tab moves between contiguous changed blocks in the current file. */
export function bindChangeNavigation(): void {
  const container = document.getElementById('diff-container');
  if (!container) return;
  let last: { view: Element; index: number; scrollTop: number } | null = null;
  let highlighted: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || event.defaultPrevented || event.isComposing
      || event.ctrlKey || event.metaKey || event.altKey) return;
    if (document.activeElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if ([...document.querySelectorAll<HTMLElement>('.modal, [role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0)) return;
    const view = container.querySelector('.diff-view');
    if (!view || !view.querySelector('.diff-table-unified, .diff-table-split')) return;

    event.preventDefault();
    const blocks = [...view.querySelectorAll<HTMLElement>('[data-change-start]')]
      .sort((a, b) => Number(a.dataset.changeStart) - Number(b.dataset.changeStart));
    if (blocks.length === 0) return;

    const top = container.getBoundingClientRect().top + 24;
    let index: number;
    // Remember the jump when scrolling is clamped at the bottom of a short file.
    if (last?.view === view && Math.abs(last.scrollTop - container.scrollTop) < 1) {
      index = last.index + (event.shiftKey ? -1 : 1);
    } else if (event.shiftKey) {
      index = -1;
      for (let i = blocks.length - 1; i >= 0; i--) {
        if (blocks[i].getBoundingClientRect().top < top - 1) { index = i; break; }
      }
    } else {
      index = blocks.findIndex(block => block.getBoundingClientRect().top > top + 1);
      if (index < 0) index = blocks.length - 1;
    }
    index = Math.max(0, Math.min(blocks.length - 1, index));
    const target = blocks[index];
    container.scrollTop += target.getBoundingClientRect().top - top;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    last = { view, index, scrollTop: container.scrollTop };
    highlighted?.classList.remove('jump-highlight');
    clearTimeout(timer);
    highlighted = target;
    target.classList.add('jump-highlight');
    timer = setTimeout(() => { target.classList.remove('jump-highlight'); }, JUMP_HIGHLIGHT_DURATION_MS);
  });
}
