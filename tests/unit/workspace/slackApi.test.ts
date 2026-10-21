import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { addReactionPair, containsPullLink, isMissingSlackEmojiFailure, MissingSlackEmojiError, reactToPullLinks, slackCall, validateSlackToken } from '../../../src/workspace/slack-api.js';

const url = 'https://github.com/example/project/pull/12';
const token = 'xoxp-test-only-not-a-credential';
let fetch: ReturnType<typeof vi.fn>;
const signal = () => new AbortController().signal;
const result = (matches: any[] = [], pages = 1) => Response.json({ ok: true, messages: { matches, paging: { pages } } });
const match = (ts: string, text = url) => ({ text, ts, channel: { id: 'CEXAMPLE' } });
beforeEach(() => { fetch = vi.fn(); vi.stubGlobal('fetch', fetch); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([url, `<${url}|PR>`, `${url}/files#diff-example`, `(${url}?test=1).`, url.toUpperCase()])('recognizes exact PR links: %s', text => {
  expect(containsPullLink(text, url)).toBe(true);
});
it.each([`${url}3`, `${url}3/files`, 'example/project/pull/12', url.replace('github.com', 'github.com.evil.example'), `https://github.com@example.test/example/project/pull/12`, `https://example.test/?link=${url}`])('rejects fuzzy or misleading matches: %s', text => {
  expect(containsPullLink(text, url)).toBe(false);
});
it('paginates, deduplicates messages, excludes other PRs, and treats existing reactions as success', async () => {
  fetch.mockResolvedValueOnce(result([match('1'), match('2', `${url}3`)], 2))
    .mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(result([match('1'), match('3', `<${url}/files|changes>`)], 2))
    .mockResolvedValueOnce(Response.json({ ok: false, error: 'already_reacted' })).mockResolvedValueOnce(Response.json({ ok: false, error: 'already_reacted' }));
  const progress = vi.fn();
  expect(await reactToPullLinks(token, url, 'stamp-approved', signal(), progress)).toBe(2);
  const calls = fetch.mock.calls;
  expect(new URL(calls[0][0]).searchParams.get('query')).toBe(`"${url}"`);
  expect(new URL(calls[3][0]).searchParams.get('page')).toBe('2');
  expect(calls[0][1].method).toBe('GET');
  expect(calls[1][1].body.get('name')).toBe('stamp-approved');
  expect(calls[1][1].body.get('timestamp')).toBe('1');
  expect(calls[2][1].body.get('name')).toBe('rev');
  expect(calls[5][1].body.get('name')).toBe('rev');
  expect(calls).toHaveLength(6);
  expect(calls[4][1].body.get('timestamp')).toBe('3');
  expect(calls.every(([url]) => !url.includes(token))).toBe(true);
  expect(progress.mock.calls).toEqual([[1], [2]]);
});
it.each([{ matches: [] }, { matches: [match('1', `${url}3`)] }])('does not react when zero results match', async ({ matches }) => {
  fetch.mockResolvedValue(result(matches, 0));
  expect(await reactToPullLinks(token, url, 'approved', signal(), vi.fn())).toBe(0);
  expect(fetch).toHaveBeenCalledOnce();
});
it('handles the newer pagination shape without losing later pages', async () => {
  fetch.mockResolvedValueOnce(Response.json({ ok: true, messages: { matches: [], pagination: { page_count: 2 } } }))
    .mockResolvedValueOnce(result([match('1')], 2)).mockResolvedValueOnce(Response.json({ ok: true })).mockResolvedValueOnce(Response.json({ ok: true }));
  expect(await reactToPullLinks(token, url, 'approved', signal(), vi.fn())).toBe(1);
});
it('waits for Retry-After and cancels waiting when disabled', async () => {
  vi.useFakeTimers();
  fetch.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } })).mockResolvedValueOnce(Response.json({ ok: true }));
  const pending = slackCall(token, 'reactions.add', {}, signal());
  await vi.advanceTimersByTimeAsync(1999); expect(fetch).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1); await pending; expect(fetch).toHaveBeenCalledTimes(2);
  const controller = new AbortController();
  fetch.mockResolvedValue(new Response('', { status: 429 }));
  const aborted = slackCall(token, 'reactions.add', {}, controller.signal);
  const assertion = expect(aborted).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(1); controller.abort(); await assertion;
});
it('returns actionable safe errors without echoing credentials or raw Slack responses', async () => {
  fetch.mockResolvedValueOnce(Response.json({ ok: false, error: 'invalid_name', detail: token }));
  await expect(slackCall(token, 'reactions.add', {}, signal())).rejects.toBeInstanceOf(MissingSlackEmojiError);
  fetch.mockRejectedValue(new Error(token));
  await expect(slackCall(token, 'reactions.add', {}, signal())).rejects.not.toThrow(token);
});
it('requires a user identity with both scopes when connecting', async () => {
  fetch.mockResolvedValue(Response.json({ ok: true, team: 'Example', user: 'alice' }, { headers: { 'x-oauth-scopes': 'search:read,reactions:write' } }));
  expect(await validateSlackToken(token)).toEqual({ workspace: 'Example', user: 'alice' });
  fetch.mockResolvedValue(Response.json({ ok: true, team: 'Example', user: 'alice' }, { headers: { 'x-oauth-scopes': 'search:read' } }));
  await expect(validateSlackToken(token)).rejects.toThrow('reactions:write');
  fetch.mockResolvedValue(Response.json({ ok: true, team: 'Example', user: 'bot', bot_id: 'BEXAMPLE' }));
  await expect(validateSlackToken(token)).rejects.toThrow('user OAuth token');
});

