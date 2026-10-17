import type { PullTab, ThreadMessage } from '../api/workspace.js';
import { codexConnection, sendToCodex } from './codex-client.js';
import { saveWorkspace, workspaceData } from './storage.js';

export function commentPrompt(tab: PullTab, message: ThreadMessage): string {
  const body = message.body.replace(/^\s*\[steer\]\s*/i, '');
  const location = message.path !== undefined ? `\nFile: ${message.path}${message.line != null ? `:${message.line} (${message.side ?? 'new'})` : ''}` : '';
  return `new comment: ${body}\n\nPR: ${tab.ref.url}${location}\nrev comment: ${message.id}\n\nAfter handling this comment, post a concise answer into its rev thread with:\nrev reply ${tab.ref.url} --comment ${message.id} --body-file <reply-file>\nKeep CODEX_THREAD_ID unchanged. Use the existing chat context and normal verification/signing workflow.`;
}
export function queueCodexComment(tab: PullTab, message: ThreadMessage): void {
  if (tab.codexThreadId === undefined || message.codex || message.deleted || message.kind === 'ai') return;
  message.codex = {
    threadId: tab.codexThreadId,
    mode: /^\s*\[steer\]/i.test(message.body) ? 'steer' : 'queue',
    status: 'queued',
  };
  saveWorkspace();
  void flushCodexComments();
}
export function retryCodexComment(message: ThreadMessage): void {
  if (!message.codex || message.codex.status !== 'uncertain') throw new Error('No uncertain delivery to retry');
  message.codex.status = 'queued';
  delete message.codex.error;
  saveWorkspace();
  void flushCodexComments();
}
export function recoverCodexComments(): void {
  const data = workspaceData();
  for (const tab of [...data.tabs, ...data.archived]) for (const message of tab.comments) {
    if (message.codex?.status === 'sending') {
      message.codex.status = 'uncertain';
      message.codex.error = 'Delivery was interrupted. Check the Codex chat before resending.';
    }
  }
}
let flushing = false;
export async function flushCodexComments(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const data = workspaceData();
    const connections = new Map<string, Awaited<ReturnType<typeof codexConnection>> | null>();
    // Steers bypass queued ordinary comments, including ones in another PR bound to this chat.
    const pending = [...data.tabs, ...data.archived].flatMap(tab => tab.comments.map(message => ({ tab, message })))
      .filter(({ message }) => !message.deleted && message.codex?.status === 'queued')
      .sort((a, b) => Number(b.message.codex?.mode === 'steer') - Number(a.message.codex?.mode === 'steer'));
    for (const { tab, message } of pending) {
      const delivery = message.codex;
      if (!delivery) continue;
      let connection = connections.get(delivery.threadId);
      if (connection === undefined) {
        try { connection = await codexConnection(delivery.threadId); }
        catch (error) {
          connection = null;
          delivery.error = error instanceof Error ? error.message : 'Codex is unavailable';
        }
        connections.set(delivery.threadId, connection);
      }
      if (!connection) {
        delivery.error ??= 'Waiting for Codex. Open the originating chat.';
        continue;
      }
      if (message.deleted || delivery.status !== 'queued') continue;
      delete delivery.error;
      // Persist before dispatch: a lost acknowledgement must never cause an automatic duplicate.
      delivery.status = 'sending';
      saveWorkspace();
      try {
        await sendToCodex(connection, delivery.threadId, commentPrompt(tab, message), delivery.mode, message.id);
        delivery.status = 'sent';
      } catch {
        delivery.status = 'uncertain';
        delivery.error = 'Delivery was not confirmed. Check the Codex chat before resending.';
        connection.client.close();
        connections.set(delivery.threadId, null);
      }
      saveWorkspace();
    }
    for (const connection of connections.values()) connection?.client.close();
    saveWorkspace();
  } finally { flushing = false; }
}
