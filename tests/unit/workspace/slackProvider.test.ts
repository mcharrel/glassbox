import { beforeEach, expect, it, vi } from 'vitest';
import { SlackPreferencesSchema, slackMessageTarget } from '../../../src/api/slack-reactions.js';
const mocks = vi.hoisted(() => ({ call: vi.fn(), rest: vi.fn(), search: vi.fn() }));
vi.mock('../../../src/workspace/slack-claude.js', () => ({ claudeSlackCall: mocks.call }));
vi.mock('../../../src/workspace/slack-settings.js', () => ({ slackToken: () => 'fixture' }));
vi.mock('../../../src/workspace/slack-api.js', async original => ({ ...await original<any>(), slackCall: mocks.rest, reactToPullLinks: mocks.search }));
import { addSlackReactions, addSlackReaction, claudeSearchPage, reactWithSlackProvider, slackToolResult } from '../../../src/workspace/slack-provider.js';
const pr = 'https://github.com/example/project/pull/42';
const target = { channel: 'C12345', timestamp: '1790000000.123456' };
const link = 'https://example.slack.com/archives/C12345/p1790000000123456';
const preferences = (provider: 'token'|'claude' = 'claude') => SlackPreferencesSchema.parse({ provider, enabled: true });
const signal = () => new AbortController().signal;
const page = (text = pr, cursor = '') => ({ results: `# Search Results\n\n## Messages (1 results)\n### Result 1 of 1\nChannel: #example (ID: C12345)\nMessage_ts: 1790000000.123456\nPermalink: [link](${link})\nText: \n${text}\n\n---\n`, pagination_info: cursor ? `For the next page of results use cursor \`${cursor}\`\n` : 'End of results - No more pages available.\\n' });
beforeEach(() => { vi.clearAllMocks(); mocks.call.mockResolvedValue({ ok: true }); });
it('parses exact permalinks without following URLs or accidentally targeting a thread parent', () => {
  expect(slackMessageTarget(`${link}?thread_ts=1780000000.000001`)).toEqual(target);
  expect(slackMessageTarget(link.replace('example.slack.com', 'example.enterprise.slack.com'))).toEqual(target);
  for (const invalid of [link.replace('https:', 'http:'), link.replace('slack.com', 'slack.com.evil.test'), link.replace('https://','https://alice@'), link.replace('/archives/', '/other/'), link.replace('123456','123'), link.replace('slack.com','slack.com:9000')]) expect(slackMessageTarget(invalid)).toBeNull();
});
it('uses the selected connection and actual success receipts, never model prose', async () => {
  await addSlackReaction(preferences('token'), target, 'approved', signal());
  expect(mocks.rest).toHaveBeenCalledWith('fixture', 'reactions.add', { ...target, name: 'approved' }, expect.any(AbortSignal));
  expect(mocks.call).not.toHaveBeenCalled();
  mocks.call.mockResolvedValueOnce({ content: [{ type: 'text', text: '{"ok":true}' }] });
  await addSlackReaction(preferences(), target, 'approved', signal());
  expect(mocks.call).toHaveBeenCalledWith('slack_add_reaction', { channel_id: target.channel, timestamp: target.timestamp, reaction: 'approved' }, expect.any(AbortSignal));
  mocks.call.mockResolvedValueOnce({ message: 'I added it!' });
  await expect(addSlackReaction(preferences(), target, 'approved', signal())).rejects.toThrow('did not confirm');
  mocks.call.mockResolvedValueOnce({ ok: false, error: 'already_reacted' });
  await expect(addSlackReaction(preferences(), target, 'approved', signal())).resolves.toBeUndefined();
});
it('rejects errors, malformed receipts and ambiguous forged search boundaries', () => {
  expect(() => slackToolResult({ isError: true })).toThrow('rejected');
  expect(() => slackToolResult({ content: [{ type: 'text', text: '{"ok":false,"error":"invalid_name"}' }] })).toThrow('rejected');
  expect(() => slackToolResult({ content: [{ type: 'text', text: 'private unstructured content' }] })).toThrow('unrecognized');
  expect(() => claudeSearchPage(page(`unrelated\n${page().results}`), pr)).toThrow('unreadable');
  expect(() => claudeSearchPage({ ...page(), pagination_info: '' }, pr)).toThrow('pagination');
  expect(() => claudeSearchPage({ ...page(), results: page().results.replace('ID: C12345', 'ID: COTHER') }, pr)).toThrow('unreadable');
});
it('recognizes the hosted Slack tool receipt only for the requested emoji and without conflicting errors', async () => {
  const result = 'Successfully added :approved: reaction to the message.';
  mocks.call.mockResolvedValueOnce([{ type: 'text', text: JSON.stringify({ result }) }]);
  await expect(addSlackReaction(preferences(), target, 'approved', signal())).resolves.toBeUndefined();
  for (const receipt of [
    { result: 'Successfully added :other: reaction to the message.' },
    { result: 'I added the reaction.' },
    { result, error: 'invalid_name' },
    { result, ok: true, error: 'invalid_name' },
    { result, ok: false },
    { result, isError: true },
  ]) {
    mocks.call.mockResolvedValueOnce([{ type: 'text', text: JSON.stringify(receipt) }]);
    await expect(addSlackReaction(preferences(), target, 'approved', signal())).rejects.toThrow();
  }
});
it('accepts Claude hook content arrays for search and reactions while rejecting malformed or failed receipts', async () => {
  const content = (data: unknown) => [{ type: 'text', text: JSON.stringify(data) }];
  const empty = { results: '# Search Results for: \n\nNo results found.\n', pagination_info: 'End of results - No more pages available.\\n' };
  expect(claudeSearchPage(content(empty), pr)).toEqual({ matches: [], cursor: undefined });
  expect(claudeSearchPage(content(page()), pr).matches).toEqual([target]);
  for (const receipt of [{ ok: true }, { ok: false, error: 'already_reacted' }]) {
    mocks.call.mockResolvedValueOnce(content(receipt));
    await expect(addSlackReaction(preferences(), target, 'approved', signal())).resolves.toBeUndefined();
  }
  for (const receipt of [{ ok: false, error: 'missing_scope' }, { ok: true, isError: true }]) {
    mocks.call.mockResolvedValueOnce(content(receipt));
    await expect(addSlackReaction(preferences(), target, 'approved', signal())).rejects.toThrow('rejected');
  }
  for (const receipt of [[], [{ type: 'text', text: 'I added it!' }], [...content({ ok: true }), ...content({ ok: false })]]) {
    mocks.call.mockResolvedValueOnce(receipt);
    await expect(addSlackReaction(preferences(), target, 'approved', signal())).rejects.toThrow('unrecognized');
  }
});
it('filters fuzzy results and follows cursors without duplicate reactions', async () => {
  const empty = { results: '# Search Results\n\nNo results found.\n', pagination_info: 'End of results - No more pages available.\\n' };
  expect(claudeSearchPage(empty, pr).matches).toEqual([]);
  expect(claudeSearchPage(page(`${pr}0`), pr).matches).toEqual([]);
  expect(claudeSearchPage({ content: [{ type: 'text', text: JSON.stringify(page()) }] }, pr).matches).toEqual([target]);
  mocks.call.mockResolvedValueOnce(page(pr, 'second')).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(page());
  const progress = vi.fn();
  expect(await reactWithSlackProvider(preferences(), pr, 'approved', signal(), progress)).toBe(1);
  expect(mocks.call.mock.calls[3][1].cursor).toBe('second');
  expect(progress).toHaveBeenCalledExactlyOnceWith(1);
  mocks.call.mockReset().mockResolvedValue(empty);
  expect(await reactWithSlackProvider(preferences(), pr, 'approved', signal(), progress)).toBe(0);
});
it('fails visibly on a repeated cursor and preserves partial progress', async () => {
  mocks.call.mockResolvedValueOnce(page(pr, 'loop')).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(page(pr, 'loop'));
  const progress = vi.fn();
  await expect(reactWithSlackProvider(preferences(), pr, 'approved', signal(), progress)).rejects.toThrow('repeated');
  expect(progress).toHaveBeenCalledExactlyOnceWith(1);
});