it.each([
  ['approved', ['approved'], ['rev']],
  ['approved', ['rev'], ['approved']],
  ['approved', ['approved', 'rev'], []],
  ['rev', [], ['rev']],
])('attempts each unique emoji independently: %s missing %j', async (emoji, missing, expected) => {
  const add = vi.fn(async (name: string) => { if (missing.includes(name)) throw new MissingSlackEmojiError(); });
  const progress = vi.fn();
  expect(await addReactionPair(emoji, signal(), add, progress)).toEqual(expected);
  expect(add.mock.calls.map(call => call[0])).toEqual([...new Set([emoji, 'rev'])]);
  expect(progress).toHaveBeenCalledTimes(expected.length ? 1 : 0);
});
it('preserves partial progress, genuine failures and cancellation between the two reactions', async () => {
  const progress = vi.fn();
  const add = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Reconnect Slack'));
  await expect(addReactionPair('approved', signal(), add, progress)).rejects.toThrow('Reconnect Slack');
  expect(progress).toHaveBeenCalledExactlyOnceWith();
  const controller = new AbortController();
  add.mockReset().mockImplementation(async () => { controller.abort(); });
  await expect(addReactionPair('approved', controller.signal, add)).rejects.toThrow();
  expect(add).toHaveBeenCalledOnce();
});
it('skips missing REST emoji without stopping pagination or counting skipped messages', async () => {
  fetch.mockResolvedValueOnce(result([match('1')], 2))
    .mockResolvedValueOnce(Response.json({ ok: false, error: 'invalid_name' }))
    .mockResolvedValueOnce(Response.json({ ok: false, error: 'invalid_name' }))
    .mockResolvedValueOnce(result([match('1'), match('2')], 2))
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json({ ok: false, error: 'invalid_name' }));
  const progress = vi.fn();
  expect(await reactToPullLinks(token, url, 'approved', signal(), progress)).toBe(1);
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(progress).toHaveBeenCalledExactlyOnceWith(1);
});
it('recognizes only explicit missing-emoji tool failures', () => {
  for (const text of ['invalid_name', 'Error adding reaction: invalid_name', '{"ok":false,"error":"invalid_name"}']) expect(isMissingSlackEmojiFailure(text)).toBe(true);
  for (const text of ['no_permission', 'Could not add invalid_name because of missing_scope', 'invalid_name: missing_scope', '{"ok":true,"error":"invalid_name"}', '{"error":"invalid_name","result":"success"}']) expect(isMissingSlackEmojiFailure(text)).toBe(false);
});
