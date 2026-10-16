import { afterEach, describe, expect, it, vi } from 'vitest';
import { reviewStore, visibleFileOrder } from '../../../src/client/stores/index.js';
import { selectFile } from '../../../src/client/diff/selection.js';
import { bindChangeNavigation } from '../../../src/client/diff/changeNavigation.js';

vi.mock('../../../src/client/stores/index.js', () => ({
  reviewStore: { state: { value: { currentFileId: 'f1' } } },
  visibleFileOrder: { value: ['f1'] },
}));
vi.mock('../../../src/client/diff/selection.js', () => ({ selectFile: vi.fn() }));

function fixture(positions = [100, 400, 700], maxScroll = 1000) {
  vi.useFakeTimers();
  reviewStore.state.value.currentFileId = 'f1';
  visibleFileOrder.value = ['f1'];
  vi.mocked(selectFile).mockReset().mockImplementation(async fileId => {
    reviewStore.state.value.currentFileId = fileId;
  });
  let handler: (event: KeyboardEvent) => void;
  let scrollTop = 0;
  const makeBlocks = (positions: number[]) => positions.map((top, index) => ({
    dataset: { changeStart: String(index) },
    getBoundingClientRect: () => ({ top: top - scrollTop }),
    classList: { add: vi.fn(), remove: vi.fn() }, focus: vi.fn(), tabIndex: 0,
  }));
  const blocks = makeBlocks(positions);
  let view: { dataset: { fileId: string }; querySelectorAll: () => typeof blocks } | null = {
    dataset: { fileId: 'f1' }, querySelectorAll: () => [...blocks].reverse(),
  };
  const container = {
    querySelector: () => view, focus: vi.fn(), tabIndex: 0,
    getBoundingClientRect: () => ({ top: 0 }),
    get scrollTop() { return scrollTop; },
    set scrollTop(n: number) { scrollTop = Math.max(0, Math.min(maxScroll, n)); },
  };
  const doc = {
    activeElement: { closest: vi.fn((): unknown => null) },
    getElementById: () => container,
    querySelectorAll: vi.fn((): unknown[] => []),
    addEventListener: (_type: string, callback: typeof handler) => { handler = callback; },
  };
  vi.stubGlobal('document', doc);
  const onRendered = bindChangeNavigation();
  return {
    blocks, doc, container, onRendered,
    replaceView: () => { view = { ...view! }; },
    render: (fileId: string, positions: number[] | null) => {
      const nextBlocks = makeBlocks(positions ?? []);
      view = positions === null ? null : { dataset: { fileId }, querySelectorAll: () => [...nextBlocks].reverse() };
      onRendered(fileId);
      return nextBlocks;
    },
    key: (options: Partial<KeyboardEvent> = {}) => {
      const event = { key: 'Tab', preventDefault: vi.fn(), ...options };
      handler(event as KeyboardEvent);
      return event;
    },
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Tab change navigation', () => {
  it('uses logical block order across split columns and moves backward', () => {
    const f = fixture();
    expect(f.key().preventDefault).toHaveBeenCalledOnce();
    expect(f.blocks[0].focus).toHaveBeenCalledOnce();
    f.key(); expect(f.blocks[1].focus).toHaveBeenCalledOnce();
    f.key({ shiftKey: true }); expect(f.blocks[0].focus).toHaveBeenCalledTimes(2);
  });

  it('continues through blocks when scrolling is clamped, and stops at either end', () => {
    const f = fixture([100, 120, 140], 0);
    f.key(); f.key(); f.key(); f.key();
    expect(f.blocks.map(b => b.focus.mock.calls.length)).toEqual([1,1,2]);
    f.key({ shiftKey: true }); f.key({ shiftKey: true }); f.key({ shiftKey: true });
    expect(f.blocks.map(b => b.focus.mock.calls.length)).toEqual([3,2,2]);
  });

  it('reanchors to the viewport after manual scrolling', () => {
    const f = fixture();
    f.key();
    f.container.scrollTop = 500;
    f.key({ shiftKey: true });
    expect(f.blocks[1].focus).toHaveBeenCalledOnce();
  });

  it('resets navigation when a new file or diff mode mounts', () => {
    const f = fixture();
    f.key(); f.key();
    f.container.scrollTop = 0; f.replaceView(); f.key();
    expect(f.blocks[0].focus).toHaveBeenCalledTimes(2);
  });

  it.each([{ positions: [] }, { positions: [100] }])('handles zero or one changed block: %j', ({ positions }) => {
    const f = fixture(positions);
    expect(f.key().preventDefault).toHaveBeenCalledOnce();
    f.key(); f.key({ shiftKey: true });
    if (f.blocks.length) expect(f.blocks[0].focus).toHaveBeenCalledTimes(3);
  });

  it.each([{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { defaultPrevented: true }, { key: 'Enter' }])('leaves other shortcuts alone: %j', options => {
    const f = fixture();
    expect(f.key(options).preventDefault).not.toHaveBeenCalled();
  });

  it('preserves normal Tab inside inputs, editable content, and visible dialogs', () => {
    const f = fixture();
    f.doc.activeElement.closest.mockReturnValue({});
    expect(f.key().preventDefault).not.toHaveBeenCalled();
    f.doc.activeElement.closest.mockReturnValue(null);
    f.doc.querySelectorAll.mockReturnValue([{ getClientRects: () => [{}] }]);
    expect(f.key().preventDefault).not.toHaveBeenCalled();
    f.doc.querySelectorAll.mockReturnValue([{ getClientRects: () => [] }]);
    expect(f.key().preventDefault).toHaveBeenCalledOnce();
  });
});

describe('Tab across files', () => {
  it('waits for the next visible file and lands on its first block without skipping on repeated Tab', () => {
    const f = fixture([100]);
    visibleFileOrder.value = ['f1', 'f3', 'f2'];
    f.key(); f.key(); f.key();
    expect(selectFile).toHaveBeenCalledExactlyOnceWith('f3');
    expect(f.blocks[0].focus).toHaveBeenCalledOnce();
    f.onRendered('f1'); // An earlier render must not consume the pending jump.
    const next = f.render('f3', [200, 500]);
    expect(next[0].focus).toHaveBeenCalledOnce();
    expect(next[1].focus).not.toHaveBeenCalled();
    f.key();
    expect(next[1].focus).toHaveBeenCalledOnce();
  });

  it("lands on the previous file's last block with Shift+Tab", () => {
    const f = fixture([100]);
    visibleFileOrder.value = ['f0', 'f1'];
    f.key(); f.key({ shiftKey: true });
    expect(selectFile).toHaveBeenCalledExactlyOnceWith('f0');
    const previous = f.render('f0', [200, 500]);
    expect(previous[1].focus).toHaveBeenCalledOnce();
    f.key({ shiftKey: true });
    expect(previous[0].focus).toHaveBeenCalledOnce();
  });

  it.each([false, true])('crosses a file boundary after manually scrolling past changes (backward=%s)', backward => {
    const f = fixture();
    visibleFileOrder.value = ['f0', 'f1', 'f2'];
    f.container.scrollTop = backward ? 0 : 800;
    f.key({ shiftKey: backward });
    expect(selectFile).toHaveBeenCalledExactlyOnceWith(backward ? 'f0' : 'f2');
  });

  it('visits files with no changed blocks and continues on the following Tab', () => {
    const f = fixture([]);
    visibleFileOrder.value = ['f1', 'f2', 'f3'];
    f.key();
    expect(selectFile).toHaveBeenCalledExactlyOnceWith('f2');
    f.render('f2', []);
    expect(f.container.focus).toHaveBeenCalledOnce();
    expect(selectFile).toHaveBeenCalledTimes(1);
    f.key();
    expect(selectFile).toHaveBeenLastCalledWith('f3');
  });

  it('cancels a pending jump when the user selects a different file', () => {
    const f = fixture([100]);
    visibleFileOrder.value = ['f1', 'f2', 'f3'];
    f.key(); f.key();
    reviewStore.state.value.currentFileId = 'f3';
    const other = f.render('f3', [100]);
    expect(other[0].focus).not.toHaveBeenCalled();
    f.key();
    expect(other[0].focus).toHaveBeenCalledOnce();
  });

  it('clears a pending jump on load failure and allows later navigation', () => {
    const f = fixture([100]);
    visibleFileOrder.value = ['f1', 'f2'];
    f.key(); f.key();
    f.render('f2', null);
    expect(f.key().preventDefault).not.toHaveBeenCalled();
    reviewStore.state.value.currentFileId = 'f1';
    f.render('f1', [100]);
    f.key(); f.key();
    expect(selectFile).toHaveBeenCalledTimes(2);
  });

  it('does not navigate from stale DOM while a manually selected file loads', () => {
    const f = fixture([100]);
    reviewStore.state.value.currentFileId = 'f2';
    f.key();
    expect(f.blocks[0].focus).not.toHaveBeenCalled();
    expect(selectFile).not.toHaveBeenCalled();
  });

  it.each([{ order: [] }, { order: ['other'] }])('does not choose an unrelated file when the current file is filtered out: %j', ({ order }) => {
    const f = fixture([]);
    visibleFileOrder.value = order;
    f.key(); f.key({ shiftKey: true });
    expect(selectFile).not.toHaveBeenCalled();
  });
});
