import { z } from 'zod';

import { slackMessageTarget, type SlackPreferences } from '../api/slack-reactions.js';
import { containsPullLink, reactToPullLinks, slackCall } from './slack-api.js';
import { claudeSlackCall } from './slack-claude.js';
import { slackToken } from './slack-settings.js';

type Target = { channel: string; timestamp: string };
const record = z.record(z.string(), z.unknown());
/** Only tool receipts count; model-generated descriptions are never accepted. */
export function slackToolResult(value: unknown): Record<string, unknown> {
  let data = record.parse(value);
  if (data.isError === true) throw new Error('Slack rejected this request. Check your connection and emoji in Settings → Slack.');
  if (Array.isArray(data.content)) {
    const blocks = z.array(z.object({ type: z.string(), text: z.string().optional() })).parse(data.content);
    const text = blocks.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n');
    try { data = record.parse(JSON.parse(text)); } catch { throw new Error('Slack returned an unrecognized response. Check your Claude Slack plugin version.'); }
  }
  if (data.ok === false && data.error !== 'already_reacted') throw new Error('Slack rejected this request. Check your connection, message access and emoji in Settings → Slack.');
  return data;
}
export function claudeSearchPage(value: unknown, prUrl: string): { matches: Target[]; cursor?: string } {
  const data = z.object({ results: z.string(), pagination_info: z.string() }).parse(slackToolResult(value));
  const cursor = /For the next page of results use cursor `([^`]+)`/.exec(data.pagination_info)?.[1];
  if (cursor === undefined && !data.pagination_info.includes('End of results')) throw new Error('Slack did not report search pagination. Retry the Slack reaction later.');
  if (/^No results found\./m.test(data.results) && !data.results.includes('### Result')) return { matches: [], cursor };
  const count = /^## Messages \((\d+) results?\)/m.exec(data.results);
  const headers = [...data.results.matchAll(/^### Result \d+ of \d+\r?$/gm)];
  // Reject ambiguous boundaries rather than trusting a message that imitates search metadata.
  if (!count || Number(count[1]) !== headers.length) throw new Error('Slack returned an unreadable search result.');
  const matches: Target[] = [];
  for (let i = 0; i < headers.length; i++) {
    const block = data.results.slice(headers[i].index, headers[i + 1]?.index);
    const textAt = block.indexOf('\nText:');
    const metadata = block.slice(0, textAt);
    const permalink = /^Permalink: \[link\]\((https:\/\/[^\s)]+)\)/m.exec(metadata)?.[1];
    const target = permalink !== undefined ? slackMessageTarget(permalink) : null;
    const channel = /^Channel: .*\(ID: ([CGD][A-Z0-9]+)\)/m.exec(metadata)?.[1];
    const timestamp = /^Message_ts: (\d{10}\.\d{6})\r?$/m.exec(metadata)?.[1];
    if (textAt < 0 || !target || target.channel !== channel || target.timestamp !== timestamp) throw new Error('Slack returned an unreadable message link.');
    if (containsPullLink(block.slice(textAt + 6), prUrl)) matches.push(target);
  }
  return { matches, cursor };
}
function token(): string {
  const value = slackToken();
  if (value === null || value === '') throw new Error('Reconnect Slack in Settings → Slack.');
  return value;
}
export async function addSlackReaction(settings: SlackPreferences, target: Target, emoji: string, signal: AbortSignal): Promise<void> {
  if (settings.provider === 'token') {
    await slackCall(token(), 'reactions.add', { ...target, name: emoji }, signal);
    return;
  }
  const data = slackToolResult(await claudeSlackCall('slack_add_reaction', { channel_id: target.channel, timestamp: target.timestamp, reaction: emoji }, signal));
  if (data.ok !== true && data.error !== 'already_reacted') throw new Error('Slack did not confirm the reaction. Check the message before retrying.');
}
export async function reactWithSlackProvider(settings: SlackPreferences, prUrl: string, emoji: string, signal: AbortSignal, onProgress: (count: number) => void): Promise<number> {
  if (settings.provider !== 'claude') return reactToPullLinks(token(), prUrl, emoji, signal, onProgress);
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let count = 0;
  for (let page = 0; page < 100; page++) {
    const result = claudeSearchPage(await claudeSlackCall('slack_search_public_and_private', {
      keywords: [`"${prUrl}"`], natural_language_query: '', content_types: 'messages',
      include_bots: true, include_context: false, response_format: 'detailed', limit: 20,
      ...(cursor !== undefined ? { cursor } : {}),
    }, signal), prUrl);
    for (const match of result.matches) {
      const key = `${match.channel}:${match.timestamp}`;
      if (seen.has(key)) continue;
      await addSlackReaction(settings, match, emoji, signal);
      seen.add(key); onProgress(++count);
    }
    if (result.cursor === undefined) return count;
    if (cursors.has(result.cursor)) throw new Error('Slack repeated a search page. Retry the remaining reactions later.');
    cursor = result.cursor; cursors.add(cursor);
  }
  throw new Error('Slack’s search limit was reached. Some messages may not have received a reaction.');
}
