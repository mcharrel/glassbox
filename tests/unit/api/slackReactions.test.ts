import { Hono } from 'hono';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), disconnect: vi.fn(), cancel: vi.fn(), react: vi.fn() }));
vi.mock('../../../src/workspace/slack-settings.js', () => ({ slackSettings: mocks.get, saveSlackSettings: mocks.save, disconnectSlack: mocks.disconnect }));
vi.mock('../../../src/workspace/slack-reactions.js', () => ({ cancelSlackReactions: mocks.cancel }));
vi.mock('../../../src/workspace/slack-provider.js', () => ({ addSlackReactions: mocks.react }));
import { slackReactionsRoutes } from '../../../src/routes/api/slack-reactions.js';
const app = new Hono().route('/', slackReactionsRoutes);
const settings = { provider: 'token', enabled: false, approvedEmoji: 'stamp-approved', changesEmoji: 'request-changes' };
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
const testBody = () => ({ settings: { ...settings, enabled: true }, messageUrl: 'https://example.slack.com/archives/C123/p1790000000123456?thread_ts=1780000000.000001' });
const testRequest = (body: unknown) => app.request('/slack/reactions/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
it('validates test links and enablement before any save or write', async () => {
  for (const body of [{ ...testBody(), messageUrl: 'https://evil.test/archives/C123/p1790000000123456' }, { ...testBody(), settings }]) expect((await testRequest(body)).status).toBe(400);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.react).not.toHaveBeenCalled();
});
it('confirms an actual reaction on the permalink target and serializes concurrent tests', async () => {
  let finish!: Function;
  mocks.save.mockResolvedValue({ settings: testBody().settings, connected: true });
  mocks.react.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = testRequest(testBody());
  await vi.waitFor(() => expect(mocks.react).toHaveBeenCalledOnce());
  expect((await testRequest(testBody())).status).toBe(409);
  expect(mocks.react.mock.calls[0][1]).toEqual({ channel: 'C123', timestamp: '1790000000.123456' });
  finish(['stamp-approved', 'rev']); const response = await first;
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ message: expect.stringContaining('Connection working') });
});
it('shows failures instead of successful tests and cancels when settings change', async () => {
  mocks.react.mockRejectedValueOnce(new Error('Emoji unavailable'));
  expect((await testRequest(testBody())).status).toBe(400);
  let finish!: Function;
  mocks.react.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = testRequest(testBody()); await vi.waitFor(() => expect(mocks.react).toHaveBeenCalledTimes(2));
  const signal = mocks.react.mock.calls[1][3];
  await app.request('/slack/reactions', { method: 'DELETE' });
  expect(signal.aborted).toBe(true); finish(); expect((await pending).status).toBe(400);
});

it('silently completes a test without a false confirmation when neither emoji exists', async () => {
  mocks.react.mockResolvedValueOnce([]);
  const response = await testRequest(testBody());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ message: '' });
});
it('confirms only the emoji actually added', async () => {
  mocks.react.mockResolvedValueOnce(['rev']);
  const response = await testRequest(testBody());
  expect(await response.json()).toMatchObject({ message: 'Connection working — :rev: is on the Slack message.' });
});
