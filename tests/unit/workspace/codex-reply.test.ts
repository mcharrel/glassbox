import { beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema, ThreadMessageSchema, type PullTab } from '../../../src/api/workspace.js';
const mocks = vi.hoisted(() => ({ data: { tabs: [] as PullTab[], archived: [] as PullTab[] }, save: vi.fn() }));
vi.mock('../../../src/workspace/storage.js', () => ({ workspaceData: () => mocks.data, saveWorkspace: mocks.save }));
import { postCodexReply } from '../../../src/workspace/codex-reply.js';
const chat = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const input = { url: 'https://github.com/owner/repo/pull/1', commentId: 'comment', threadId: chat, body: 'Fixed and pushed the signed commit. The focused tests pass.' };
beforeEach(() => {
  const comment = ThreadMessageSchema.parse({ id: 'comment', body: 'Fix it', kind: 'review', author: 'alice', date: '', path: 'src/file.ts', line: 10, side: 'new', annotationId: 'annotation', codex: { threadId: chat, status: 'queued', mode: 'queue' } });
  mocks.data.tabs = [PullTabSchema.parse({ key: 'owner/repo#1', ref: { owner: 'owner', repo: 'repo', number: 1, url: input.url }, repoRoot: null, reviewId: null, info: null, codexThreadId: chat, comments: [comment] })]; mocks.data.archived = [];
});
it('posts the original chat’s answer in the original comment thread and preserves its source anchor', () => {
  const id = postCodexReply(input); const comments = mocks.data.tabs[0].comments;
  expect(comments[1]).toMatchObject({ id, parentKey: 'comment', author: 'Codex', body: input.body, kind: 'ai', status: 'done', path: 'src/file.ts', line: 10, side: 'new', annotationId: 'annotation' });
  expect(comments[0].codex?.status).toBe('sent'); expect(comments[1].remoteId).toBeUndefined();
});
it('deduplicates identical retries without preventing a follow-up answer', () => {
  const first = postCodexReply(input); expect(postCodexReply(input)).toBe(first);
  expect(postCodexReply({ ...input, body: 'Added another regression test.' })).not.toBe(first);
  expect(mocks.data.tabs[0].comments).toHaveLength(3);
});
it('rejects another chat, wrong PR, deleted comment and remote-only comments', () => {
  expect(() => postCodexReply({ ...input, threadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })).toThrow('originating');
  expect(() => postCodexReply({ ...input, url: 'https://github.com/owner/repo/pull/2' })).toThrow('not found');
  delete mocks.data.tabs[0].comments[0].codex;
  expect(() => postCodexReply(input)).toThrow('originating');
  mocks.data.tabs[0].comments[0].deleted = true;
  expect(() => postCodexReply(input)).toThrow('not found');
});
it('allows an in-flight answer to reach a closed PR tab without reopening it', () => {
  mocks.data.archived = mocks.data.tabs; mocks.data.tabs = [];
  postCodexReply(input); expect(mocks.data.tabs).toHaveLength(0); expect(mocks.data.archived[0].comments).toHaveLength(2);
});
