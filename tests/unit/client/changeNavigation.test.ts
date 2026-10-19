import { afterEach, describe, expect, it, vi } from 'vitest';
import { reviewStore, allFileOrder } from '../../../src/client/stores/index.js';
import { selectFile } from '../../../src/client/diff/selection.js';
import { bindChangeNavigation, restoreChangeScroll } from '../../../src/client/diff/changeNavigation.js';

vi.mock('../../../src/client/stores/index.js', () => ({
  reviewStore: { state: { value: { currentFileId: 'f1', reviewId: 'review', hiddenFileIds: new Set() } }, actions: { update: vi.fn() } },
  allFileOrder: { value: ['f1'] },
}));
vi.mock('../../../src/client/diff/selection.js', () => ({ selectFile: vi.fn() }));

type Rows = [number, number][];
const change = (top: number, lines = 1, lineHeight = 20): Rows =>
  Array.from({ length: lines }, (_, i) => [top + i * lineHeight, top + (i + 1) * lineHeight]);

function fixture(specs: Rows[] = [change(100), change(200), change(700)], options: { height?: number; chrome?: number; maxScroll?: number } = {}) {
  vi.useFakeTimers();
  reviewStore.state.value.currentFileId = 'f1';
  allFileOrder.value = ['f1'];
  reviewStore.state.value.hiddenFileIds = new Set();
  vi.mocked(reviewStore.actions.update).mockImplementation(partial => { Object.assign(reviewStore.state.value, partial); });
  vi.mocked(selectFile).mockReset().mockImplementation(async fileId => {
    reviewStore.state.value.currentFileId = fileId;
  });
  let handler: (event: KeyboardEvent) => void;
  let scrollTop = 0;
  const makeBlocks = (specs: Rows[]) => specs.map((rows, index) => rows.map(([top, bottom]) => ({
    dataset: { changeBlock: String(index) },
    getBoundingClientRect: () => ({ top: 100 + top - scrollTop, bottom: 100 + bottom - scrollTop }),
    classList: { add: vi.fn(), remove: vi.fn() }, focus: vi.fn(), tabIndex: 0,
  })));
  const blocks = makeBlocks(specs);
  // Reversed DOM order also models split columns: logical changes must remain ordered.
  let view: { dataset: { fileId: string }; querySelectorAll: () => typeof blocks[number] } | null = {
    dataset: { fileId: 'f1' }, querySelectorAll: () => blocks.flat().reverse(),
  };
  const container = {
    querySelector: () => view, focus: vi.fn(), tabIndex: 0, clientTop: 0,
    clientHeight: options.height ?? 660,
    querySelectorAll: () => [{ getBoundingClientRect: () => ({ bottom: 140 }) },
      { getBoundingClientRect: () => ({ bottom: 100 + (options.chrome ?? 60) }) }],
    getBoundingClientRect: () => ({ top: 100 }),
    get scrollTop() { return scrollTop; },
    set scrollTop(n: number) { scrollTop = Math.max(0, Math.min(options.maxScroll ?? 5000, n)); },
  };
  const doc = {
    body: { dataset: { workspaceView: 'file' } },
    activeElement: { closest: vi.fn((): unknown => null) },
    getElementById: () => container,
    querySelectorAll: vi.fn((): unknown[] => []),
    addEventListener: (_type: string, callback: typeof handler) => { handler = callback; },
  };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('getComputedStyle', () => ({ lineHeight: '20px', borderTopWidth: '0px', borderBottomWidth: '0px' }));
  const onRendered = bindChangeNavigation();
  return {
    blocks, doc, container, onRendered,
    render: (fileId: string, specs: Rows[] | null) => {
      const next = makeBlocks(specs ?? []);
      view = specs === null ? null : { dataset: { fileId }, querySelectorAll: () => next.flat().reverse() };
      onRendered(fileId);
      return next;
    },
    key: (options: Partial<KeyboardEvent> = {}) => {
      const event = { key: 'Tab', shiftKey: false, preventDefault: vi.fn(), ...options };
      handler(event as KeyboardEvent);
      return event;
    },
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('first file visit', () => {
  it('opens at the first change with five lines of context without focusing or marking anything reviewed', () => {
    const f = fixture([change(700), change(1900)]);
    const position: { scrollTop?: number } = {};
    restoreChangeScroll(f.container as any, position);
    expect(f.container.scrollTop).toBe(540);
    expect(position.scrollTop).toBe(540);
    expect(f.blocks[0][0].focus).not.toHaveBeenCalled();
    expect(reviewStore.state.value.hiddenFileIds.size).toBe(0);
    expect(selectFile).not.toHaveBeenCalled();
    f.key();
    expect(f.container.scrollTop).toBe(1740);
  });
  it.each([0, 300, 1000])('restores a previous reading position of %i instead of jumping again', scrollTop => {
    const f = fixture([change(700)]);
    restoreChangeScroll(f.container as any, { scrollTop });
    expect(f.container.scrollTop).toBe(scrollTop);
  });
  it.each(['main', 'add'])('waits for a preloaded file to become visible from %s view', workspaceView => {
    const f = fixture([change(700)]);
    const position = {};
    f.doc.body.dataset.workspaceView = workspaceView;
    restoreChangeScroll(f.container as any, position);
    expect(position).toEqual({});
    f.doc.body.dataset.workspaceView = 'file';
    restoreChangeScroll(f.container as any, position);
    expect(f.container.scrollTop).toBe(540);
  });
  it('waits for layout and the correct file, without accepting stale content from a pending PR', () => {
    const f = fixture([change(700)], { height: 0 });
    const position = {};
    restoreChangeScroll(f.container as any, position);
    expect(position).toEqual({});
    f.container.clientHeight = 660;
    document.body.dataset.reviewPending = 'true';
    restoreChangeScroll(f.container as any, position);
    expect(position).toEqual({});
    document.body.dataset.reviewPending = 'false';
    reviewStore.state.value.currentFileId = 'f2';
    restoreChangeScroll(f.container as any, position);
    expect(position).toEqual({});
    f.render('f2', [change(900)]);
    restoreChangeScroll(f.container as any, position);
    expect(f.container.scrollTop).toBe(740);
  });
  it.each([{ specs: [] }, { specs: [change(10)] }])('stays at the top for no changes or a change at the start: %j', ({ specs }) => {
    const f = fixture(specs);
    const position = {};
    restoreChangeScroll(f.container as any, position);
    expect(position).toEqual({ scrollTop: 0 });
    expect(selectFile).not.toHaveBeenCalled();
  });
  it('starts a tall first change at its beginning, allowing subsequent overlapping pages', () => {
    const f = fixture([change(700, 80)]);
    restoreChangeScroll(f.container as any, {});
    expect(f.container.scrollTop).toBe(540);
    f.key();
    expect(f.container.scrollTop).toBe(940);
  });
});

describe('page-aware change navigation', () => {
  it('skips fully visible changes and leaves five lines above the next change, below sticky chrome', () => {
    const f = fixture();
    expect(f.key().preventDefault).toHaveBeenCalledOnce();
    expect(f.container.scrollTop).toBe(540); // 700 - 60 chrome - 5 × 20 context
    expect(f.blocks[0][0].focus).not.toHaveBeenCalled();
    expect(f.blocks[1][0].focus).not.toHaveBeenCalled();
    expect(f.blocks[2][0].focus).toHaveBeenCalledOnce();
    f.key();
    expect(f.container.scrollTop).toBe(540);
  });

  it('includes changes whose final line is only partially visible', () => {
    const f = fixture([change(640, 2)]);
    f.key();
    expect(f.container.scrollTop).toBe(480);
  });

  it('reduces optional padding when a change only just fits on a page', () => {
    const f = fixture([change(500, 28)]);
    f.key();
    expect(f.container.scrollTop).toBe(400); // 560px change + 40px context fills 600px
    f.key();
    expect(f.container.scrollTop).toBe(400);
  });

  it('pages through a long change with ten lines of overlap before going to another file', () => {
    const f = fixture([change(700, 80)]);
    allFileOrder.value = ['f1', 'f2'];
    f.key(); expect(f.container.scrollTop).toBe(540);
    f.key(); expect(f.container.scrollTop).toBe(940);
    f.key(); expect(f.container.scrollTop).toBe(1340);
    f.key(); expect(f.container.scrollTop).toBe(1740);
    expect(selectFile).not.toHaveBeenCalled();
    // The last page exposes the tail; earlier pages need not fit in this viewport.
    f.key(); expect(selectFile).toHaveBeenCalledExactlyOnceWith('f2');
    const focused = f.blocks[0].filter(row => row.focus.mock.calls.length > 0);
    expect(focused.length).toBe(4);
    expect(focused.at(-1)?.getBoundingClientRect().bottom).toBeGreaterThan(160);
  });

  it('starts a partly visible long change with context, then pages through it', () => {
    const f = fixture([change(600, 80)]);
    f.key(); expect(f.container.scrollTop).toBe(440);
    f.key(); expect(f.container.scrollTop).toBe(840);
  });

  it('pages immediately when already reading inside a long change', () => {
    const f = fixture([change(100, 80)]);
    f.key(); expect(f.container.scrollTop).toBe(400);
  });

  it('measures the entire change across uneven split columns and annotation gaps', () => {
    const f = fixture([[[100, 120], [100, 120], [500, 520], [640, 680]]]);
    f.key();
    expect(f.container.scrollTop).toBe(20); // 580px block + 20px context fits 600px
    f.key(); expect(f.container.scrollTop).toBe(20);
  });

  it('pages through a single wrapped line taller than the viewport', () => {
    const f = fixture([[[700, 2300]]]);
    f.key(); expect(f.container.scrollTop).toBe(540);
    f.key(); expect(f.container.scrollTop).toBe(940);
  });

  it('uses rendered line spacing for context and overlap', () => {
    const f = fixture([change(700, 80, 21)]);
    vi.stubGlobal('getComputedStyle', () => ({ lineHeight: '20px', borderTopWidth: '0px', borderBottomWidth: '1px' }));
    f.key(); expect(f.container.scrollTop).toBe(535);
    f.key(); expect(f.container.scrollTop).toBe(925); // 600 - 10 × 21
  });

  it('keeps making progress when the usable page is less than ten lines tall', () => {
    const f = fixture([change(700, 80)], { height: 200 });
    f.key(); expect(f.container.scrollTop).toBe(540);
    f.key(); expect(f.container.scrollTop).toBe(560);
  });

  it('mirrors context and overlapping pages backward through a long change', () => {
    const f = fixture([change(100, 100)]);
    f.container.scrollTop = 2000;
    f.key({ shiftKey: true }); expect(f.container.scrollTop).toBe(1540);
    f.key({ shiftKey: true }); expect(f.container.scrollTop).toBe(1140);
  });

  it('reveals a change hidden under sticky chrome when going backward', () => {
    const f = fixture([change(40), change(200)]);
    f.container.scrollTop = 100;
    f.key({ shiftKey: true });
    expect(f.container.scrollTop).toBe(0);
    expect(f.blocks[1][0].focus).not.toHaveBeenCalled();
  });

  it('uses current geometry after manual scrolling, resizing, and remounting', () => {
    const f = fixture([change(100), change(700), change(1300)]);
    f.key();
    f.container.scrollTop = 800;
    f.container.clientHeight = 400;
    f.render('f1', [change(100), change(700), change(1300)]);
    f.key(); expect(f.container.scrollTop).toBe(1140);
  });

  it.each([{ specs: [] }, { specs: [change(100)] }, { specs: [change(100), change(200)] }])('stays put when no unseen changes or adjacent files remain: %j', ({ specs }) => {
    const f = fixture(specs, { maxScroll: 0 });
    f.key(); f.key({ shiftKey: true });
    expect(f.container.scrollTop).toBe(0);
    expect(selectFile).not.toHaveBeenCalled();
    for (const row of f.blocks.flat()) expect(row.focus).not.toHaveBeenCalled();
  });

  it('does not navigate before a usable viewport is laid out', () => {
    const f = fixture([], { height: 0 });
    allFileOrder.value = ['f1', 'f2'];
    f.key(); expect(selectFile).not.toHaveBeenCalled();
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
  it('waits for the next file and reveals its first change with context without skipping files', () => {
    const f = fixture([change(100)]);
    allFileOrder.value = ['f1', 'f3', 'f2'];
    f.key(); f.key(); f.key();
    expect(selectFile).toHaveBeenCalledExactlyOnceWith('f3');
    f.onRendered('f1');
    const next = f.render('f3', [change(700), change(900)]);
    expect(next[0][0].focus).toHaveBeenCalledOnce();
    expect(f.container.scrollTop).toBe(540);
    f.key(); // The second change is already fully visible on that page.
    expect(next[1][0].focus).not.toHaveBeenCalled();
    expect(selectFile).toHaveBeenLastCalledWith('f2');
  });

  it('enters the previous file at the tail of its last change, then pages backward', () => {
    const f = fixture([change(100)]);
    allFileOrder.value = ['f0', 'f1'];
    f.key({ shiftKey: true });
    expect(selectFile).toHaveBeenCalledExactlyOnceWith('f0');
    f.render('f0', [change(100), change(700, 80)]);
    expect(f.container.scrollTop).toBe(1740);
    f.key({ shiftKey: true }); expect(f.container.scrollTop).toBe(1340);
  });

  it('visits files with no changed blocks and continues on the following Tab', () => {
    const f = fixture([]);
    allFileOrder.value = ['f1', 'f2', 'f3'];
    f.key();
    expect(selectFile).toHaveBeenCalledExactlyOnceWith('f2');
    f.render('f2', []);
    expect(f.container.focus).toHaveBeenCalledOnce();
    expect(selectFile).toHaveBeenCalledTimes(1);
    f.key(); expect(selectFile).toHaveBeenLastCalledWith('f3');
  });

  it('cancels a pending jump when the user selects a different file', () => {
    const f = fixture([change(100)]);
    allFileOrder.value = ['f1', 'f2', 'f3'];
    f.key();
    reviewStore.state.value.currentFileId = 'f3';
    const other = f.render('f3', [change(700)]);
    expect(other[0][0].focus).not.toHaveBeenCalled();
    f.key(); expect(other[0][0].focus).toHaveBeenCalledOnce();
  });

  it('clears a pending jump on load failure and allows later navigation', () => {
    const f = fixture([change(100)]);
    allFileOrder.value = ['f1', 'f2'];
    f.key();
    f.render('f2', null);
    expect(f.key().preventDefault).not.toHaveBeenCalled();
    reviewStore.state.value.currentFileId = 'f1';
    f.render('f1', [change(100)]);
    f.key(); expect(selectFile).toHaveBeenCalledTimes(2);
  });

  it('does not navigate from stale DOM while a manually selected file loads', () => {
    const f = fixture();
    reviewStore.state.value.currentFileId = 'f2';
    f.key();
    expect(f.container.scrollTop).toBe(0);
    expect(selectFile).not.toHaveBeenCalled();
  });

  it.each([{ order: [] }, { order: ['other'] }])('does not choose an unrelated file when filtered out: %j', ({ order }) => {
    const f = fixture([]);
    allFileOrder.value = order;
    f.key(); f.key({ shiftKey: true });
    expect(selectFile).not.toHaveBeenCalled();
  });
});

it('f/g mirror change navigation and completed files can be restored backward', () => {
  const f = fixture([change(100)]);
  allFileOrder.value = ['f1', 'f2'];
  f.key({ key: 'f' });
  expect(selectFile).toHaveBeenLastCalledWith('f2');
  expect(reviewStore.state.value.hiddenFileIds.has('f1')).toBe(true);
  f.render('f2', [change(100)]);
  f.container.scrollTop = 0;
  f.key({ key: 'g' });
  expect(selectFile).toHaveBeenLastCalledWith('f1');
  expect(reviewStore.state.value.hiddenFileIds.has('f1')).toBe(false);
});
it('finishing the last file empties the remaining-file list without deleting traversal history', () => {
  const f = fixture([change(100)]); f.key();
  expect(reviewStore.state.value.hiddenFileIds.has('f1')).toBe(true);
  expect(allFileOrder.value).toEqual(['f1']);
});
