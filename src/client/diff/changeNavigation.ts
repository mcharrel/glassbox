import { allFileOrder, reviewStore } from '../stores/index.js';
import { JUMP_HIGHLIGHT_DURATION_MS } from '../timing.js';
import { selectFile } from './selection.js';

interface ChangeRow { element: HTMLElement; top: number; bottom: number }
interface ChangeBlock { id: number; rows: ChangeRow[]; top: number; bottom: number }

function blocksIn(view: Element): ChangeBlock[] {
  const blocks = new Map<number, ChangeBlock>();
  for (const element of view.querySelectorAll<HTMLElement>('[data-change-block]')) {
    const id = Number(element.dataset.changeBlock);
    const { top, bottom } = element.getBoundingClientRect();
    const block = blocks.get(id) ?? { id, rows: [], top, bottom };
    block.rows.push({ element, top, bottom });
    block.top = Math.min(block.top, top);
    block.bottom = Math.max(block.bottom, bottom);
    blocks.set(id, block);
  }
  return [...blocks.values()].sort((a, b) => a.id - b.id);
}

/** Tab reveals unread changes, paging through long blocks before continuing to other files. */
export function bindChangeNavigation(): (fileId: string | null) => void {
  const element = document.getElementById('diff-container');
  if (!element) return () => {};
  const container = element;
  let pending: { fileId: string; backward: boolean } | null = null;
  let highlighted: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function viewport(): { top: number; bottom: number } {
    const top = container.getBoundingClientRect().top + container.clientTop;
    const bottom = top + container.clientHeight;
    // Sticky chrome obscures code even though it lies inside the scrolling pane.
    const chrome = [...container.querySelectorAll<HTMLElement>('.diff-header, .outline-bar')];
    return { top: Math.max(top, ...chrome.map(el => el.getBoundingClientRect().bottom)), bottom };
  }

  function jump(block: ChangeBlock, backward: boolean, fromEdge = false): void {
    const { top, bottom } = viewport();
    const height = bottom - top;
    if (height <= 0) return;
    const style = getComputedStyle(block.rows[0].element);
    const lineHeight = (parseFloat(style.lineHeight) || 20)
      + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
    const fits = block.bottom - block.top <= height;
    const padding = Math.min(5 * lineHeight, Math.max(0, height - (fits ? block.bottom - block.top : lineHeight)));
    let delta = backward ? block.bottom + padding - bottom : block.top - padding - top;
    if (!fromEdge && !fits && (backward ? block.bottom >= bottom - padding : block.top <= top + padding)) {
      // Preserve ten lines while advancing; tiny windows still reveal at least one new line.
      const step = Math.max(Math.min(lineHeight, height), height - 10 * lineHeight);
      delta = backward ? -step : step;
    }
    const before = container.scrollTop;
    container.scrollTop += delta;
    const moved = container.scrollTop - before;
    const rows = [...block.rows].sort((a, b) => a.top - b.top);
    if (backward) rows.reverse();
    const target = rows.find(row => row.bottom - moved > top && row.top - moved < bottom)?.element;
    if (!target) return;
    target.tabIndex = -1;
    target.focus({ preventScroll: true });
    highlighted?.classList.remove('jump-highlight');
    clearTimeout(timer);
    highlighted = target;
    target.classList.add('jump-highlight');
    timer = setTimeout(() => { target.classList.remove('jump-highlight'); }, JUMP_HIGHLIGHT_DURATION_MS);
  }

  document.addEventListener('keydown', event => {
    if (!['Tab', 'f', 'g'].includes(event.key) || document.body.dataset.workspaceView === 'main' || document.body.dataset.workspaceView === 'add' || event.defaultPrevented || event.isComposing
      || event.ctrlKey || event.metaKey || event.altKey) return;
    if (document.activeElement?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
    if ([...document.querySelectorAll<HTMLElement>('.modal, [role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0)) return;
    const backward = event.key === 'g' || (event.key === 'Tab' && event.shiftKey);
    const currentFileId = reviewStore.state.value.currentFileId;
    if (pending?.fileId === currentFileId) { event.preventDefault(); return; }
    pending = null;
    const view = container.querySelector<HTMLElement>('.diff-view');
    if (currentFileId === null || !view || view.dataset.fileId !== currentFileId) return;

    event.preventDefault();
    const { top, bottom } = viewport();
    if (bottom <= top) return;
    const blocks = blocksIn(view);
    if (backward) blocks.reverse();
    const next = blocks.find(block => backward ? block.top < top - 1 : block.bottom > bottom + 1);
    if (next) { jump(next, backward); return; }

    const order = allFileOrder.value;
    const current = order.indexOf(currentFileId);
    const nextFileId = current < 0 ? undefined : order[current + (backward ? -1 : 1)];
    const hiddenFileIds = new Set(reviewStore.state.value.hiddenFileIds);
    if (!backward) hiddenFileIds.add(currentFileId);
    if (nextFileId !== undefined) hiddenFileIds.delete(nextFileId);
    reviewStore.actions.update({ hiddenFileIds });
    try { localStorage.setItem(`glassbox.hidden.${reviewStore.state.value.reviewId}`, JSON.stringify([...hiddenFileIds])); } catch { /* optional persistence */ }
    if (nextFileId !== undefined) {
      pending = { fileId: nextFileId, backward };
      void selectFile(nextFileId);
    }
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
    if (blocks.length > 0) jump(blocks[backward ? blocks.length - 1 : 0], backward, true);
    else {
      container.scrollTop = 0;
      container.tabIndex = -1;
      container.focus({ preventScroll: true });
    }
  };
}
