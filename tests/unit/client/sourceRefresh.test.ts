import { afterEach, expect, it, vi } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';
const mocks = vi.hoisted(() => ({ tab: undefined as any, report: vi.fn().mockResolvedValue({ ok: true }) }));
vi.mock('../../../src/api/workspace.js', async original => ({ ...await original<typeof import('../../../src/api/workspace.js')>(), reportVisibility: mocks.report }));
import { pullInfo } from '../workspace/fixtures.js';
vi.mock('../../../src/client/diff/index.js', () => ({ invalidateDiffCache: vi.fn() }));
vi.mock('../../../src/client/sidebar/fileTree.js', () => ({ loadFiles: vi.fn() }));
vi.mock('../../../src/client/workspace/state.js', () => ({ activeTab: () => mocks.tab, addingPull: { value: false } }));
import { codeFocusTab, initSourceRefresh, sourceRefreshButton } from '../../../src/client/workspace/sourceRefresh.js';
const tab = () => PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: '' },
  reviewId: 'review', repoRoot: '/checkout', info: pullInfo(), view: 'file', reviewedHead: 'previous',
  sourceRefreshRequested: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
it('protects the selected code view only while the app is focused', () => {
  const t = tab();
  expect(codeFocusTab(t, true, false)).toBe(t.key);
  expect(codeFocusTab(t, false, false)).toBeNull();
  expect(codeFocusTab(t, true, true)).toBeNull();
  expect(codeFocusTab({ ...t, view: 'main' }, true, false)).toBeNull();
  expect(codeFocusTab(undefined, true, false)).toBeNull();
});
it('shows the refresh action only for pending code updates', () => {
  const t = tab();
  expect(String(sourceRefreshButton(t))).toContain('data-workspace="refresh"');
  expect(String(sourceRefreshButton(t))).toContain('>Refresh</button>');
  expect(sourceRefreshButton({ ...t, view: 'main' })).toBeNull();
  expect(sourceRefreshButton({ ...t, sourceRefreshRequested: undefined })).toBeNull();
  expect(sourceRefreshButton({ ...t, reviewedHead: t.info!.headRefOid })).toBeNull();
  expect(sourceRefreshButton({ ...t, info: null })).toBeNull();
  expect(sourceRefreshButton()).toBeNull();
});

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('reports focus changes and protects a draft on blur, then releases it after submission', async () => {
  vi.useFakeTimers(); mocks.tab = tab(); mocks.report.mockClear();
  let focused = true, draft = '';
  const page = Object.assign(new EventTarget(), {
    body: new EventTarget(), visibilityState: 'visible', hasFocus: () => focused,
    getElementById: () => null, createElement: () => ({ matches: () => false }),
    querySelectorAll: () => [{ value: draft, disabled: false }],
  });
  const window = new EventTarget(); vi.stubGlobal('document', page); vi.stubGlobal('window', window);
  initSourceRefresh();
  expect(mocks.report).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, codeTab: mocks.tab.key, draftTab: null }));
  focused = false; window.dispatchEvent(new Event('blur'));
  expect(mocks.report).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false, codeTab: null, draftTab: null }));
  draft = 'Unfinished'; focused = true; window.dispatchEvent(new Event('focus'));
  focused = false; window.dispatchEvent(new Event('blur'));
  expect(mocks.report).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false, draftTab: mocks.tab.key }));
  draft = ''; await vi.advanceTimersByTimeAsync(10000);
  expect(mocks.report).toHaveBeenLastCalledWith(expect.objectContaining({ visible: false, draftTab: null }));
  mocks.tab.view = 'main'; focused = true; window.dispatchEvent(new Event('focus'));
  expect(mocks.report).toHaveBeenLastCalledWith(expect.objectContaining({ visible: true, codeTab: null }));
});
