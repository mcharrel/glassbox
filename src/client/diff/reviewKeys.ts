/** Vim-style review keys are inactive while entering text or using a dialog. */
export function bindReviewKeys(nextMatch: (direction: number) => void): void {
  let previousG = -Infinity;
  document.addEventListener('keydown', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey ||
        target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], dialog') ||
        document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) {
      previousG = -Infinity;
      return;
    }
    const now = performance.now();
    if (e.key === 'g' && !e.repeat) {
      if (now - previousG < 700) {
        e.preventDefault();
        document.getElementById('diff-container')?.scrollTo({ top: 0, behavior: 'instant' });
        previousG = -Infinity;
      } else previousG = now;
      return;
    }
    previousG = -Infinity;
    if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      nextMatch(e.shiftKey || e.key === 'N' ? -1 : 1);
    }
  });
}
