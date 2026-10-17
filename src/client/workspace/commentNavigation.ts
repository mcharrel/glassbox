import { selectFile } from '../diff/selection.js';
import { allFileOrder, reviewStore } from '../stores/index.js';
import { showToast } from '../toast.js';
import { activeTab } from './state.js';

interface Thread { element: HTMLElement; top: number; bottom: number }

function threadsIn(view: HTMLElement): Thread[] {
  return [...view.querySelectorAll<HTMLElement>(
    '[data-comment-thread], .annotation-item:not([data-comment-thread])',
  )].map(element => {
    const rect = element.getBoundingClientRect();
    // Local annotations render their replies beside the root, not inside it.
    const replies = element.nextElementSibling;
    const bottom = replies?.classList.contains('local-thread-details') === true
      ? Math.max(rect.bottom, replies.getBoundingClientRect().bottom) : rect.bottom;
    return { element, top: rect.top, bottom };
  }).filter(thread => thread.bottom > thread.top).sort((a, b) => a.top - b.top);
}

function viewport(pane: HTMLElement): { top: number; bottom: number } {
  const top = pane.getBoundingClientRect().top + pane.clientTop;
  const chrome = [...pane.querySelectorAll<HTMLElement>('.diff-header, .outline-bar')];
  return {
    top: Math.max(top, ...chrome.map(el => el.getBoundingClientRect().bottom)),
    bottom: top + pane.clientHeight,
  };
}

function jump(pane: HTMLElement, view: HTMLElement, thread: Thread, backward: boolean, fromEdge = false): void {
  const { top, bottom } = viewport(pane);
  const height = bottom - top;
  if (height <= 0) return;
  const rows = [...view.querySelectorAll<HTMLElement>('.diff-line')]
    .map(element => { const rect = element.getBoundingClientRect(); return { element, top: rect.top, bottom: rect.bottom }; })
    .filter(row => row.bottom <= thread.top + 1 && row.bottom > row.top)
    .sort((a, b) => a.top - b.top);
  const style = getComputedStyle(rows.at(-1)?.element ?? thread.element);
  const lineHeight = (parseFloat(style.lineHeight) || 20)
    + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
  // Count visual source rows once in split mode; wrapped lines keep their actual height.
  const sourceTops = [...new Set(rows.map(row => row.top))];
  const contextTop = sourceTops.at(-10) ?? sourceTops.at(0) ?? thread.top;
  const padding = Math.min(thread.top - contextTop, Math.max(0, height - lineHeight));
  let delta = thread.top - padding - top;
  if (!fromEdge && ((!backward && delta <= 1)
    || (backward && thread.bottom >= bottom && thread.top < top - height))) {
    // Long threads advance a page with ten lines of overlap instead of getting stuck.
    const step = Math.max(Math.min(lineHeight, height), height - 10 * lineHeight);
    delta = backward ? -step : step;
  }
  pane.scrollTop += delta;
  pane.tabIndex = -1;
  pane.focus({ preventScroll: true });
}

/** Navigate by current visibility, including replies and ten preceding source rows. */
export function createCommentNavigator(): (direction: number) => Promise<void> {
  let pending: { fileId: string; reviewId: string } | null = null;
  return async direction => {
    const pane = document.getElementById('diff-container');
    const { currentFileId, reviewId, files } = reviewStore.state.value;
    if (!pane || currentFileId === null) return;
    if (pending?.fileId === currentFileId && pending.reviewId === reviewId) return;
    const view = pane.querySelector<HTMLElement>('.diff-view');
    if (!view || view.dataset.fileId !== currentFileId) return;
    const { top, bottom } = viewport(pane);
    if (bottom <= top) return;
    const backward = direction < 0;
    const threads = threadsIn(view);
    if (backward) threads.reverse();
    const next = threads.find(thread => backward ? thread.top < top - 1 : thread.bottom > bottom + 1);
    if (next) { jump(pane, view, next, backward); return; }

    const order = allFileOrder.value;
    const current = order.indexOf(currentFileId);
    if (current < 0) return;
    for (let offset = 1; offset < order.length; offset++) {
      const fileId = order[(current + (backward ? -offset : offset) + order.length) % order.length];
      const file = files.find(item => item.id === fileId);
      if (!file || activeTab()?.comments.some(message => !message.deleted && message.kind === 'review'
        && message.parentId === undefined && message.path === file.file_path) !== true) continue;
      const request = { fileId, reviewId };
      pending = request;
      const hiddenFileIds = new Set(reviewStore.state.value.hiddenFileIds);
      hiddenFileIds.delete(fileId);
      reviewStore.actions.update({ hiddenFileIds });
      // Selection starts a fetch; wait for the destination and its threads to mount.
      await new Promise<void>(resolve => {
        let finished = false;
        const finish = () => { finished = true; observer.disconnect(); clearTimeout(timer); resolve(); };
        const check = () => {
          if (finished) return;
          const state = reviewStore.state.value;
          if (pending !== request || state.currentFileId !== fileId || state.reviewId !== reviewId
            || activeTab()?.view !== 'file') { finish(); return; }
          const mounted = pane.querySelector<HTMLElement>('.diff-view');
          if (mounted?.dataset.fileId !== fileId) return;
          const targets = threadsIn(mounted);
          const target = backward ? targets.at(-1) : targets[0];
          if (target) jump(pane, mounted, target, backward, true);
          finish();
        };
        const observer = new MutationObserver(check);
        const timer = setTimeout(() => {
          if (pending === request && reviewStore.state.value.currentFileId === fileId
            && reviewStore.state.value.reviewId === reviewId && activeTab()?.view === 'file') showToast('Could not load the comment’s file. Please try again.');
          finish();
        }, 10000);
        observer.observe(pane, { childList: true, subtree: true });
        void selectFile(fileId).then(check).catch(() => {
          if (!finished) showToast('Could not load the comment’s file. Please try again.');
          finish();
        });
      });
      if (pending === request) pending = null;
      return;
    }
  };
}
