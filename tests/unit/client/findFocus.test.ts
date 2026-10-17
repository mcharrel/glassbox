import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/client/stores/index.js', () => ({ reviewStore: {}, allFileOrder: {} }));
vi.mock('../../../src/client/diff/selection.js', () => ({ selectFile: vi.fn() }));
const native = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../src/client/tauri.js', () => ({ getTauriGlobal: native.get }));
vi.mock('../../../src/client/diff/reviewKeys.js', () => ({ bindReviewKeys: vi.fn() }));
const render = vi.hoisted(() => vi.fn());
vi.mock('../../../src/client/dom.js', () => ({ toElement: render }));
afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.resetModules());

describe('find focus shortcut', () => {
  it.each([['metaKey', 'browser'], ['ctrlKey', 'browser'], ['metaKey', 'paired'], ['ctrlKey', 'paired'], ['metaKey', 'menu-first'], ['metaKey', 'menu-only'], ['metaKey', 'listener-failed']] as const)('toggles %s+F (native menu: %s) without clearing the query', async (modifier, desktop) => {
    let menuFind: (() => void) | undefined;
    native.get.mockReturnValue(desktop !== 'browser' ? { event: { listen: (_name: string, callback: () => void) => { menuFind = callback; return desktop === 'listener-failed' ? Promise.reject(new Error('IPC unavailable')) : undefined; } } } : undefined);
    const listeners = new Map<string, (event: unknown) => void>();
    const page = { activeElement: null as unknown, body: { dataset: {} },
      addEventListener: (name: string, fn: (event: unknown) => void) => listeners.set(name, fn),
      querySelector: () => ({ insertBefore() {} }), getElementById: () => pane };
    const pane = { tabIndex: 0, focus: vi.fn(() => { page.activeElement = pane; }) };
    const input = { value: '', addEventListener() {}, select: vi.fn(), focus: () => { page.activeElement = input; } };
    const bar = { style: { display: '' }, addEventListener() {},
      querySelector: (selector: string) => selector === '.find-input' ? input : { addEventListener() {} } };
    render.mockReturnValue(bar);
    vi.stubGlobal('document', page);
    vi.stubGlobal('navigator', { userAgent: 'Mac' });
    const { bindFind } = await import('../../../src/client/diff/find.js');
    bindFind();
    const key = () => {
      if (desktop === 'menu-first' || desktop === 'menu-only') menuFind?.();
      if (desktop !== 'menu-only') listeners.get('keydown')?.({ key: 'f', [modifier]: true, preventDefault() {} });
      if (desktop === 'paired') menuFind?.();
    };
    key(); expect(page.activeElement).toBe(input);
    input.value = 'rewriteFragmentIdKeys';
    key(); expect(page.activeElement).toBe(pane);
    expect(pane.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(bar.style.display).toBe('flex');
    expect(input.value).toBe('rewriteFragmentIdKeys');
    key(); expect(page.activeElement).toBe(input);
    expect(input.value).toBe('rewriteFragmentIdKeys');
  });
});
