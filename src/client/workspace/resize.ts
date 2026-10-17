/** Persistent pointer/keyboard resizing for the tab rail and mid-panel sections. */
export function bindDivider(
  handle: HTMLElement,
  panel: HTMLElement,
  axis: 'width' | 'height',
  key: string,
  min: number,
  initial: number,
  contentMinimum: () => number = () => min,
): void {
  let requested = initial;
  try {
    const saved = Number(localStorage.getItem(key));
    if (Number.isFinite(saved) && saved > 0) requested = saved;
  } catch { /* optional persistence */ }
  const apply = () => {
    const minimum = Math.max(min, contentMinimum());
    const max =
      axis === 'width'
        ? Math.max(min, window.innerWidth - 450)
        : Math.max(min, (panel.parentElement?.clientHeight ?? window.innerHeight) - 160);
    const value = Math.max(minimum, Math.min(max, requested));
    panel.style[axis] = `${value}px`;
    panel.style.flexBasis = `${value}px`;
    panel.style.flexGrow = '0';
    panel.style.flexShrink = '0';
    panel.classList.toggle('compact', axis === 'width' && value <= min + 30);
    handle.setAttribute('aria-valuenow', String(Math.round(value)));
    handle.setAttribute('aria-valuemin', String(Math.ceil(minimum)));
  };
  const resize = (size: number) => {
    requested = Math.max(min, size);
    apply();
    try {
      localStorage.setItem(key, String(requested));
    } catch {
      /* optional persistence */
    }
  };
  apply();
  const observer = new ResizeObserver(apply);
  observer.observe(panel);
  if (panel.parentElement) observer.observe(panel.parentElement);
  new MutationObserver(apply).observe(panel, { childList: true, subtree: true, characterData: true });
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const start = axis === 'width' ? event.clientX : event.clientY;
    const original = panel.getBoundingClientRect()[axis];
    const move = (e: PointerEvent) => {
      resize(original + (axis === 'width' ? e.clientX : e.clientY) - start);
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
    resize(panel.getBoundingClientRect()[axis] + (event.key === plus ? 20 : -20));
  });
}