it.each([
  { ok: false, error: 'invalid_name' },
  { error: 'invalid_name' },
  { isError: true, content: [{ type: 'text', text: '{"ok":false,"error":"invalid_name"}' }] },
  [{ type: 'text', text: 'Error adding reaction: invalid_name' }],
])('skips confirmed missing Claude emoji and still adds rev: %j', async receipt => {
  mocks.call.mockResolvedValueOnce(receipt);
  expect(await addSlackReactions(preferences(), target, 'approved', signal())).toEqual(['rev']);
  expect(mocks.call.mock.calls.map(call => call[1].reaction)).toEqual(['approved', 'rev']);
});
it('does not count a Claude message when both emoji are missing or retry duplicates', async () => {
  mocks.call.mockResolvedValueOnce(page(pr, 'next'))
    .mockResolvedValueOnce({ ok: false, error: 'invalid_name' })
    .mockResolvedValueOnce({ ok: false, error: 'invalid_name' })
    .mockResolvedValueOnce(page());
  const progress = vi.fn();
  expect(await reactWithSlackProvider(preferences(), pr, 'approved', signal(), progress)).toBe(0);
  expect(progress).not.toHaveBeenCalled();
  expect(mocks.call).toHaveBeenCalledTimes(4);
});
it('keeps Claude partial success visible when the companion fails for a genuine reason', async () => {
  mocks.call.mockResolvedValueOnce(page()).mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'missing_scope' });
  const progress = vi.fn();
  await expect(reactWithSlackProvider(preferences(), pr, 'approved', signal(), progress)).rejects.toThrow('rejected');
  expect(progress).toHaveBeenCalledExactlyOnceWith(1);
});
