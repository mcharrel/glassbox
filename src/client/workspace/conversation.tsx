import type { PullTab, ThreadMessage } from '../../api/workspace.js';
import { threadHtml } from './threads.js';

const isBot = (message: ThreadMessage) => message.authorIsBot ?? /\[bot\]$/i.test(message.author);

/** Collapse adjacent bot-only threads, keeping human contributions in their chronological position. */
export function conversation(tab: PullTab) {
  const roots = tab.comments.filter(message => !message.deleted && message.kind === 'issue' &&
    message.parentKey === undefined && message.parentId === undefined).sort((a, b) => b.date.localeCompare(a.date));
  const groups: Array<{ bot: boolean; comments: ThreadMessage[] }> = [];
  for (const root of roots) {
    const members = new Set([root.id]);
    const remoteIds = new Set(root.remoteId === undefined ? [] : [root.remoteId]);
    // Replies can arrive before their parents in cached data; include all descendants before folding.
    let added = true;
    while (added) {
      added = false;
      for (const reply of tab.comments) {
        if (reply.deleted || members.has(reply.id) ||
          !((reply.parentKey !== undefined && members.has(reply.parentKey)) ||
            (reply.parentId !== undefined && remoteIds.has(reply.parentId)))) continue;
        members.add(reply.id);
        if (reply.remoteId !== undefined) remoteIds.add(reply.remoteId);
        added = true;
      }
    }
    const bot = isBot(root) && tab.comments.filter(message => members.has(message.id)).every(isBot);
    const previous = groups.at(-1);
    if (bot && previous?.bot === true) previous.comments.push(root);
    else groups.push({ bot, comments: [root] });
  }
  return <>{groups.map(group => {
    const content = group.comments.map(message => threadHtml(message, tab.comments));
    if (!group.bot) return content;
    const authors = [...new Set(group.comments.map(message => message.author.replace(/\[bot\]$/i, '')))];
    // Anchor to the oldest member so newer bot posts do not close an expanded group.
    return <details className="pr-bot-comments" data-key={`${tab.key}:bots:${group.comments.at(-1)?.id}`}>
      <summary><span>{group.comments.length === 1 ? '1 bot comment' : `${group.comments.length} bot comments`}</span>
        <span className="pr-bot-authors" title={authors.join(', ')}>{authors.join(', ')}</span></summary>
      {content}
    </details>;
  })}</>;
}
