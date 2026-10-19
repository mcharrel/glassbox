import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema, type PullTab } from '../../../src/api/workspace.js';
import { pullInfo } from './fixtures.js';
const mocks = vi.hoisted(() => ({ exec: vi.fn(), save: vi.fn(), data: { tabs: [] as PullTab[] } }));
vi.mock('node:child_process', () => ({ execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: mocks.exec }) }));
vi.mock('../../../src/workspace/storage.js', () => ({ workspaceData: () => mocks.data, saveWorkspace: mocks.save }));
import { cancelDeployment, refreshDeployment, stopDeployments } from '../../../src/workspace/deployments.js';
const output = '**api**\n| DATACENTER | ENV | NAMESPACE | DEPLOYED |\n| east.example | prod | app | ✅ (deployed) |';
function tab(number = 1): PullTab {
  return PullTabSchema.parse({ key: `ddoghq/example#${number}`, ref: { owner: 'ddoghq', repo: 'example', number, url: 'https://github.com/ddoghq/example/pull/1' },
    reviewId: 'review', repoRoot: null, info: { ...pullInfo(), state: 'MERGED' } });
}
beforeEach(() => { vi.restoreAllMocks(); mocks.exec.mockReset().mockResolvedValue({ stdout: output }); mocks.save.mockClear(); mocks.data.tabs = [tab()]; });
afterEach(() => stopDeployments());
it('refreshes, caches for five minutes and lets explicit refresh bypass the cache', async () => {
  let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  const t = mocks.data.tabs[0];
  await refreshDeployment(t);
  expect(t.deployment).toMatchObject({ status: 'ready', updatedAt: 1000, targets: [{ status: 'reached' }] });
  now += 299999; await refreshDeployment(t); expect(mocks.exec).toHaveBeenCalledTimes(1);
  now++; await refreshDeployment(t); expect(mocks.exec).toHaveBeenCalledTimes(2);
  await refreshDeployment(t, true); expect(mocks.exec).toHaveBeenCalledTimes(3);
  expect(mocks.exec.mock.calls[0][1]).toEqual(['devflow', '--no-interactive', 'whereismycode', '--pr', t.ref.url]);
});
it('looks up suggested services in one additional read-only command', async () => {
  mocks.exec.mockResolvedValueOnce({ stdout: 'Here is the list of all impacted services detected:\n- api\n- worker' });
  await refreshDeployment(mocks.data.tabs[0]);
  expect(mocks.exec).toHaveBeenCalledTimes(2);
  expect(mocks.exec.mock.calls[1][1].slice(-4)).toEqual(['--service', 'api', '--service', 'worker']);
});
it('coalesces requests and serializes queries across tabs', async () => {
  let finish!: (value: { stdout: string }) => void;
  mocks.exec.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const t = mocks.data.tabs[0]; const second = tab(2); mocks.data.tabs.push(second);
  const first = refreshDeployment(t); expect(refreshDeployment(t, true)).toBe(first);
  const other = refreshDeployment(second);
  await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledTimes(1));
  finish({ stdout: output }); await Promise.all([first, other]);
  expect(mocks.exec).toHaveBeenCalledTimes(2);
});
it('keeps cached rows after failure without persisting command output', async () => {
  const t = mocks.data.tabs[0]; await refreshDeployment(t);
  mocks.exec.mockRejectedValueOnce(new Error('secret authentication url'));
  await refreshDeployment(t, true);
  expect(t.deployment?.targets).toHaveLength(1); expect(t.deployment?.status).toBe('error');
  expect(JSON.stringify(t)).not.toContain('secret');
  mocks.exec.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  await refreshDeployment(t, true); expect(t.deployment?.message).toContain('Install ddr');
  mocks.exec.mockResolvedValueOnce({ stdout: '**api**\nNot found' });
  await refreshDeployment(t, true); expect(t.deployment).toMatchObject({ status: 'ready', targets: [] });
});
it('ignores late replies after close, including reopening the same PR as a fresh tab', async () => {
  let finish!: (value: { stdout: string }) => void;
  mocks.exec.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = mocks.data.tabs[0]; const request = refreshDeployment(old);
  await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledTimes(1));
  cancelDeployment(old); expect(mocks.exec.mock.calls[0][2].signal.aborted).toBe(true);
  const fresh = tab(); mocks.data.tabs = [fresh]; mocks.save.mockClear();
  finish({ stdout: output }); await request;
  expect(fresh.deployment).toBeUndefined(); expect(mocks.save).not.toHaveBeenCalled();
  await refreshDeployment(fresh); expect(fresh.deployment?.status).toBe('ready');
});
it('never queries open PRs or unrelated organisations', async () => {
  const t = mocks.data.tabs[0]; t.info!.state = 'OPEN'; await refreshDeployment(t);
  expect(t.deployment).toBeUndefined();
  t.info!.state = 'MERGED'; t.ref.owner = 'example'; await refreshDeployment(t);
  expect(t.deployment?.status).toBe('unavailable'); expect(mocks.exec).not.toHaveBeenCalled();
});

it('does not skip the next scheduled refresh because the previous command took time', async () => {
  let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  mocks.exec.mockImplementationOnce(async () => { now += 10000; return { stdout: output }; });
  const t = mocks.data.tabs[0]; await refreshDeployment(t);
  expect(t.deployment).toMatchObject({ attemptedAt: 1000, updatedAt: 11000 });
  now = 301000; await refreshDeployment(t); expect(mocks.exec).toHaveBeenCalledTimes(2);
});
