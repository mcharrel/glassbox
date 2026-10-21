import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), claude: vi.fn() }));
vi.mock('../../src/workspace/slack-settings.js', () => ({
  slackToken: () => 'fixture-token',
  saveSlackSettings: async ({ settings }: any) => ({ settings, connected: true, keychainAvailable: true, workspace: '', user: '' }),
}));
vi.mock('../../src/workspace/slack-reactions.js', () => ({ cancelSlackReactions: vi.fn() }));
vi.mock('../../src/workspace/slack-claude.js', () => ({ claudeSlackCall: mocks.claude }));
import { slackReactionsRoutes } from '../../src/routes/api/slack-reactions.js';

const app = new Hono().route('/', slackReactionsRoutes);
const run = (provider: 'token' | 'claude') => app.request('/slack/reactions/test', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    settings: { provider, enabled: true, approvedEmoji: 'approved', changesEmoji: 'changes' },
    messageUrl: 'https://example.slack.com/archives/C123/p1790000000123456',
  }),
});
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('fetch', mocks.fetch); });
afterEach(() => vi.unstubAllGlobals());

it.each(['token', 'claude'] as const)('tests paired reactions through the HTTP route with %s', async provider => {
  const attempts: string[] = [];
  let missing = new Set(['approved']);
  const receipt = (emoji: string) => {
    attempts.push(emoji);
    return missing.has(emoji) ? { ok: false, error: 'invalid_name' } : { ok: true };
  };
  mocks.fetch.mockImplementation(async (url, init) => {
    expect(url).toBe('https://slack.com/api/reactions.add');
    expect(init.body.get('channel')).toBe('C123');
    expect(init.body.get('timestamp')).toBe('1790000000.123456');
    return Response.json(receipt(init.body.get('name')));
  });
  mocks.claude.mockImplementation(async (tool, args) => {
    expect(tool).toBe('slack_add_reaction');
    expect(args).toMatchObject({ channel_id: 'C123', timestamp: '1790000000.123456' });
    return [{ type: 'text', text: JSON.stringify(receipt(args.reaction)) }];
  });
  const partial = await run(provider);
  expect(partial.status).toBe(200);
  expect((await partial.json()).message).toBe('Connection working — :rev: is on the Slack message.');
  expect(attempts).toEqual(['approved', 'rev']);

  missing = new Set(['approved', 'rev']); attempts.length = 0;
  const skipped = await run(provider);
  expect(skipped.status).toBe(200);
  expect((await skipped.json()).message).toBe('');
  expect(attempts).toEqual(['approved', 'rev']);

  missing.clear(); attempts.length = 0;
  const both = await run(provider);
  expect(both.status).toBe(200);
  expect((await both.json()).message).toBe('Connection working — :approved: and :rev: are on the Slack message.');
  expect(attempts).toEqual(['approved', 'rev']);
});
