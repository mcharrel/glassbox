import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCommentNavigator } from '../../../src/client/workspace/commentNavigation.js';
import { selectFile } from '../../../src/client/diff/selection.js';
import { allFileOrder, reviewStore } from '../../../src/client/stores/index.js';
import { activeTab } from '../../../src/client/workspace/state.js';
import { showToast } from '../../../src/client/toast.js';

vi.mock('../../../src/client/stores/index.js', () => ({
  reviewStore: { state: { value: {} }, actions: { update: vi.fn() } },
  allFileOrder: { value: [] },
}));
vi.mock('../../../src/client/diff/selection.js', () => ({ selectFile: vi.fn() }));
vi.mock('../../../src/client/workspace/state.js', () => ({ activeTab: vi.fn() }));
vi.mock('../../../src/client/toast.js', () => ({ showToast: vi.fn() }));

type Spec = [number, number, number?];
function fixture(specs: Spec[] = [[100, 180], [200, 280], [700, 780]]) {
  vi.useFakeTimers();
  Object.assign(reviewStore.state.value, {
    currentFileId: 'f1', reviewId: 'review', hiddenFileIds: new Set(['f2']),
    files: [{ id: 'f1', file_path: 'one.ts' }, { id: 'f2', file_path: 'two.ts' }],
  });
  allFileOrder.value = ['f1'];
  const tab = { view: 'file', comments: [] as Record<string, unknown>[] };
  vi.mocked(activeTab).mockReturnValue(tab as never);
  vi.mocked(reviewStore.actions.update).mockImplementation(partial => { Object.assign(reviewStore.state.value, partial); });
  vi.mocked(selectFile).mockReset().mockImplementation(async id => { reviewStore.state.value.currentFileId = id; });
  vi.mocked(showToast).mockClear();
  let scroll = 0;
  const rect = (top: number, bottom: number) => () => ({ top: 100 + top - scroll, bottom: 100 + bottom - scroll });
  const makeThread = ([top, bottom, replies]: Spec) => ({
    getBoundingClientRect: rect(top, bottom),
    nextElementSibling: replies === undefined ? null : {
      classList: { contains: (name: string) => name === 'local-thread-details' },
      getBoundingClientRect: rect(bottom, replies),
    },
  });
  let threads = specs.map(makeThread);
  let rows = Array.from({ length: 200 }, (_, i) => [i * 20, i * 20 + 20])
    .filter(([top, bottom]) => !specs.some(([start, end, replies]) => top < (replies ?? end) && bottom > start))
    .map(([top, bottom]) => ({ getBoundingClientRect: rect(top, bottom) }));
  const view = { dataset: { fileId: 'f1' }, querySelectorAll: (selector: string) => selector === '.diff-line' ? rows : threads };
  const pane = {
    clientHeight: 660, clientTop: 0, focus: vi.fn(),
    getBoundingClientRect: () => ({ top: 100 }),
    querySelector: () => view,
    querySelectorAll: () => [{ getBoundingClientRect: () => ({ bottom: 160 }) }],
    get scrollTop() { return scroll; },
    set scrollTop(value: number) { scroll = Math.max(0, Math.min(5000, value)); },
  };
  let observer: (() => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal('MutationObserver', class {
    constructor(callback: () => void) { observer = callback; }
    observe() {}
    disconnect = disconnect;
  });
  vi.stubGlobal('document', { getElementById: () => pane });
  vi.stubGlobal('getComputedStyle', () => ({ lineHeight: '20px', borderTopWidth: '0px', borderBottomWidth: '0px' }));
  const navigate = createCommentNavigator();
  return {
    pane, tab, view, navigate, disconnect,
    render: (fileId: string, newSpecs: Spec[]) => {
      view.dataset.fileId = fileId;
      threads = newSpecs.map(makeThread);
      observer?.();
    },
    sourceRows: (positions: [number, number][]) => { rows = positions.map(([top, bottom]) => ({ getBoundingClientRect: rect(top, bottom) })); },
    notify: () => observer?.(),
  };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('page-aware comment navigation', () => {
  it('skips every fully visible thread, leaving ten code lines below the sticky header', async () => {
    const f = fixture();
    await f.navigate(1);
    expect(f.pane.scrollTop).toBe(440); // Source row at 500, below 60px of chrome.
    await f.navigate(1);
    expect(f.pane.scrollTop).toBe(440);
    expect(selectFile).not.toHaveBeenCalled();
    expect(f.pane.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('includes a comment whose bottom is only partly visible', async () => {
    const f = fixture([[640, 720]]);
    await f.navigate(1);
    expect(f.pane.scrollTop).toBe(380);
  });

  it('previous skips fully visible comments and also puts source context before the target', async () => {
    const f = fixture([[700, 780], [1000, 1080], [1200, 1280]]);
    f.pane.scrollTop = 800;
    await f.navigate(-1);
    expect(f.pane.scrollTop).toBe(440);
  });

  it('counts comments obscured by the sticky header as partly hidden', async () => {
    const f = fixture([[700, 780]]);
    f.pane.scrollTop = 650;
    await f.navigate(-1);
    expect(f.pane.scrollTop).toBe(440);
  });

  it('counts wrapped source lines once and does not double-count split columns', async () => {
    const f = fixture([[700, 780]]);
    const rows: [number, number][] = Array.from({ length: 9 }, (_, i) => [520 + i * 20, 540 + i * 20]);
    f.sourceRows([[400, 520], [400, 520], ...rows, ...rows]);
    await f.navigate(1);
    expect(f.pane.scrollTop).toBe(340);
  });

  it('uses fresh geometry after manual scrolling and resizing', async () => {
    const f = fixture();
    await f.navigate(1);
    f.pane.scrollTop = 0;
    f.pane.clientHeight = 900;
    await f.navigate(1);
    expect(f.pane.scrollTop).toBe(0); // All threads now fit.
    f.pane.scrollTop = 600;
    await f.navigate(-1);
    expect(f.pane.scrollTop).toBe(0); // Previous hidden thread is at 200, not the stored cursor.
  });

  it('includes replies outside the local root and pages through the unread part', async () => {
    const f = fixture([[700, 780, 1200]]);
    f.pane.scrollTop = 500; // Root visible, final reply below the page.
    await f.navigate(1);
    expect(f.pane.scrollTop).toBe(900);
    await f.navigate(1);
    expect(f.pane.scrollTop).toBe(900);
  });

  it('pages through a long thread with ten-line overlap without bouncing to its start', async () => {
    const f = fixture([[700, 2300]]);
    for (const expected of [440, 840, 1240, 1640, 1640]) {
      await f.navigate(1);
      expect(f.pane.scrollTop).toBe(expected);
    }
    await f.navigate(-1);
    expect(f.pane.scrollTop).toBe(1240);
  });

  it('reduces context in a tiny viewport and still advances', async () => {
    const f = fixture([[700, 2300]]);
    f.pane.clientHeight = 160;
    await f.navigate(1);
    expect(f.pane.scrollTop).toBe(560);
    await f.navigate(1);
    expect(f.pane.scrollTop).toBe(580);
  });

  it('does nothing for no comments, a fully visible single comment, or an unmounted file', async () => {
    for (const specs of [[], [[100, 180]]] as Spec[][]) {
      const f = fixture(specs);
      await f.navigate(1); await f.navigate(-1);
      expect(f.pane.scrollTop).toBe(0);
      expect(selectFile).not.toHaveBeenCalled();
    }
    const f = fixture();
    f.view.dataset.fileId = 'old';
    await f.navigate(1);
    expect(f.pane.scrollTop).toBe(0);
  });

  it.each([1, -1])('waits for the next file, reveals it, and selects the correct edge in direction %s', async direction => {
    const f = fixture([]);
    allFileOrder.value = ['f1', 'f2'];
    f.tab.comments = [{ kind: 'review', path: 'two.ts', line: 0 }];
    const pending = f.navigate(direction);
    await f.navigate(direction);
    expect(selectFile).toHaveBeenCalledExactlyOnceWith('f2');
    expect(f.pane.scrollTop).toBe(0);
    expect(reviewStore.state.value.hiddenFileIds.has('f2')).toBe(false);
    f.render('f2', [[700, 780], [1200, 1280]]);
    await pending;
    expect(f.pane.scrollTop).toBe(direction > 0 ? 440 : 940);
    expect(f.disconnect).toHaveBeenCalled();
    f.notify(); // No late async callback may jump a second time.
    expect(f.pane.scrollTop).toBe(direction > 0 ? 440 : 940);
  });

  it('ignores deleted roots, replies, AI messages, and files outside the review', async () => {
    const f = fixture([]);
    allFileOrder.value = ['f1', 'f2'];
    f.tab.comments = [
      { kind: 'review', path: 'two.ts', deleted: true },
      { kind: 'review', path: 'two.ts', parentId: 123 },
      { kind: 'ai', path: 'two.ts' },
      { kind: 'review', path: 'missing.ts' },
    ];
    await f.navigate(1);
    expect(selectFile).not.toHaveBeenCalled();
  });

  it('abandons pending scrolling when the user switches PRs', async () => {
    const f = fixture([]);
    allFileOrder.value = ['f1', 'f2'];
    f.tab.comments = [{ kind: 'review', path: 'two.ts' }];
    const pending = f.navigate(1);
    reviewStore.state.value.reviewId = 'another';
    f.render('f2', [[700, 780]]);
    await pending;
    expect(f.pane.scrollTop).toBe(0);
    expect(f.disconnect).toHaveBeenCalled();
  });

  it('releases the pending request after a failed load so navigation can be retried', async () => {
    const f = fixture([]);
    allFileOrder.value = ['f1', 'f2'];
    f.tab.comments = [{ kind: 'review', path: 'two.ts' }];
    const pending = f.navigate(1);
    await vi.advanceTimersByTimeAsync(10000);
    await pending;
    expect(showToast).toHaveBeenCalledOnce();
    expect(f.disconnect).toHaveBeenCalled();
    f.render('f2', [[700, 780]]);
    await f.navigate(1);
    expect(f.pane.scrollTop).toBe(440);
  });
});
