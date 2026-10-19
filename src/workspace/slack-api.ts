import { setTimeout as delay } from 'node:timers/promises';

import { z } from 'zod';

const EnvelopeSchema = z.object({ ok: z.boolean(), error: z.string().optional() });
const errors: Record<string, string> = {
  invalid_auth: 'Reconnect Slack in Settings → Profile.',
  token_revoked: 'Reconnect Slack in Settings → Profile.',
  account_inactive: 'Reconnect Slack with an active account.',
  missing_scope: 'The Slack connection needs search:read and reactions:write user permissions.',
  not_allowed_token_type: 'Connect a Slack user token with search:read and reactions:write permissions.',
  invalid_name: 'This emoji does not exist in your Slack workspace. Change it in Settings → Profile.',
  no_permission: 'Slack did not allow a reaction on this message.',
  is_archived: 'Slack cannot add a reaction in an archived channel.',
  message_not_found: 'A matching Slack message is no longer available.',
  channel_not_found: 'A matching Slack channel is no longer available.',
};

/** Never expose response bodies or request errors: they may contain a credential. */
export async function slackCall(token: string, method: 'auth.test' | 'search.messages' | 'reactions.add', fields: Record<string, string>, signal: AbortSignal): Promise<{ data: unknown; scopes: string | null }> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    let response: Response;
    let data: unknown;
    try {
      const search = method === 'search.messages';
      const params = new URLSearchParams(fields);
      response = await fetch(`https://slack.com/api/${method}${search ? `?${params}` : ''}`, {
        method: search ? 'GET' : 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: search ? undefined : params,
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      data = response.status === 429 ? { ok: false, error: 'ratelimited' } : await response.json();
    } catch {
      signal.throwIfAborted();
      throw new Error('Could not reach Slack. Your GitHub review is unchanged; retry the Slack reaction later.');
    }
    const result = EnvelopeSchema.safeParse(data);
    if (response.status === 429 || (result.success && result.data.error === 'ratelimited')) {
      const seconds = Number(response.headers.get('Retry-After') ?? 60);
      if (attempt >= 2 || !Number.isFinite(seconds) || seconds > 120)
        throw new Error('Slack is rate limiting requests. Retry the Slack reaction later.');
      await delay(Math.max(1, seconds) * 1000, undefined, { signal });
      continue;
    }
    if (response.ok && result.success && (result.data.ok || (method === 'reactions.add' && result.data.error === 'already_reacted')))
      return { data, scopes: response.headers.get('x-oauth-scopes') };
    throw new Error(errors[result.success ? result.data.error ?? '' : ''] ?? 'Slack could not complete this request. Retry the Slack reaction later.');
  }
}

export async function validateSlackToken(token: string): Promise<{ workspace: string; user: string }> {
  const { data, scopes } = await slackCall(token, 'auth.test', {}, AbortSignal.timeout(20_000));
  const identity = z.object({ team: z.string(), user: z.string(), bot_id: z.string().optional() }).safeParse(data);
  if (!identity.success || identity.data.bot_id !== undefined || !token.startsWith('xoxp-'))
    throw new Error('Use a Slack user OAuth token, with search:read and reactions:write permissions.');
  if (scopes !== null && ['search:read', 'reactions:write'].some(scope => !scopes.split(',').map(item => item.trim()).includes(scope)))
    throw new Error(errors.missing_scope);
  return { workspace: identity.data.team, user: identity.data.user };
}

const SearchSchema = z.object({ messages: z.object({
  matches: z.array(z.object({ channel: z.object({ id: z.string() }), ts: z.string(), text: z.string() })),
  paging: z.object({ pages: z.number().int().nonnegative() }).optional(),
  pagination: z.object({ page_count: z.number().int().nonnegative() }).optional(),
}) });

/** Slack search is fuzzy; only react to a genuine link to this exact PR. */
export function containsPullLink(text: string, prUrl: string): boolean {
  const pr = new URL(prUrl);
  const target = pr.pathname.replace(/\/$/, '').toLowerCase();
  return (text.match(/https:\/\/[^\s<>|"']+/gi) ?? []).some(link => {
    try {
      const url = new URL(link.replace(/[).,;!]+$/, ''));
      const path = url.pathname.toLowerCase();
      return url.origin === pr.origin && !url.username && !url.password &&
        (path === target || path.startsWith(`${target}/`));
    } catch { return false; }
  });
}

export async function reactToPullLinks(token: string, prUrl: string, emoji: string, signal: AbortSignal, onProgress: (count: number) => void): Promise<number> {
  const seen = new Set<string>();
  let count = 0;
  for (let page = 1; ; page++) {
    const { data } = await slackCall(token, 'search.messages', {
      query: `"${prUrl}"`, count: '100', page: String(page), highlight: 'false', sort: 'timestamp', sort_dir: 'asc',
    }, signal);
    const parsed = SearchSchema.safeParse(data);
    if (!parsed.success) throw new Error('Slack returned an unreadable search result. Retry the Slack reaction later.');
    const { matches, paging, pagination } = parsed.data.messages;
    for (const match of matches) {
      const key = `${match.channel.id}:${match.ts}`;
      if (seen.has(key) || !containsPullLink(match.text, prUrl)) continue;
      seen.add(key);
      await slackCall(token, 'reactions.add', { channel: match.channel.id, timestamp: match.ts, name: emoji }, signal);
      onProgress(++count);
    }
    const pages = pagination?.page_count ?? paging?.pages;
    if (pages === undefined) throw new Error('Slack did not report search pagination. Retry the Slack reaction later.');
    if (page >= pages) return count;
    if (page >= 100) throw new Error('Slack’s search limit was reached. Some matching messages may not have received a reaction.');
  }
}
