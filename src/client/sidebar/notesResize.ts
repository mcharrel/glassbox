const HEIGHT_KEY = 'glassbox.sidebarNotesHeight';

/** Clamp to the available sidebar space while leaving the file list usable. */
export function clampNotesHeight(height: number, available: number): number {
  const max = Math.max(0, available - 100);
  return Math.min(max, Math.max(Math.min(60, max), height));
}

export function bindNotesResize(sidebar: HTMLElement, notes: HTMLElement): void {
  const handle = sidebar.querySelector<HTMLElement>('#sidebar-notes-resize');
  const files = sidebar.querySelector<HTMLElement>('.file-list');
  if (!handle || !files) return;
  let requested = sidebar.clientHeight * 0.45;
  try {
    const saved = Number(localStorage.getItem(HEIGHT_KEY));
    if (Number.isFinite(saved) && saved > 0) requested = saved;
  } catch { /* Storage may be disabled; resizing still works. */ }

  const apply = () => {
    const available = sidebar.getBoundingClientRect().bottom - files.getBoundingClientRect().top - handle.offsetHeight;
    const height = clampNotesHeight(requested, available);
    notes.style.flexBasis = `${String(height)}px`;
    handle.setAttribute('aria-valuenow', String(Math.round(height)));
    handle.setAttribute('aria-valuemin', String(Math.min(60, Math.max(0, available - 100))));
    handle.setAttribute('aria-valuemax', String(Math.max(0, Math.round(available - 100))));
  };
  const save = () => {
    requested = notes.getBoundingClientRect().height;
    try { localStorage.setItem(HEIGHT_KEY, String(requested)); } catch { /* optional persistence */ }
  };
  // The divider is outside the notes mount and survives its content updates.
  handle.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = notes.getBoundingClientRect().height;
    const cursor = document.body.style.cursor;
    const selection = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    handle.classList.add('dragging');
    const move = (event: MouseEvent) => { requested = startHeight + startY - event.clientY; apply(); };
    const finish = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', finish);
      window.removeEventListener('blur', finish);
      document.body.style.cursor = cursor;
      document.body.style.userSelect = selection;
      handle.classList.remove('dragging');
      save();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', finish);
    window.addEventListener('blur', finish);
  });
  handle.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    e.stopPropagation();
    requested = notes.getBoundingClientRect().height + (e.key === 'ArrowUp' ? 20 : -20);
    apply(); save();
  });
  new ResizeObserver(apply).observe(sidebar);
  apply();
}
