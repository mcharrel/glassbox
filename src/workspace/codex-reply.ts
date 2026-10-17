import { randomUUID } from 'node:crypto';

import type { ThreadMessage } from '../api/workspace.js';
import { parsePullUrl, pullKey } from './github.js';
import { saveWorkspace, workspaceData } from './storage.js';

export function postCodexReply(input: { url: string; threadId: string; commentId: string; body: string }): string {
  const data = workspaceData();
  const key = pullKey(parsePullUrl(input.url));
  const tab = [...data.tabs, ...data.archived].find(item => item.key === key);
  const original = tab?.comments.find(item => item.id === input.commentId && !item.deleted && item.kind !== 'ai');
  if (!tab || !original) throw new Error('Comment not found in this PR');
  if (tab.codexThreadId !== input.threadId || original.codex?.threadId !== input.threadId)
    throw new Error('Only the originating Codex chat can answer this comment');
  // Repeating the same reply after a lost acknowledgement must not duplicate it.
  const existing = tab.comments.find(item => item.kind === 'ai' && item.author === 'Codex'
    && item.parentKey === original.id && item.body === input.body && !item.deleted);
  if (existing) return existing.id;
  const reply: ThreadMessage = {
    id: randomUUID(), parentKey: original.id, author: 'Codex', body: input.body,
    date: new Date().toISOString(), url: '', kind: 'ai', status: 'done', editable: false, deleted: false,
    path: original.path, line: original.line, side: original.side, annotationId: original.annotationId,
  };
  tab.comments.push(reply);
  original.codex.status = 'sent';
  delete original.codex.error;
  tab.lastUsedAt = Date.now();
  saveWorkspace();
  return reply.id;
}
