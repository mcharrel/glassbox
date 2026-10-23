import { Hono } from 'hono';
import { beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';
import type { AppEnv } from '../../../src/types.js';
import type { WorkspaceDisk } from '../../../src/workspace/storage.js';
import { pullInfo } from '../../unit/workspace/fixtures.js';
const mocks = vi.hoisted(() => ({
  data: { tabs: [], archived: [], active: null, outbox: [] } as WorkspaceDisk,
  github: vi.fn(), load: vi.fn(), slack: vi.fn(), save: vi.fn(), deployment: vi.fn(),
}));
vi.mock('../../../src/workspace/accounts.js', () => ({ githubAccount: () => '', localWorkspaceConfig: () => ({ accounts: {}, slack: {}, repositories: {} }) }));
vi.mock('../../../src/workspace/storage.js', () => ({ workspaceData: () => mocks.data, saveWorkspace: mocks.save }));
vi.mock('../../../src/workspace/slack-reactions.js', () => ({ queueSlackReaction: mocks.slack, cancelSlackReaction: vi.fn(), cancelSlackReactions: vi.fn(), recoverSlackReactions: vi.fn(), retrySlackReaction: vi.fn(), stopSlackReactions: vi.fn() }));
vi.mock('../../../src/workspace/checkout.js', () => ({ importPull: vi.fn(), ensureCheckout: vi.fn() }));
vi.mock('../../../src/workspace/deployments.js', () => ({ refreshDeployment: mocks.deployment, cancelDeployment: vi.fn(), stopDeployments: vi.fn() }));
vi.mock('../../../src/workspace/notifications.js', () => ({ notify: vi.fn(), hasCodeFocus: vi.fn() }));
vi.mock('../../../src/workspace/github.js', async original => ({
  ...await original<typeof import('../../../src/workspace/github.js')>(),
  github: mocks.github, loadPull: mocks.load, loadComments: vi.fn().mockResolvedValue([]),
}));
import { workspaceRoutes } from '../../../src/workspace/routes.js';
import { syncTab } from '../../../src/workspace/service.js';
const head = 'a'.repeat(40);
const info = () => ({ ...pullInfo('alice'), state: 'OPEN', isDraft: false, headRefOid: head, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' });
const app = new Hono<AppEnv>().use('*', async (c, next) => { c.set('reviewId', 'review'); await next(); }).route('/workspace', workspaceRoutes);
const request = (body: unknown) => app.request('/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.data.tabs = [PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: '' },
    viewer: 'alice', info: info(), reviewedHead: head, reviewId: 'review', repoRoot: '/synthetic' })];
  mocks.data.active = mocks.data.tabs[0].key; mocks.data.outbox = [];
  mocks.load.mockReset().mockImplementation(async () => info());
  mocks.github.mockReset().mockImplementation(async (_ref, path, method) => method === 'PUT' ? { merged: true, message: 'Merged' }
    : path === 'user' ? { login: 'alice' } : { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true });
});
it('merges through the workspace API, persists the receipt and resists an older in-flight snapshot', async () => {
  const tab = mocks.data.tabs[0];
  let finish!: (value: ReturnType<typeof info>) => void;
  mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const oldRefresh = syncTab(tab, 'background');
  const response = await request({ op: 'merge', key: tab.key, expectedHead: head });
  expect(response.status).toBe(200);
  expect((await response.json()).tabs[0].info.state).toBe('MERGED');
  finish(info()); await oldRefresh;
  expect(tab.info?.state).toBe('MERGED'); expect(tab.info?.mergedAt).toBeTruthy();
  expect(mocks.save).toHaveBeenCalled(); expect(mocks.deployment).toHaveBeenCalled();
  expect(mocks.slack).not.toHaveBeenCalled();
  expect(mocks.github).toHaveBeenCalledWith(tab.ref, 'repos/example/project/pulls/1/merge', 'PUT', { sha: head, merge_method: 'merge' });
});
it('returns a merge refusal without changing the confirmed state or triggering review reactions', async () => {
  const tab = mocks.data.tabs[0];
  mocks.github.mockImplementation(async (_ref, path, method) => {
    if (method === 'PUT') throw new Error('GitHub 405: Required review missing');
    return path === 'user' ? { login: 'alice' } : { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true };
  });
  const response = await request({ op: 'merge', key: tab.key, expectedHead: head });
  expect(response.status).toBe(400); expect((await response.json()).error).toContain('Required review missing');
  expect(tab.info?.state).toBe('OPEN'); expect(mocks.slack).not.toHaveBeenCalled();
});
it('rejects malformed merge requests before any GitHub access', async () => {
  const response = await request({ op: 'merge', key: mocks.data.tabs[0].key });
  expect(response.status).toBe(400); expect(mocks.github).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
});
