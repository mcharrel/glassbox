import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('document', { body: { dataset: {} } });
const { aiStore, reviewStore, visibleNoteLines } = await import('../../../src/client/stores/index.js');
const { bindNoteVisibility } = await import('../../../src/client/sidebar/noteVisibility.js');

function rect(top: number, bottom: number, left = 0, right = 500) {
  return { top, bottom, left, right, width: right - left, height: bottom - top };
}

describe('viewport guidance tracking', () => {
  let rows: Array<{ dataset: { line: string; side: string }; getBoundingClientRect: () => ReturnType<typeof rect> }>;
  let view: { dataset: { fileId: string }; querySelectorAll: ReturnType<typeof vi.fn> } | null;
  let headers: Array<ReturnType<typeof rect>>;
  let container: any;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let listeners: Map<string, () => void>;
  let onResize: () => void;
  let onMutation: () => void;
  let resize: { observe: ReturnType<typeof vi.fn>; unobserve: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  let mutation: { observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn> };
  let dispose: () => void;

  function row(line: number, top: number, bottom: number, side = 'new', left = 0, right = 500) {
    return { dataset: { line: String(line), side }, getBoundingClientRect: () => rect(top, bottom, left, right) };
  }

  async function flush() {
    await Promise.resolve();
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach(callback => callback(0));
    await Promise.resolve();
  }

  beforeEach(() => {
    frames = new Map(); nextFrame = 0; listeners = new Map(); rows = []; headers = [];
    view = {
      dataset: { fileId: 'a' },
      querySelectorAll: vi.fn(selector => rows.filter(row => row.dataset.side === 'new'
        && selector.includes(`[data-line="${row.dataset.line}"]`))),
    };
    container = {
      clientTop: 0, clientLeft: 0, clientHeight: 300, clientWidth: 500,
      getBoundingClientRect: () => rect(100, 400),
      querySelector: () => view,
      querySelectorAll: () => headers.map(bounds => ({ getBoundingClientRect: () => bounds })),
      addEventListener: (name: string, fn: () => void) => listeners.set(name, fn),
      removeEventListener: (name: string) => listeners.delete(name),
    };
    resize = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    mutation = { observe: vi.fn(), disconnect: vi.fn() };
    vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { onResize = callback; return resize; } });
    vi.stubGlobal('MutationObserver', class { constructor(callback: () => void) { onMutation = callback; return mutation; } });
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    reviewStore.actions.update({ currentFileId: 'a' });
    aiStore.actions.update({ sortMode: 'narrative', guidedReviewEnabled: true, fileNotes: {}, guidedNotes: {} });
    dispose = bindNoteVisibility(container);
  });

  afterEach(() => { dispose(); });

  it('shows only intersecting new-side anchors, excluding sticky headers and old-side duplicates', async () => {
    headers = [rect(100, 140)];
    rows = [row(1, 120, 140), row(2, 139, 159), row(3, 399, 419), row(4, 400, 420),
      row(1, 160, 180, 'old'), row(5, 200, 220, 'new', 500, 600), row(6, 250, 250)];
    aiStore.actions.update({ fileNotes: { a: { overview: 'File summary', lines: [1, 2, 3, 4, 5, 6].map(line => ({ line, content: 'Explanation' })) } } });
    await flush();
    expect([...visibleNoteLines.value.lines]).toEqual([2, 3]);
  });

  it('follows scroll in either direction and avoids publishing unchanged visibility', async () => {
    rows = [row(7, 150, 170), row(8, 500, 520)];
    aiStore.actions.update({ guidedNotes: { a: { overview: '', lines: [7, 8].map(line => ({ line, content: 'Learn' })) } } });
    await flush();
    const before = visibleNoteLines.value;
    listeners.get('scroll')!(); listeners.get('scroll')!(); onResize();
    expect(frames.size).toBe(1);
    await flush();
    expect(visibleNoteLines.value).toBe(before);
    rows = [row(7, 50, 70), row(8, 150, 170)];
    listeners.get('scroll')!(); await flush();
    expect([...visibleNoteLines.value.lines]).toEqual([8]);
    rows = [row(7, 150, 170), row(8, 500, 520)];
    listeners.get('scroll')!(); await flush();
    expect([...visibleNoteLines.value.lines]).toEqual([7]);
  });

  it('clears stale notes during a file switch and measures after the new diff mounts', async () => {
    rows = [row(7, 150, 170)];
    const note = { overview: '', lines: [{ line: 7, content: 'Note' }] };
    aiStore.actions.update({ fileNotes: { a: note, b: note } });
    await flush();
    const oldView = view;
    reviewStore.actions.update({ currentFileId: 'b' });
    await flush();
    expect(visibleNoteLines.value.fileId).toBe('b');
    expect(visibleNoteLines.value.lines.size).toBe(0);
    view = { ...oldView!, dataset: { fileId: 'b' } };
    onMutation(); await flush();
    expect([...visibleNoteLines.value.lines]).toEqual([7]);
    expect(resize.unobserve).toHaveBeenCalledWith(oldView);
    expect(resize.observe).toHaveBeenCalledWith(view);
    reviewStore.actions.update({ currentFileId: null });
    await flush();
    expect(visibleNoteLines.value).toEqual({ fileId: null, lines: new Set() });
  });

  it('reacts to new analysis, learning toggles, and code reflow', async () => {
    rows = [row(7, 150, 170)];
    await flush();
    expect(visibleNoteLines.value.lines.size).toBe(0);
    aiStore.actions.update({ guidedNotes: { a: { overview: '', lines: [{ line: 7, content: 'Learn' }] } } });
    await flush();
    expect([...visibleNoteLines.value.lines]).toEqual([7]);
    rows = [row(7, 450, 470)];
    onResize(); await flush();
    expect(visibleNoteLines.value.lines.size).toBe(0);
    rows = [row(7, 150, 170)];
    onMutation(); await flush();
    expect([...visibleNoteLines.value.lines]).toEqual([7]);
    aiStore.actions.update({ guidedReviewEnabled: false });
    await flush();
    expect(visibleNoteLines.value.lines.size).toBe(0);
  });

  it('handles empty, loading, and hidden panes without inventing a visible range', async () => {
    aiStore.actions.update({ fileNotes: { a: { overview: '', lines: [{ line: 7, content: 'Guide' }] } } });
    rows = [row(7, 150, 170)];
    container.clientHeight = 0;
    await flush();
    expect(visibleNoteLines.value.lines.size).toBe(0);
    container.clientHeight = 300;
    view = null; onMutation(); await flush();
    expect(visibleNoteLines.value.lines.size).toBe(0);
  });

  it('disconnects observers, listeners, and pending frames when disposed', () => {
    expect(frames.size).toBe(1);
    dispose();
    expect(frames.size).toBe(0);
    expect(listeners.size).toBe(0);
    expect(resize.disconnect).toHaveBeenCalled();
    expect(mutation.disconnect).toHaveBeenCalled();
  });
});
