import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ invoke: vi.fn(), available: true }));
vi.mock('../../../src/client/tauri.js', () => ({ getTauriInvoke: () => native.available ? native.invoke : null }));
vi.mock('../../../src/client/toast.js', () => ({ showToast: vi.fn() }));
import { bindAppZoom } from '../../../src/client/zoom.js';

const listeners = new Map<string, (event?: unknown) => void>();
let saved: string | null;
beforeEach(() => {
  native.available = true; native.invoke.mockReset().mockResolvedValue(undefined);
  listeners.clear(); saved = null;
  vi.stubGlobal('document', { addEventListener: (name: string, fn: () => void) => listeners.set(name, fn) });
  vi.stubGlobal('localStorage', { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } });
});
afterEach(() => vi.unstubAllGlobals());
function key(value: string) {
  const preventDefault = vi.fn();
  listeners.get('keydown')?.({ key: value, metaKey: true, preventDefault });
  return preventDefault;
}
it('zooms the whole native webview, persists the scale, supports reset and clamps extremes', () => {
  saved = '120'; bindAppZoom();
  expect(native.invoke).toHaveBeenLastCalledWith('set_app_zoom', { scale: 1.2 });
  expect(key('=')).toHaveBeenCalled();
  expect(native.invoke).toHaveBeenLastCalledWith('set_app_zoom', { scale: 1.3 });
  expect(saved).toBe('130');
  key('-'); expect(saved).toBe('120');
  key('0'); expect(saved).toBe('100');
  for (let i = 0; i < 30; i++) key('-');
  expect(saved).toBe('50');
  for (let i = 0; i < 30; i++) key('+');
  expect(saved).toBe('200');
});
it.each(['key-first', 'menu-first'])('does not apply a paired native/key shortcut twice (%s)', order => {
  bindAppZoom();
  const menu = () => listeners.get('glassbox-zoom-in')?.();
  if (order === 'key-first') { key('='); menu(); } else { menu(); key('='); }
  expect(saved).toBe('110');
  expect(native.invoke).toHaveBeenCalledTimes(2);
});
it('retains normal browser zoom outside the desktop shell', () => {
  native.available = false; bindAppZoom();
  expect(listeners.size).toBe(0);
});
