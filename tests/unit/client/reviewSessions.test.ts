import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';

const api = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api/_runner.js', () => ({ apiCall: api, OkResponseSchema: {} }));
vi.mock('../../../src/client/analysisEngine.js', () => ({ stopPolling: vi.fn() }));
vi.mock('../../../src/client/diff/index.js', () => ({ invalidateDiffCache: vi.fn() }));
vi.mock('../../../src/client/toast.js', () => ({ showToast: vi.fn() }));
vi.stubGlobal('document', { body: { dataset: { reviewId: 'a' } } });
const { reviewStore, aiStore, editFormSignal } = await import('../../../src/client/stores/index.js');
const { workspace, reviewLoadState, reviewRetry, activeReviewReady } = await import('../../../src/client/workspace/state.js');
const { initReviewSessions } = await import('../../../src/client/workspace/reviewSessions.js');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const file = (id: string) => ({ id, file_path: `${id}.ts`, review_id: id[0], status: 'reviewed', diff_data: null, created_at: '' });
const tab = (id: string) => PullTabSchema.parse({ key: id, reviewId: id, reviewedHead: id,
  ref: { owner: 'example', repo: 'repo', number: id === 'a' ? 1 : 2, url: '' }, repoRoot: '/test', info: null, view: 'file' });
let dispose: (() => void) | undefined;
let scroll: { scrollTop: number; value: string };
beforeEach(() => {
  reviewLoadState.value = { key: '', status: 'loading', error: null };
  scroll = { scrollTop: 0, value: '' };
  vi.stubGlobal('document', { body: { dataset: { reviewId: 'a' } }, querySelector: () => scroll, dispatchEvent: vi.fn() });
  vi.stubGlobal('window', { history: { replaceState: vi.fn() } });
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null) });
  reviewStore.actions.update({ reviewId: 'a', files: [file('a1'), file('a2')], currentFileId: 'a1', hiddenFileIds: new Set() });
  aiStore.actions.update({ fileNotes: { a1: { overview: '', lines: [{ line: 3, content: 'Guide A' }] } }, guidedNotes: {}, narrativeOrder: null });
  editFormSignal.value = null;
  workspace.value = { tabs: [tab('a'), tab('b')], active: 'a' };
  api.mockReset().mockImplementation(async (_schema, path, options) => path === '/files'
    ? { files: [file(options.reviewId + '1')], annotationCounts: {}, staleCounts: {} }
    : { scores: [{ reviewFileId: options.reviewId + '1', filePath: `${options.reviewId}1.ts`, sortOrder: 0, notes: { overview: '', lines: [{ line: 5, content: `Guide ${options.reviewId}` }] } }] });
});
afterEach(() => { dispose?.(); vi.unstubAllGlobals(); });

