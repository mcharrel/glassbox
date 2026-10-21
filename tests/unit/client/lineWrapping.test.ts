import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let saved: Map<string, string>;
beforeEach(() => {
  vi.resetModules();
  saved = new Map();
  vi.stubGlobal('document', { body: { dataset: {} } });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('code line layout preference', () => {
  it('defaults to wrapping, and restores either choice after restarting', async () => {
    let { diffViewStore } = await import('../../../src/client/stores/index.js');
    expect(diffViewStore.state.value.wrapLines).toBe(true);
    for (const wrap of [true, false]) {
      diffViewStore.actions.setWrapLines(wrap);
      expect(saved.get('glassbox.wrapLines')).toBe(String(wrap));
      vi.resetModules();
      ({ diffViewStore } = await import('../../../src/client/stores/index.js'));
      expect(diffViewStore.state.value.wrapLines).toBe(wrap);
    }
  });

  it('keeps the setting usable when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('Unavailable'); },
      setItem: () => { throw new Error('Unavailable'); },
    });
    const { diffViewStore } = await import('../../../src/client/stores/index.js');
    expect(diffViewStore.state.value.wrapLines).toBe(true);
    diffViewStore.actions.setWrapLines(false);
    expect(diffViewStore.state.value.wrapLines).toBe(false);
  });

  it('ignores an invalid stored choice', async () => {
    saved.set('glassbox.wrapLines', 'invalid');
    const { diffViewStore } = await import('../../../src/client/stores/index.js');
    expect(diffViewStore.state.value.wrapLines).toBe(true);
  });
});
