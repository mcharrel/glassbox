import { reviewStore, visibleFileOrder } from '../stores/index.js';
import { JUMP_HIGHLIGHT_DURATION_MS } from '../timing.js';
import { selectFile } from './selection.js';

/** Tab moves between changed blocks, continuing through the sidebar's file order. */
export function bindChangeNavigation(): (fileId: string | null) => void {
  const element = document.getElementById('diff-container');
  if (!element) return () => {};
  const container = element;
  let last: { view: Element; index: number; scrollTop: number } | null = null;
  let pending: { fileId: string; backward: boolean } | null = null;
  let highlighted: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function blocksIn(view: Element): HTMLElement[] {
    return [...view.querySelectorAll<HTMLElement>('[data-change-start]')]
      .sort((a, b) => Number(a.dataset.changeStart) - Number(b.dataset.changeStart));
  }

  function jump(view: Element, blocks: HTMLElement[], index: number): void {
    const target = blocks[index];
    container.scrollTop += target.getBoundingClientRect().top - (container.getBoundingClientRect().top + 24);
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    last = { view, index, scrollTop: container.scrollTop };
    highlighted?.classList.remove('jump-highlight');
    clearTimeout(timer);
    highlighted = target;
    target.classList.add('jump-highlight');
    timer = setTimeout(() => { target.classList.remove('jump-highlight'); }, JUMP_HIGHLIGHT_DURATION_MS);
  }

  document.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || event.defaultPrevented || event.isComposing
      || event.ctrlKey || event.metaKey || event.altKey) return;
    if (document.activeElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if ([...document.querySelectorAll<HTMLElement>('.modal, [role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0)) return;
    const currentFileId = reviewStore.state.value.currentFileId;
    if (pending?.fileId === currentFileId) { event.preventDefault(); return; }
    pending = null;
    const view = container.querySelector<HTMLElement>('.diff-view');
    if (currentFileId === null || !view || view.dataset.fileId !== currentFileId) return;

    event.preventDefault();
    const blocks = blocksIn(view);

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
      if (index < 0) index = blocks.length;
    }
    if (index < 0 || index >= blocks.length) {
      const order = visibleFileOrder.value;
      const current = order.indexOf(currentFileId);
      const nextFileId = current < 0 ? undefined : order[current + (event.shiftKey ? -1 : 1)];
      if (nextFileId !== undefined) {
        pending = { fileId: nextFileId, backward: event.shiftKey };
        last = null;
        void selectFile(nextFileId);
        return;
      }
    }
    if (blocks.length === 0) return;
    index = Math.max(0, Math.min(blocks.length - 1, index));
    jump(view, blocks, index);
  });

  // File selection starts an asynchronous fetch; jump only after its DOM is ready.
  return fileId => {
    if (!pending) return;
    if (reviewStore.state.value.currentFileId !== pending.fileId) { pending = null; return; }
    if (fileId !== pending.fileId) return;
    const { backward } = pending;
    pending = null;
    const view = container.querySelector<HTMLElement>('.diff-view');
    if (!view || view.dataset.fileId !== fileId) return;
    const blocks = blocksIn(view);
    if (blocks.length > 0) jump(view, blocks, backward ? blocks.length - 1 : 0);
    else {
      container.scrollTop = 0;
      container.tabIndex = -1;
      container.focus({ preventScroll: true });
    }
  };
}