describe('in-memory PR sessions', () => {
  it('preloads once and restores files, guidance, hidden files, drafts and section scroll without fetching again', async () => {
    dispose = initReviewSessions(); await tick();
    expect(api).toHaveBeenCalledTimes(3);
    reviewStore.actions.update({ currentFileId: 'a2', hiddenFileIds: new Set(['a1']) });
    editFormSignal.value = { annotationId: null, formKey: '3:new', content: 'Draft A', category: 'bug' };
    scroll.scrollTop = 82; scroll.value = 'PR draft A';
    workspace.value = { ...workspace.value, active: 'b' }; await tick();
    expect(reviewStore.state.value.reviewId).toBe('b');
    expect(reviewStore.state.value.currentFileId).toBe('b1');
    expect(aiStore.state.value.fileNotes.b1.lines[0].content).toBe('Guide b');
    expect(editFormSignal.value).toBeNull();
    scroll.scrollTop = 26; scroll.value = 'PR draft B';
    workspace.value = { ...workspace.value, active: 'a' }; await tick();
    expect(reviewStore.state.value.currentFileId).toBe('a2');
    expect([...reviewStore.state.value.hiddenFileIds]).toEqual(['a1']);
    expect(aiStore.state.value.fileNotes.a1.lines[0].content).toBe('Guide A');
    expect(editFormSignal.value?.content).toBe('Draft A');
    expect(scroll).toEqual({ scrollTop: 82, value: 'PR draft A' });
    workspace.value = { ...workspace.value, active: 'b' }; await tick();
    expect(scroll).toEqual({ scrollTop: 26, value: 'PR draft B' });
    expect(api).toHaveBeenCalledTimes(3);
    expect(window.history.replaceState).toHaveBeenLastCalledWith(null, '', '/?reviewId=b');
  });

  it('keeps late background results in the right PR after switching away and back', async () => {
    const replies: (() => void)[] = [];
    api.mockImplementation((_schema, path) => new Promise(resolve => replies.push(() => resolve(path === '/files'
      ? { files: [file('b1')], annotationCounts: {}, staleCounts: {} }
      : { scores: [] }))));
    dispose = initReviewSessions(); await tick();
    workspace.value = { ...workspace.value, active: 'b' }; await tick();
    expect(reviewStore.state.value.files).toEqual([]);
    workspace.value = { ...workspace.value, active: 'a' }; await tick();
    replies.forEach(resolve => resolve()); await tick();
    expect(reviewStore.state.value.files.map(file => file.id)).toEqual(['a1', 'a2']);
    workspace.value = { ...workspace.value, active: 'b' }; await tick();
    expect(reviewStore.state.value.files.map(file => file.id)).toEqual(['b1']);
    expect(api).toHaveBeenCalledTimes(3);
  });

  it('clears the old PR while importing, preserves its draft, and waits for the new files', async () => {
    const pending = { ...tab('c'), reviewId: null, loading: true };
    const replies: (() => void)[] = [];
    dispose = initReviewSessions(); await tick();
    reviewStore.actions.update({ currentFileId: 'a2' });
    editFormSignal.value = { annotationId: null, formKey: '3:new', content: 'Keep this draft', category: 'bug' };
    workspace.value = { tabs: [...workspace.value.tabs, pending], active: pending.key };
    expect(activeReviewReady()).toBe(false); // Must gate the UI before the session microtask.
    await tick();
    expect(reviewStore.state.value.reviewId).toBe('');
    expect(document.body.dataset.reviewId).toBe('');
    expect(reviewStore.state.value.files).toEqual([]);
    expect(reviewStore.state.value.currentFileId).toBeNull();
    expect(editFormSignal.value).toBeNull();
    expect(aiStore.state.value.fileNotes).toEqual({});
    expect(api).toHaveBeenCalledTimes(3); // Never fetch the default review for a null ID.
    workspace.value = { ...workspace.value, active: 'a' }; await tick();
    expect(reviewStore.state.value.currentFileId).toBe('a2');
    expect(editFormSignal.value?.content).toBe('Keep this draft');
    workspace.value = { ...workspace.value, active: 'c' }; await tick();
    api.mockImplementation((_schema, path) => new Promise(resolve => replies.push(() => resolve(path === '/files'
      ? { files: [file('c1')], annotationCounts: {}, staleCounts: {} } : { scores: [] }))));
    workspace.value = { ...workspace.value, tabs: workspace.value.tabs.map(t => t.key === 'c' ? tab('c') : t) }; await tick();
    expect(activeReviewReady()).toBe(false);
    expect(reviewStore.state.value.files).toEqual([]);
    replies.forEach(resolve => resolve()); await tick();
    expect(activeReviewReady()).toBe(true);
    expect(reviewStore.state.value.files.map(file => file.id)).toEqual(['c1']);
  });

  it('keeps empty reviews empty and offers a retry after a failed file list', async () => {
    api.mockRejectedValue(new Error('Offline'));
    dispose = initReviewSessions(); await tick();
    workspace.value = { ...workspace.value, active: 'b' }; await tick();
    expect(activeReviewReady()).toBe(false);
    expect(reviewLoadState.value.status).toBe('error');
    expect(reviewStore.state.value.files).toEqual([]);
    api.mockImplementation(async (_schema, path) => path === '/files'
      ? { files: [], annotationCounts: {}, staleCounts: {} } : { scores: [] });
    reviewRetry.value++; await tick();
    expect(activeReviewReady()).toBe(true);
    expect(reviewStore.state.value.currentFileId).toBeNull();
    expect(reviewStore.state.value.files).toEqual([]);
  });

  it('keeps different importing PRs separate and ignores background results while they load', async () => {
    const replies: (() => void)[] = [];
    api.mockImplementation((_schema, path) => new Promise(resolve => replies.push(() => resolve(path === '/files'
      ? { files: [file('b1')], annotationCounts: {}, staleCounts: {} } : { scores: [] }))));
    dispose = initReviewSessions(); await tick();
    const pending = ['c', 'd'].map(id => ({ ...tab(id), reviewId: null }));
    workspace.value = { tabs: [...workspace.value.tabs, ...pending], active: 'c' }; await tick();
    const firstKey = reviewLoadState.value.key;
    workspace.value = { ...workspace.value, active: 'd' }; await tick();
    expect(reviewLoadState.value.key).not.toBe(firstKey);
    replies.forEach(resolve => resolve()); await tick();
    expect(reviewStore.state.value.files).toEqual([]);
    expect(activeReviewReady()).toBe(false);
    workspace.value = { ...workspace.value, active: 'b' }; await tick();
    expect(reviewStore.state.value.files.map(file => file.id)).toEqual(['b1']);
    expect(activeReviewReady()).toBe(true);
  });

  it('reloads changed revisions but not ordinary background workspace updates', async () => {
    dispose = initReviewSessions(); await tick();
    workspace.value = { ...workspace.value }; await tick();
    expect(api).toHaveBeenCalledTimes(3);
    workspace.value = { ...workspace.value, tabs: workspace.value.tabs.map(t => t.key === 'b' ? { ...t, reviewedHead: 'new-head' } : t) };
    await tick();
    expect(api).toHaveBeenCalledTimes(6);
  });

  it('does not replace a typed draft while the first load completes', async () => {
    const replies: (() => void)[] = [];
    api.mockImplementation((_schema, path) => new Promise(resolve => replies.push(() => resolve(path === '/files'
      ? { files: [file('b1')], annotationCounts: {}, staleCounts: {} } : { scores: [] }))));
    dispose = initReviewSessions(); await tick();
    workspace.value = { ...workspace.value, active: 'b' }; await tick();
    scroll.value = 'Typing while loading'; scroll.scrollTop = 50;
    replies.forEach(resolve => resolve()); await tick();
    expect(scroll).toEqual({ value: 'Typing while loading', scrollTop: 50 });
  });
});
