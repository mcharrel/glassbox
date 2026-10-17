import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';
const remote = vi.hoisted(() => ({ get: vi.fn(), change: vi.fn() }));
vi.mock('../../../src/api/workspace.js', async original => ({ ...(await original<typeof import('../../../src/api/workspace.js')>()), getWorkspace: remote.get, changeWorkspace: remote.change }));
vi.mock('../../../src/client/toast.js', () => ({ showToast: vi.fn() }));
const { workspace, mutate, refreshWorkspace, addingPull } = await import('../../../src/client/workspace/state.js');
const tab = (key: string) => PullTabSchema.parse({ key, reviewId: key, repoRoot: '/', info: null, ref: { owner: 'a', repo: 'b', number: 1, url: '' } });
beforeEach(() => {
  vi.stubGlobal('document', { querySelector: () => null, querySelectorAll: () => [] });
  workspace.value = { tabs: [tab('a'), tab('b')], active: 'a' }; remote.get.mockReset(); remote.change.mockReset();
});
afterEach(() => vi.unstubAllGlobals());
it('does not let a stale select response undo a newer local tab selection', async () => {
  let finish!: (value: typeof workspace.value) => void;
  remote.change.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = structuredClone(workspace.value);
  const first = mutate({ op: 'select', key: 'a' });
  workspace.value = { ...workspace.value, active: 'b' };
  remote.change.mockResolvedValueOnce(workspace.value);
  await mutate({ op: 'select', key: 'b' });
  finish(old); await first;
  expect(workspace.value.active).toBe('b');
});
it('background refresh updates metadata without resetting the local selection or remembered view', async () => {
  const server = structuredClone(workspace.value);
  workspace.value = { ...workspace.value, active: 'b', tabs: workspace.value.tabs.map(t => ({ ...t, view: 'file' })) };
  server.tabs[1].updatedAt = 123;
  remote.get.mockResolvedValue(server);
  await refreshWorkspace();
  expect(workspace.value.active).toBe('b');
  expect(workspace.value.tabs[1].view).toBe('file');
  expect(workspace.value.tabs[1].updatedAt).toBe(123);
});
it('opening a new PR and closing the active PR still accept the resulting selection', async () => {
  remote.change.mockResolvedValueOnce({ tabs: [...workspace.value.tabs, tab('c')], active: 'c' });
  await mutate({ op: 'open', url: 'https://github.com/a/b/pull/1' });
  expect(workspace.value.active).toBe('c');
  remote.change.mockResolvedValueOnce({ tabs: workspace.value.tabs.filter(t => t.key !== 'c'), active: 'a' });
  await mutate({ op: 'close', key: 'c' });
  expect(workspace.value.active).toBe('a');
});
it('selects a PR opened externally without losing the stored view', async () => {
  const state = { ...structuredClone(workspace.value), active: 'b', externalSelection: 1 };
  addingPull.value = true;
  remote.get.mockResolvedValue(state);
  await refreshWorkspace(); expect(workspace.value.active).toBe('b'); expect(addingPull.value).toBe(false);
  workspace.value = { ...workspace.value, active: 'a' };
  await refreshWorkspace(); expect(workspace.value.active).toBe('a');
});
