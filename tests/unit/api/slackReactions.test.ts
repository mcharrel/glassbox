import { Hono } from 'hono';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), disconnect: vi.fn(), cancel: vi.fn() }));
vi.mock('../../../src/workspace/slack-settings.js', () => ({ slackSettings: mocks.get, saveSlackSettings: mocks.save, disconnectSlack: mocks.disconnect }));
vi.mock('../../../src/workspace/slack-reactions.js', () => ({ cancelSlackReactions: mocks.cancel }));
import { slackReactionsRoutes } from '../../../src/routes/api/slack-reactions.js';
const app = new Hono().route('/', slackReactionsRoutes);
const settings = { enabled: false, approvedEmoji: 'stamp-approved', changesEmoji: 'request-changes' };
beforeEach(() => {
  vi.clearAllMocks();
  const result = { settings, connected: false, keychainAvailable: true, workspace: '', user: '' };
  mocks.get.mockReturnValue(result); mocks.save.mockResolvedValue(result); mocks.disconnect.mockReturnValue(result);
});
it('returns preferences without caching and cancels active reactions after a successful save', async () => {
  const read = await app.request('/slack/reactions');
  expect(read.headers.get('cache-control')).toBe('no-store');
  expect(await read.json()).toMatchObject({ settings: { enabled: false } });
  const write = await app.request('/slack/reactions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { ...settings, approvedEmoji: ':approved:' } }) });
  expect(write.status).toBe(200);
  expect(mocks.save).toHaveBeenCalledWith({ settings: { ...settings, approvedEmoji: 'approved' } });
  expect(mocks.cancel).toHaveBeenCalledOnce();
});
it('rejects invalid or non-JSON settings without mutation', async () => {
  expect((await app.request('/slack/reactions', { method: 'PUT', body: '{}' })).status).toBe(415);
  expect((await app.request('/slack/reactions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { ...settings, changesEmoji: '' } }) })).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.cancel).not.toHaveBeenCalled();
});
it('keeps errors actionable and disconnects with cancellation', async () => {
  mocks.save.mockRejectedValueOnce(new Error('Connect Slack first'));
  const response = await app.request('/slack/reactions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) });
  expect(response.status).toBe(400); expect(await response.json()).toEqual({ error: 'Connect Slack first' });
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect((await app.request('/slack/reactions', { method: 'DELETE' })).status).toBe(200);
  expect(mocks.cancel).toHaveBeenCalledOnce(); expect(mocks.disconnect).toHaveBeenCalledOnce();
});
