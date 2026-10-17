import { getTauriInvoke } from './tauri.js';
import { showToast } from './toast.js';

/** Native webview zoom scales the whole layout and keeps viewport calculations correct. */
export function bindAppZoom(): void {
  const invoke = getTauriInvoke();
  if (!invoke) return; // Browsers retain their own standard zoom shortcuts.
  let percent = 100;
  try {
    const saved = Number(localStorage.getItem('glassbox.appZoom'));
    if (Number.isFinite(saved) && saved >= 50 && saved <= 200) percent = saved;
  } catch { /* optional persistence */ }
  const apply = () => {
    void invoke('set_app_zoom', { scale: percent / 100 }).catch((error: unknown) => {
      showToast(`Could not change zoom: ${String(error)}`);
    });
    try { localStorage.setItem('glassbox.appZoom', String(percent)); } catch { /* optional persistence */ }
  };
  apply();
  let last: { source: 'key' | 'menu'; direction: number; at: number } | null = null;
  const zoom = (direction: number, source: 'key' | 'menu') => {
    const now = performance.now();
    if (last && last.source !== source && last.direction === direction && now - last.at < 100) {
      last = null;
      return;
    }
    last = { source, direction, at: now };
    percent = direction === 0 ? 100 : Math.max(50, Math.min(200, percent + direction * 10));
    apply();
  };
  for (const [event, direction] of [['in', 1], ['out', -1], ['reset', 0]] as const)
    document.addEventListener(`glassbox-zoom-${event}`, () => { zoom(direction, 'menu'); });
  document.addEventListener('keydown', event => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing) return;
    const direction = event.key === '=' || event.key === '+' ? 1 : event.key === '-' ? -1 : event.key === '0' ? 0 : null;
    if (direction === null) return;
    event.preventDefault();
    if (!event.repeat) zoom(direction, 'key');
  }, true);
}
