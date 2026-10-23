import { beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema, WorkspaceMutationSchema } from '../../../src/api/workspace.js';
import { pullInfo } from './fixtures.js';
const mocks = vi.hoisted(() => ({ github: vi.fn(), load: vi.fn(), account: vi.fn() }));
vi.mock('../../../src/workspace/github.js', () => ({ github: mocks.github, loadPull: mocks.load, repoApi: () => 'repos/example/project' }));
vi.mock('../../../src/workspace/accounts.js', () => ({ githubAccount: mocks.account }));
import { mergePull } from '../../../src/workspace/merge.js';
const head = 'a'.repeat(40);
const settings = { allow_merge_commit: true, allow_squash_merge: true, allow_rebase_merge: true };
const fresh = () => ({ ...pullInfo('alice'), state: 'OPEN', isDraft: false, headRefOid: head, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' });
const tab = () => PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: '' }, viewer: 'alice',
  info: fresh(), reviewedHead: head, reviewId: 'review', repoRoot: '/synthetic' });
beforeEach(() => {
  mocks.account.mockReset().mockReturnValue('alice');
  mocks.load.mockReset().mockResolvedValue(fresh());
  mocks.github.mockReset().mockImplementation(async (_ref, path, method) => method === 'PUT'
    ? { merged: true, message: 'Merged' } : path === 'user' ? { login: 'Alice' } : settings);
});
it.each([
  [settings, 'merge'], [{ ...settings, allow_merge_commit: false }, 'squash'],
  [{ ...settings, allow_merge_commit: false, allow_squash_merge: false }, 'rebase'],
])('uses an allowed repository method with the exact displayed head', async (allowed, method) => {
  mocks.github.mockImplementation(async (_ref, path, verb) => verb === 'PUT' ? { merged: true, message: 'Merged' }
    : path === 'user' ? { login: 'ALICE' } : allowed);
  const t = tab(); await mergePull(t, head);
  expect(mocks.github).toHaveBeenCalledWith(t.ref, 'repos/example/project/pulls/1/merge', 'PUT', { sha: head, merge_method: method });
  expect(t.info?.state).toBe('MERGED'); expect(t.info?.mergedAt).toBeTruthy(); expect(t.action).toBe('merge');
});
it.each(['draft', 'closed', 'merged', 'other', 'unknown-owner', 'unloaded'])('refuses %s before contacting GitHub', async state => {
  const t = tab();
  if (state === 'draft') t.info!.isDraft = true;
  if (state === 'closed') t.info!.state = 'CLOSED';
  if (state === 'merged') t.info!.state = 'MERGED';
  if (state === 'other') t.viewer = 'other';
  if (state === 'unknown-owner') t.viewer = '';
  if (state === 'unloaded') t.info = null;
  await expect(mergePull(t, head)).rejects.toThrow(); expect(mocks.github).not.toHaveBeenCalled();
});
it.each([
  { author: { login: 'other' } }, { state: 'CLOSED' }, { isDraft: true }, { headRefOid: 'b'.repeat(40) },
  { mergeable: 'CONFLICTING' }, { mergeStateStatus: 'BLOCKED' }, { mergeStateStatus: 'BEHIND' }, { mergeStateStatus: 'UNKNOWN' },
])('rechecks fresh ownership, state, commits and readiness: %j', async fields => {
  mocks.load.mockResolvedValue({ ...fresh(), ...fields });
  const t = tab(); await expect(mergePull(t, head)).rejects.toThrow();
  expect(mocks.github.mock.calls.some(call => call[2] === 'PUT')).toBe(false);
  expect(t.info?.state).toBe('OPEN');
});
it('rejects a stale source snapshot, account changes, closed tabs and disabled merge methods', async () => {
  const t = tab(); t.reviewedHead = 'b'.repeat(40);
  await expect(mergePull(t, head)).rejects.toThrow('New commits');
  t.reviewedHead = head;
  mocks.account.mockReturnValueOnce('alice').mockReturnValueOnce('bob');
  await expect(mergePull(t, head)).rejects.toThrow('account changed');
  await expect(mergePull(t, head, () => false)).rejects.toThrow('tab was closed');
  mocks.github.mockImplementation(async (_ref, path) => path === 'user' ? { login: 'alice' }
    : { allow_merge_commit: false, allow_squash_merge: false, allow_rebase_merge: false });
  await expect(mergePull(t, head)).rejects.toThrow('no enabled merge method');
  expect(mocks.github.mock.calls.some(call => call[2] === 'PUT')).toBe(false);
});
it('requires a valid explicit SHA at both the route and merge boundaries', async () => {
  for (const expectedHead of [undefined, '', 'HEAD', 'abc']) {
    expect(WorkspaceMutationSchema.safeParse({ op: 'merge', key: 'example/project#1', expectedHead }).success).toBe(false);
  }
  expect(WorkspaceMutationSchema.safeParse({ op: 'merge', key: 'example/project#1', expectedHead: head }).success).toBe(true);
  await expect(mergePull(tab(), 'HEAD')).rejects.toThrow('Refresh'); expect(mocks.github).not.toHaveBeenCalled();
});
it('keeps the confirmed status on refusal or failure and allows retry', async () => {
  const t = tab();
  mocks.github.mockImplementation(async (_ref, path, method) => method === 'PUT' ? { merged: false, message: 'Required checks pending' }
    : path === 'user' ? { login: 'alice' } : settings);
  await expect(mergePull(t, head)).rejects.toThrow('Required checks pending'); expect(t.info?.state).toBe('OPEN');
  mocks.github.mockImplementation(async (_ref, path, method) => {
    if (method === 'PUT') throw new Error('GitHub 409: Head changed');
    return path === 'user' ? { login: 'alice' } : settings;
  });
  await expect(mergePull(t, head)).rejects.toThrow('Head changed'); expect(t.action).not.toBe('merge');
  mocks.github.mockImplementation(async (_ref, path, method) => method === 'PUT' ? { merged: true, message: 'Merged' }
    : path === 'user' ? { login: 'alice' } : settings);
  await mergePull(t, head); expect(t.info?.state).toBe('MERGED');
});
it('rejects duplicate attempts while a merge is being prepared', async () => {
  let finish!: (value: ReturnType<typeof fresh>) => void;
  mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const t = tab(); const pending = mergePull(t, head);
  await expect(mergePull(t, head)).rejects.toThrow('already in progress');
  finish(fresh()); await pending;
  expect(mocks.github.mock.calls.filter(call => call[2] === 'PUT')).toHaveLength(1);
});


it('recognizes an already completed merge on retry without a second write', async () => {
  const t = tab();
  mocks.load.mockResolvedValue({ ...fresh(), state: 'MERGED', mergedAt: '2026-01-01T12:00:00Z' });
  await mergePull(t, head);
  expect(t.info?.state).toBe('MERGED'); expect(t.info?.mergedAt).toBe('2026-01-01T12:00:00Z');
  expect(mocks.github.mock.calls.some(call => call[2] === 'PUT')).toBe(false);
});
