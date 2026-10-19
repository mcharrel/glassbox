import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { containsPullLink, reactToPullLinks, slackCall, validateSlackToken } from '../../../src/workspace/slack-api.js';

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
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(result([match('1'), match('3', `<${url}/files|changes>`)], 2))
    .mockResolvedValueOnce(Response.json({ ok: false, error: 'already_reacted' }));
  const progress = vi.fn();
  expect(await reactToPullLinks(token, url, 'stamp-approved', signal(), progress)).toBe(2);
  const calls = fetch.mock.calls;
  expect(new URL(calls[0][0]).searchParams.get('query')).toBe(`"${url}"`);
  expect(new URL(calls[2][0]).searchParams.get('page')).toBe('2');
  expect(calls[0][1].method).toBe('GET');
  expect(calls[1][1].body.get('name')).toBe('stamp-approved');
  expect(calls[1][1].body.get('timestamp')).toBe('1');
  expect(calls[3][1].body.get('timestamp')).toBe('3');
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
    .mockResolvedValueOnce(result([match('1')], 2)).mockResolvedValueOnce(Response.json({ ok: true }));
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
  await expect(slackCall(token, 'reactions.add', {}, signal())).rejects.toThrow('emoji does not exist');
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
