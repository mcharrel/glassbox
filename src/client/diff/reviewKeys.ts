/** Review shortcuts never consume text input or modal navigation. */
export function bindReviewKeys(nextMatch: (direction: number) => void): void {
  document.addEventListener('keydown', e => {
    const target = e.target instanceof Element ? e.target : null;
    if (e.defaultPrevented || e.isComposing || e.metaKey || e.ctrlKey || e.altKey ||
        target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"], dialog') ||
        document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
    if (e.key === 'G' && document.body.dataset.workspaceView !== 'main' && document.body.dataset.workspaceView !== 'add') {
      e.preventDefault();
      const pane = document.getElementById('diff-container');
      pane?.scrollTo({ top: pane.scrollHeight, behavior: 'instant' });
    } else if (e.key === 'n' || e.key === 'N' || e.key === 'm') {
      e.preventDefault(); nextMatch(e.key === 'n' ? 1 : -1);
    }
  });
}
