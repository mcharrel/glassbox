import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';
import { pullInfo } from './fixtures.js';
const mocks = vi.hoisted(() => ({ enabled: false, token: vi.fn(), react: vi.fn(), save: vi.fn(), data: { tabs: [] as any[] } }));
vi.mock('../../../src/workspace/slack-settings.js', () => ({ slackPreferences: () => ({ enabled: mocks.enabled, approvedEmoji: 'stamp-approved', changesEmoji: 'request-changes' }), slackToken: mocks.token }));
vi.mock('../../../src/workspace/slack-api.js', () => ({ reactToPullLinks: mocks.react }));
vi.mock('../../../src/workspace/storage.js', () => ({ workspaceData: () => mocks.data, saveWorkspace: mocks.save }));
import { cancelSlackReaction, cancelSlackReactions, queueSlackReaction, recoverSlackReactions, retrySlackReaction, stopSlackReactions } from '../../../src/workspace/slack-reactions.js';
import { closingTabs } from '../../../src/workspace/lifecycle.js';
const tab = () => mocks.data.tabs[0];
const receipt = { reviewer: 'alice', state: 'APPROVED' };
const tick = () => new Promise(resolve => setImmediate(resolve));
beforeEach(() => {
  mocks.enabled = false;
  mocks.token.mockReset().mockReturnValue('fixture'); mocks.react.mockReset(); mocks.save.mockReset();
  mocks.react.mockImplementation(async (_token, _url, _emoji, _signal, progress) => { progress(2); return 2; });
  mocks.data.tabs = [PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: 'https://github.com/example/project/pull/1' }, reviewId: null, repoRoot: null, viewer: 'alice', info: pullInfo('bob') })];
});
afterEach(() => { cancelSlackReactions(); mocks.data.tabs.forEach(tab => closingTabs.delete(tab)); });
it('makes no credential read or Slack call by default, or for a non-review action', async () => {
  queueSlackReaction(tab(), receipt); await tick();
  expect(mocks.token).not.toHaveBeenCalled(); expect(mocks.react).not.toHaveBeenCalled(); expect(tab().slackReaction).toBeUndefined();
  mocks.enabled = true; queueSlackReaction(tab(), { reviewer: 'alice', state: 'COMMENTED' }); await tick();
  expect(mocks.react).not.toHaveBeenCalled();
});
it.each(['APPROVED', 'CHANGES_REQUESTED'])('queues %s without blocking the accepted review', async state => {
  mocks.enabled = true;
  queueSlackReaction(tab(), { reviewer: 'alice', state });
  expect(tab().slackReaction.status).toBe('pending'); expect(mocks.react).not.toHaveBeenCalled();
  await tick(); await tick();
  expect(mocks.react.mock.calls[0][2]).toBe(state === 'APPROVED' ? 'stamp-approved' : 'request-changes');
  expect(tab().slackReaction).toMatchObject({ status: 'done', count: 2 });
});
it('reports no matches honestly and isolates failures from GitHub state', async () => {
  mocks.enabled = true; mocks.react.mockResolvedValueOnce(0);
  queueSlackReaction(tab(), receipt); await tick(); await tick();
  expect(tab().slackReaction.message).toBe('No matching Slack messages found.');
  tab().info.reviews.push({ author: { login: 'alice' }, state: 'APPROVED', submittedAt: '2026-01-01' });
  mocks.react.mockRejectedValueOnce(new Error('Emoji unavailable'));
  queueSlackReaction(tab(), receipt); await tick(); await tick();
  expect(tab().slackReaction).toMatchObject({ status: 'error', message: 'Emoji unavailable' });
  expect(tab().info.reviews[0].state).toBe('APPROVED');
  retrySlackReaction(tab()); await tick(); await tick();
  expect(tab().slackReaction.status).toBe('done');
});
it('does not retry under another account or after the decision changes', () => {
  mocks.enabled = true;
  tab().slackReaction = { status: 'error', review: 'APPROVED', reviewer: 'other', count: 0 };
  expect(() => retrySlackReaction(tab())).toThrow('account has changed');
  tab().slackReaction.reviewer = 'alice';
  tab().info.reviews.push({ author: { login: 'alice' }, state: 'DISMISSED', submittedAt: '2026-01-01' });
  expect(() => retrySlackReaction(tab())).toThrow('review or GitHub account');
});
it('cancels queued work on close/disable and does not revive deleted tabs', async () => {
  mocks.enabled = true;
  queueSlackReaction(tab(), receipt); cancelSlackReaction(tab()); await tick();
  expect(mocks.react).not.toHaveBeenCalled();
  closingTabs.add(tab()); queueSlackReaction(tab(), receipt); await tick();
  expect(mocks.react).not.toHaveBeenCalled(); mocks.data.tabs.forEach(tab => closingTabs.delete(tab));
  let finish!: Function;
  mocks.react.mockImplementationOnce((_token, _url, _emoji, signal) => new Promise(resolve => { finish = resolve; expect(signal.aborted).toBe(false); }));
  const former = tab(); queueSlackReaction(former, receipt); await tick();
  const signal = mocks.react.mock.calls[0][3];
  cancelSlackReactions(); expect(signal.aborted).toBe(true);
  mocks.data.tabs = []; finish(0); await tick();
  expect(former.slackReaction).toBeUndefined(); expect(mocks.data.tabs).toEqual([]);
});
it('keeps the newer review when a canceled job returns late', async () => {
  mocks.enabled = true;
  let finish!: Function;
  mocks.react.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  queueSlackReaction(tab(), receipt); await tick();
  queueSlackReaction(tab(), { reviewer: 'alice', state: 'CHANGES_REQUESTED' }); await tick(); await tick();
  finish(0); await tick();
  expect(tab().slackReaction).toMatchObject({ status: 'done', review: 'CHANGES_REQUESTED', count: 2 });
});
it('never replays a persisted pending reaction automatically on startup', async () => {
  tab().slackReaction = { status: 'pending', review: 'APPROVED', reviewer: 'alice', count: 1 };
  recoverSlackReactions(); await tick();
  expect(tab().slackReaction.status).toBe('error'); expect(mocks.react).not.toHaveBeenCalled();
});

it('ignores a receipt returned after switching GitHub identity', async () => {
  mocks.enabled = true; tab().viewer = 'another-user';
  queueSlackReaction(tab(), receipt); await tick();
  expect(mocks.react).not.toHaveBeenCalled(); expect(tab().slackReaction).toBeUndefined();
});
it('keeps interrupted status available for recovery on normal shutdown', async () => {
  mocks.enabled = true; queueSlackReaction(tab(), receipt); stopSlackReactions(); await tick();
  expect(mocks.react).not.toHaveBeenCalled(); expect(tab().slackReaction.status).toBe('pending');
  recoverSlackReactions(); expect(tab().slackReaction.status).toBe('error');
});
