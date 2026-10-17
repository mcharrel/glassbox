import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindDivider } from '../../../src/client/workspace/resize.js';

function fixture(saved: string | null = null, axis: 'width' | 'height' = 'height', min = 130, initial = 180) {
  const storage = new Map(saved === null ? [] : [['size', saved]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal('window', { innerWidth: 1200, innerHeight: 900 });
  const observers: (() => void)[] = [];
  vi.stubGlobal('ResizeObserver', class { constructor(fn: () => void) { observers.push(fn); } observe() {} });
  vi.stubGlobal('MutationObserver', class { constructor(fn: () => void) { observers.push(fn); } observe() {} });
  const handlers = new Map<string, (event: any) => void>();
  const panel = { style: {} as Record<string, string>, classList: { toggle: vi.fn() }, parentElement: { clientHeight: 900 },
    getBoundingClientRect: () => ({ width: parseFloat(panel.style.width), height: parseFloat(panel.style.height) }) };
  const handle = { setAttribute: vi.fn(), addEventListener: (name: string, fn: (event: any) => void) => handlers.set(name, fn) };
  let minimum = min;
  bindDivider(handle as never, panel as never, axis, 'size', min, initial, () => minimum);
  return { panel, storage, resize: () => observers.forEach(fn => fn()), setMinimum: (value: number) => { minimum = value; },
    key: (key: string) => handlers.get('keydown')?.({ key, preventDefault() {}, stopPropagation() {} }) };
}
afterEach(() => vi.unstubAllGlobals());
describe('persistent section dividers', () => {
  it('shrinks the tab rail to the measured ID width and adapts to longer IDs', () => {
    const f = fixture(null, 'width', 40, 40);
    f.setMinimum(72); f.resize();
    expect(f.panel.style.width).toBe('72px');
    expect(f.panel.classList.toggle).toHaveBeenLastCalledWith('compact', true);
    f.key('ArrowLeft'); expect(f.panel.style.width).toBe('72px');
    f.setMinimum(88); f.resize(); expect(f.panel.style.width).toBe('88px');
    f.key('ArrowRight'); f.key('ArrowRight');
    expect(f.panel.classList.toggle).toHaveBeenLastCalledWith('compact', false);
    f.key('ArrowLeft'); f.key('ArrowLeft'); f.key('ArrowLeft');
    expect(f.panel.style.width).toBe('88px');
  });
  it('cannot shrink below all title content, including after wrapping changes its height', () => {
    const f = fixture(); f.setMinimum(260); f.resize();
    expect(f.panel.style.height).toBe('260px');
    f.key('ArrowUp'); expect(f.panel.style.height).toBe('260px');
    f.setMinimum(340); f.resize(); expect(f.panel.style.height).toBe('340px');
  });
  it('retains the requested size while the parent is hidden or temporarily smaller', () => {
    const f = fixture('420');
    f.panel.parentElement.clientHeight = 0; f.resize();
    expect(f.panel.style.height).toBe('130px');
    expect(f.storage.get('size')).toBe('420');
    f.panel.parentElement.clientHeight = 900; f.resize();
    expect(f.panel.style.height).toBe('420px');
    f.key('ArrowDown'); expect(f.storage.get('size')).toBe('440');
  });
});
