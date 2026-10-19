import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompanyDeploymentsSchema } from '../../../src/api/company-deployments.js';
import { PullTabSchema, type PullTab } from '../../../src/api/workspace.js';
import { pullInfo } from './fixtures.js';
const mocks = vi.hoisted(() => ({ exec: vi.fn(), save: vi.fn(), data: { tabs: [] as PullTab[] }, settings: {} as Record<string, unknown> }));
vi.mock('../../../src/workspace/deployment-source.js', () => ({ runDeploymentSource: mocks.exec }));
vi.mock('../../../src/workspace/deployment-settings.js', () => ({ deploymentSettings: () => mocks.settings }));
vi.mock('../../../src/workspace/storage.js', () => ({ workspaceData: () => mocks.data, saveWorkspace: mocks.save }));
import { cancelDeployment, refreshDeployment, resetDeployments, stopDeployments } from '../../../src/workspace/deployments.js';
const output = '**api**\n| DATACENTER | ENV | NAMESPACE | DEPLOYED |\n| east.example | prod | app | ✅ (deployed) |';
function tab(number = 1): PullTab {
  return PullTabSchema.parse({ key: `example-org/example#${number}`, ref: { owner: 'example-org', repo: 'example', number, url: 'https://github.com/example-org/example/pull/1' },
    reviewId: 'review', repoRoot: null, info: { ...pullInfo(), state: 'MERGED' } });
}
beforeEach(() => { vi.restoreAllMocks(); mocks.exec.mockReset().mockResolvedValue(output); mocks.save.mockClear(); mocks.data.tabs = [tab()]; mocks.settings = CompanyDeploymentsSchema.parse({ enabled: true, organizations: ['example-org'], command: 'deployment-status' }); });
afterEach(() => stopDeployments());
it('refreshes, caches for five minutes and lets explicit refresh bypass the cache', async () => {
  let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
  const t = mocks.data.tabs[0];
  await refreshDeployment(t);
  expect(t.deployment).toMatchObject({ status: 'ready', updatedAt: 1000, targets: [{ status: 'reached' }] });
  now += 299999; await refreshDeployment(t); expect(mocks.exec).toHaveBeenCalledTimes(1);
  now++; await refreshDeployment(t); expect(mocks.exec).toHaveBeenCalledTimes(2);
  await refreshDeployment(t, true); expect(mocks.exec).toHaveBeenCalledTimes(3);
  expect(mocks.exec.mock.calls[0].slice(0, 3)).toEqual([mocks.settings, t.ref, []]);
});
it('looks up suggested services in one additional read-only command', async () => {
  mocks.exec.mockResolvedValueOnce('Here is the list of all impacted services detected:\n- api\n- worker');
  await refreshDeployment(mocks.data.tabs[0]);
  expect(mocks.exec).toHaveBeenCalledTimes(2);
  expect(mocks.exec.mock.calls[1][2]).toEqual(['api', 'worker']);
});
it('coalesces requests and serializes queries across tabs', async () => {
  let finish!: (value: string) => void;
  mocks.exec.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const t = mocks.data.tabs[0]; const second = tab(2); mocks.data.tabs.push(second);
  const first = refreshDeployment(t); expect(refreshDeployment(t, true)).toBe(first);
  const other = refreshDeployment(second);
  await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledTimes(1));
  finish(output); await Promise.all([first, other]);
  expect(mocks.exec).toHaveBeenCalledTimes(2);
});
it('keeps cached rows after failure without persisting command output', async () => {
  const t = mocks.data.tabs[0]; await refreshDeployment(t);
  mocks.exec.mockRejectedValueOnce(new Error('secret authentication url'));
  await refreshDeployment(t, true);
  expect(t.deployment?.targets).toHaveLength(1); expect(t.deployment?.status).toBe('error');
  expect(JSON.stringify(t)).not.toContain('secret');
  mocks.exec.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  await refreshDeployment(t, true); expect(t.deployment?.message).toContain('Check My company');
  mocks.exec.mockResolvedValueOnce('**api**\nNot found');
  await refreshDeployment(t, true); expect(t.deployment).toMatchObject({ status: 'ready', targets: [] });
});
it('ignores late replies after close, including reopening the same PR as a fresh tab', async () => {
  let finish!: (value: string) => void;
  mocks.exec.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = mocks.data.tabs[0]; const request = refreshDeployment(old);
  await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledTimes(1));
  cancelDeployment(old); expect(mocks.exec.mock.calls[0][3].aborted).toBe(true);
  const fresh = tab(); mocks.data.tabs = [fresh]; mocks.save.mockClear();
  finish(output); await request;
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
  mocks.exec.mockImplementationOnce(async () => { now += 10000; return output; });
  const t = mocks.data.tabs[0]; await refreshDeployment(t);
  expect(t.deployment).toMatchObject({ attemptedAt: 1000, updatedAt: 11000 });
  now = 301000; await refreshDeployment(t); expect(mocks.exec).toHaveBeenCalledTimes(2);
});

it('defaults to no company calls and drops cached rows when disabled', async () => {
  const t = mocks.data.tabs[0]; await refreshDeployment(t);
  mocks.settings = CompanyDeploymentsSchema.parse({});
  await refreshDeployment(t, true);
  expect(t.deployment).toMatchObject({ status: 'unavailable', targets: [] });
  expect(mocks.exec).toHaveBeenCalledTimes(1);
});
it('replaces an in-flight provider after saving settings and ignores its late response', async () => {
  let finish!: (value: string) => void;
  mocks.exec.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const t = mocks.data.tabs[0]; const old = refreshDeployment(t);
  await vi.waitFor(() => expect(mocks.exec).toHaveBeenCalledTimes(1));
  mocks.settings = { ...mocks.settings, command: 'different-source' };
  resetDeployments();
  const replacement = refreshDeployment(t);
  finish(output.replace('(deployed)', '(missing)'));
  await old; await replacement;
  expect(t.deployment?.targets[0].status).toBe('reached');
  expect(mocks.exec.mock.calls[1][0].command).toBe('different-source');
});
