/** Persistent pointer/keyboard resizing for the tab rail and mid-panel sections. */
export function bindDivider(
  handle: HTMLElement,
  panel: HTMLElement,
  axis: 'width' | 'height',
  key: string,
  min: number,
  initial: number,
): void {
  const apply = (size: number) => {
    const max =
      axis === 'width'
        ? Math.max(min, window.innerWidth - 450)
        : Math.max(min, (panel.parentElement?.clientHeight ?? window.innerHeight) - 160);
    const value = Math.min(max, Math.max(min, size));
    panel.style[axis] = `${value}px`;
    panel.style.flexBasis = `${value}px`;
    panel.style.flexGrow = '0';
    panel.style.flexShrink = '0';
    panel.classList.toggle('compact', axis === 'width' && value <= min + 30);
    handle.setAttribute('aria-valuenow', String(Math.round(value)));
    try {
      localStorage.setItem(key, String(value));
    } catch {
      /* optional persistence */
    }
  };
  let size = initial;
  try {
    const saved = Number(localStorage.getItem(key));
    if (saved > 0) size = saved;
  } catch {
    /* optional persistence */
  }
  apply(size);
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const start = axis === 'width' ? event.clientX : event.clientY;
    const original = panel.getBoundingClientRect()[axis];
    const move = (e: PointerEvent) => {
      apply(original + (axis === 'width' ? e.clientX : e.clientY) - start);
    };
    const stop = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', stop);
      handle.removeEventListener('pointercancel', stop);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
  });
  handle.addEventListener('keydown', (event) => {
    const minus = axis === 'width' ? 'ArrowLeft' : 'ArrowUp';
    const plus = axis === 'width' ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== minus && event.key !== plus) return;
    event.preventDefault();
    event.stopPropagation();
    apply(panel.getBoundingClientRect()[axis] + (event.key === plus ? 20 : -20));
  });
}
