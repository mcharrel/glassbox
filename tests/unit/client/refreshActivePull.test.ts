import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema, type Workspace } from '../../../src/api/workspace.js';
const mocks = vi.hoisted(() => ({ change: vi.fn(), get: vi.fn(), files: vi.fn(), invalidate: vi.fn() }));
vi.mock('../../../src/api/workspace.js', async original => ({ ...await original<typeof import('../../../src/api/workspace.js')>(), changeWorkspace: mocks.change, getWorkspace: mocks.get }));
vi.mock('../../../src/client/diff/index.js', () => ({ invalidateDiffCache: mocks.invalidate }));
vi.mock('../../../src/client/sidebar/fileTree.js', () => ({ loadFiles: mocks.files }));
vi.mock('../../../src/client/toast.js', () => ({ showToast: vi.fn() }));
import { refreshActivePull } from '../../../src/client/workspace/sourceRefresh.js';
import { activeTab, refreshingPulls, refreshWorkspace, reviewLoadState, reviewSessionKey, workspace } from '../../../src/client/workspace/state.js';
import { pullHeader } from '../../../src/client/workspace/header.js';

const tab = (key: string) => PullTabSchema.parse({ key, reviewId: key, repoRoot: '/', info: null, ref: { owner: 'example', repo: 'project', number: 1, url: '' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('document', { querySelector: () => null, querySelectorAll: () => [] });
  workspace.value = { tabs: [tab('a'), tab('b')], active: 'a' };
  refreshingPulls.value = new Set();
  reviewLoadState.value = { key: reviewSessionKey(activeTab()!), status: 'ready', error: null };
});
afterEach(() => vi.unstubAllGlobals());

it('starts immediately, survives polling and lasts through file loading without duplicate requests', async () => {
  const request = deferred<Workspace>(), files = deferred<void>();
  mocks.change.mockReturnValueOnce(request.promise); mocks.files.mockReturnValueOnce(files.promise);
  const work = refreshActivePull();
  expect(refreshingPulls.value.has('a')).toBe(true);
  await refreshActivePull(); expect(mocks.change).toHaveBeenCalledOnce();
  mocks.get.mockResolvedValueOnce(structuredClone(workspace.value));
  await refreshWorkspace();
  expect(activeTab()!.loading).toBe(false);
  expect(String(pullHeader(activeTab()!, null, refreshingPulls.value.has('a')))).toContain('aria-label="Refreshing PR"');
  request.resolve(structuredClone(workspace.value));
  await vi.waitFor(() => expect(mocks.files).toHaveBeenCalledOnce());
  expect(refreshingPulls.value.has('a')).toBe(true);
  files.resolve(); await work;
  expect(refreshingPulls.value.size).toBe(0);
  expect(mocks.invalidate).toHaveBeenCalledOnce();
});
it('clears progress after request errors and file-load errors so retry remains possible', async () => {
  mocks.change.mockRejectedValueOnce(new Error('offline'));
  await refreshActivePull();
  expect(refreshingPulls.value.size).toBe(0);
  mocks.change.mockResolvedValue(structuredClone(workspace.value)); mocks.files.mockRejectedValueOnce(new Error('files failed'));
  await expect(refreshActivePull()).rejects.toThrow('files failed');
  expect(refreshingPulls.value.size).toBe(0);
  await refreshActivePull();
  expect(mocks.change).toHaveBeenCalledTimes(3);
  expect(activeTab()!.loading).toBe(false);
});
it('keeps concurrent PR progress separate when switching tabs', async () => {
  const a = deferred<Workspace>(), b = deferred<Workspace>();
  mocks.change.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
  const first = refreshActivePull();
  workspace.value = { ...workspace.value, active: 'b' };
  expect(refreshingPulls.value.has(activeTab()!.key)).toBe(false);
  const second = refreshActivePull();
  expect([...refreshingPulls.value]).toEqual(['a', 'b']);
  a.resolve(structuredClone(workspace.value)); await first;
  expect([...refreshingPulls.value]).toEqual(['b']);
  expect(mocks.files).not.toHaveBeenCalled();
  b.resolve(structuredClone(workspace.value)); await second;
  expect(refreshingPulls.value.size).toBe(0);
});
