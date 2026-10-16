import { effect } from 'kerfjs';

import { aiStore, reviewStore, visibleNoteLines } from '../stores/index.js';

/** Keep guidance aligned with visible new-side lines, including after async diff mounts. */
export function bindNoteVisibility(container: HTMLElement): () => void {
  let frame: number | null = null;
  let observedView: HTMLElement | null = null;
  let lastFileId: string | null | undefined;
  let lastLines = new Set<number>();

  function publish(fileId: string | null, lines: Set<number>): void {
    if (lastFileId === fileId && lastLines.size === lines.size && [...lines].every(line => lastLines.has(line))) return;
    lastFileId = fileId;
    lastLines = lines;
    visibleNoteLines.value = { fileId, lines };
  }

  function measure(): void {
    frame = null;
    const fileId = reviewStore.state.value.currentFileId;
    const view = container.querySelector<HTMLElement>('.diff-view');
    if (view !== observedView) {
      if (observedView) resize.unobserve(observedView);
      if (view) resize.observe(view);
      observedView = view;
    }
    const lines = new Set<number>();
    if (fileId === null || !view || view.dataset.fileId !== fileId) {
      publish(fileId, lines);
      return;
    }

    const ai = aiStore.state.value;
    const guide = ai.sortMode === 'narrative' || ai.sortMode === 'risk' ? ai.fileNotes[fileId] : undefined;
    const learn = ai.guidedReviewEnabled ? ai.guidedNotes[fileId] : undefined;
    const anchors = new Set([...(guide?.lines ?? []), ...(learn?.lines ?? [])]
      .map(note => note.line).filter(line => Number.isInteger(line) && line > 0));
    const rect = container.getBoundingClientRect();
    let top = rect.top + container.clientTop;
    const bottom = top + container.clientHeight;
    const left = rect.left + container.clientLeft;
    const right = left + container.clientWidth;
    // Sticky headers cover code even when its row intersects the scrolling pane.
    for (const chrome of container.querySelectorAll<HTMLElement>('.diff-header, .outline-bar')) {
      const bounds = chrome.getBoundingClientRect();
      if (bounds.height > 0 && bounds.top < bottom) top = Math.max(top, bounds.bottom);
    }
    if (anchors.size > 0 && bottom > top && right > left) {
      const selector = [...anchors].map(line => `.diff-line[data-side="new"][data-line="${String(line)}"]`).join(',');
      for (const row of view.querySelectorAll<HTMLElement>(selector)) {
        const bounds = row.getBoundingClientRect();
        if (bounds.height > 0 && bounds.width > 0 && bounds.bottom > top && bounds.top < bottom
          && bounds.right > left && bounds.left < right) lines.add(Number(row.dataset.line));
      }
    }
    publish(fileId, lines);
  }

  function schedule(): void {
    frame ??= requestAnimationFrame(measure);
  }

  const resize = new ResizeObserver(schedule);
  resize.observe(container);
  const mutation = new MutationObserver(schedule);
  mutation.observe(container, { childList: true, subtree: true, characterData: true });
  container.addEventListener('scroll', schedule, { passive: true });
  let selectedFileId: string | null | undefined;
  const stop = effect(() => {
    const fileId = reviewStore.state.value.currentFileId;
    void aiStore.state.value;
    if (fileId !== selectedFileId) {
      selectedFileId = fileId;
      publish(fileId, new Set());
    }
    schedule();
  });

  return () => {
    stop();
    resize.disconnect();
    mutation.disconnect();
    container.removeEventListener('scroll', schedule);
    if (frame !== null) cancelAnimationFrame(frame);
    publish(null, new Set());
  };
}
