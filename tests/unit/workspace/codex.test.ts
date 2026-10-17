import { beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema, ThreadMessageSchema, type PullTab } from '../../../src/api/workspace.js';
const mocks = vi.hoisted(() => ({ data: { tabs: [] as PullTab[], archived: [] as PullTab[] }, connect: vi.fn(), send: vi.fn(), save: vi.fn(), close: vi.fn() }));
vi.mock('../../../src/workspace/storage.js', () => ({ workspaceData: () => mocks.data, saveWorkspace: mocks.save }));
vi.mock('../../../src/workspace/codex-client.js', () => ({ codexConnection: mocks.connect, sendToCodex: mocks.send }));
import { commentPrompt, flushCodexComments, queueCodexComment, recoverCodexComments, retryCodexComment } from '../../../src/workspace/codex.js';
const chat = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const message = (body = 'Please simplify this') => ThreadMessageSchema.parse({ id: crypto.randomUUID(), body, author: 'alice', date: '', kind: 'review', path: 'src/example.ts', line: 10, side: 'new' });
function tab() {
  return PullTabSchema.parse({ key: 'owner/repo#1', ref: { owner: 'owner', repo: 'repo', number: 1, url: 'https://github.com/owner/repo/pull/1' }, repoRoot: null, reviewId: null, info: null, codexThreadId: chat });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.data.tabs = [tab()]; mocks.data.archived = [];
  mocks.connect.mockResolvedValue({ client: { close: mocks.close }, activeTurn: 'active' });
  mocks.send.mockResolvedValue(undefined);
});
it('does not start an agent or forward comments from an unlinked PR', () => {
  const t = mocks.data.tabs[0]; delete t.codexThreadId;
  const m = message(); t.comments.push(m); queueCodexComment(t, m);
  expect(m.codex).toBeUndefined(); expect(mocks.connect).not.toHaveBeenCalled();
});
it('captures the original chat and delivers once with PR and source context', async () => {
  const t = mocks.data.tabs[0]; const m = message(); t.comments.push(m);
  queueCodexComment(t, m);
  await vi.waitFor(() => expect(m.codex?.status).toBe('sent'));
  queueCodexComment(t, m); await flushCodexComments();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send.mock.calls[0].slice(1)).toEqual([chat, commentPrompt(t, m), 'queue', m.id]);
  expect(commentPrompt(t, m)).toContain('new comment: Please simplify this');
  expect(commentPrompt(t, m)).toContain('src/example.ts:10 (new)');
  expect(mocks.close).toHaveBeenCalled();
});
it('delivers a steer before ordinary messages across PRs linked to one chat', async () => {
  const t = mocks.data.tabs[0];
  const ordinary = message(); ordinary.codex = { threadId: chat, status: 'queued', mode: 'queue' };
  const steer = message('[steer] Keep the existing API'); steer.codex = { threadId: chat, status: 'queued', mode: 'steer' };
  t.comments.push(ordinary, steer);
  await flushCodexComments();
  expect(mocks.send.mock.calls.map(call => call[3])).toEqual(['steer', 'queue']);
  expect(mocks.send.mock.calls[0][2]).toContain('new comment: Keep the existing API');
  expect(mocks.send.mock.calls[0][2]).not.toContain('[steer]');
});
it('keeps comments visibly pending when the compatible desktop connection is unavailable', async () => {
  mocks.connect.mockRejectedValue(new Error('Shared server unavailable'));
  const m = message(); mocks.data.tabs[0].comments.push(m); queueCodexComment(mocks.data.tabs[0], m);
  await vi.waitFor(() => expect(m.codex?.error).toBe('Shared server unavailable'));
  expect(m.codex?.status).toBe('queued'); expect(mocks.send).not.toHaveBeenCalled();
});
it('does not retry uncertain delivery automatically, including across app restarts', async () => {
  mocks.send.mockRejectedValue(new Error('Lost acknowledgement'));
  const m = message(); mocks.data.tabs[0].comments.push(m); queueCodexComment(mocks.data.tabs[0], m);
  await vi.waitFor(() => expect(m.codex?.status).toBe('uncertain'));
  await flushCodexComments(); expect(mocks.send).toHaveBeenCalledTimes(1);
  m.codex!.status = 'sending'; recoverCodexComments(); expect(m.codex?.status).toBe('uncertain');
  mocks.send.mockResolvedValue(undefined); retryCodexComment(m);
  await vi.waitFor(() => expect(m.codex?.status).toBe('sent'));
  expect(mocks.send).toHaveBeenCalledTimes(2);
});
it('ignores remote, old, deleted and already delivered comments but preserves an archived pending one', async () => {
  const t = mocks.data.tabs[0]; const remote = message(); const deleted = message();
  deleted.deleted = true; deleted.codex = { threadId: chat, status: 'queued', mode: 'queue' };
  const pending = message(); pending.codex = { threadId: chat, status: 'queued', mode: 'queue' };
  t.comments.push(remote, deleted, pending); mocks.data.archived.push(t); mocks.data.tabs = [];
  await flushCodexComments(); expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.send.mock.calls[0][4]).toBe(pending.id);
});
