import { beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema, ThreadMessageSchema } from '../../../src/api/workspace.js';
import { pullInfo } from '../workspace/fixtures.js';
const mocks = vi.hoisted(() => ({ active: vi.fn() }));
vi.mock('../../../src/client/workspace/state.js', () => ({ activeTab: mocks.active }));
vi.mock('../../../src/client/diff/find.js', () => ({ refreshFind: vi.fn() }));
vi.mock('../../../src/client/stores/index.js', () => ({ reviewStore: {} }));
import { messageHtml, threadHtml } from '../../../src/client/workspace/threads.js';
const root = () => ThreadMessageSchema.parse({ id: 'root', author: 'alice', body: 'Request', date: '', kind: 'review', path: 'file.ts', status: 'done', destination: 'local' });
beforeEach(() => mocks.active.mockReturnValue(PullTabSchema.parse({ key: 'example/project#1', info: pullInfo(), viewer: 'alice', ref: { owner: 'example', repo: 'project', number: 1, url: '' }, reviewId: null, repoRoot: null })));
it('shows local follow-ups and Codex answers without a GitHub ID, share button or offline marker', () => {
  const r = root(); const followup = { ...r, id: 'followup', parentKey: r.id, body: 'Follow-up' };
  const answer = { ...r, id: 'answer', parentKey: followup.id, author: 'Codex', body: 'Fixed', kind: 'ai' as const };
  const html = String(threadHtml(r, [r, followup, answer]));
  expect(html).toContain('data-parent-key="root"'); expect(html).toContain('Leave a comment, agent will respond...');
  expect(html).toContain('Follow-up'); expect(html).toContain('Fixed'); expect(html).toContain('>Local<');
  expect(html).not.toContain('comment-share'); expect(html).not.toContain('comment-offline');
  expect(html.match(/data-message="followup"/g)).toHaveLength(1);
});
it('uses GitHub reply IDs on another PR and does not expose local reply controls', () => {
  mocks.active().info = pullInfo('bob');
  const r = { ...root(), kind: 'review' as const, destination: 'github' as const, remoteId: 123, status: 'synced' as const, url: 'https://github.com/example/project/pull/1#discussion_r123' };
  const html = String(threadHtml(r, [r]));
  expect(html).toContain('data-reply-to="123"'); expect(html).toContain('Post a comment on GitHub...');
  expect(html).toContain('comment-share'); expect(html).not.toContain('data-parent-key');
});
it('shows Main comments on own PRs as public without local reply controls', () => {
  const r = { ...root(), kind: 'issue' as const, path: undefined, destination: 'github' as const,
    remoteId: 124, status: 'synced' as const, url: 'https://github.com/example/project/pull/1#issuecomment-124' };
  const html = String(threadHtml(r, [r]));
  expect(html).toContain('comment-share');
  expect(html).not.toContain('Leave a comment, agent will respond...'); expect(html).not.toContain('data-parent-key');
  expect(html).not.toContain('>Local<'); expect(html).not.toContain('Codex');
});

it.each([
  ['pending', 'Pending pickup'], ['processing', 'Agent working'], ['answered', 'Answered'],
] as const)('shows the %s agent band with an accessible status label', (status, label) => {
  const r = { ...root(), agentStatus: status };
  const html = String(messageHtml(r));
  expect(html).toContain(`data-agent-status="${status}"`);
  expect(html).toContain('role="status"'); expect(html).toContain(label);
  expect(html).toContain('data-code-comment="true"');
});
it('shows unacknowledged delivery as pending and omits agent status on GitHub comments and AI replies', () => {
  const r = root();
  r.codex = { threadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'sent', mode: 'queue' };
  expect(String(messageHtml(r))).toContain('Pending pickup');
  expect(String(messageHtml({ ...r, destination: 'github' }))).not.toContain('data-agent-status');
  expect(String(messageHtml({ ...r, kind: 'ai' }))).not.toContain('data-agent-status');
  expect(String(messageHtml({ ...r, kind: 'issue' }))).not.toContain('data-agent-status');
});

it('shows an avatar before the author and never makes posted messages editable', () => {
  const html = String(messageHtml({ ...root(), editable: true }));
  expect(html).toContain('https://github.com/alice.png?size=48');
  expect(html.indexOf('comment-avatar')).toBeLessThan(html.indexOf('<strong>alice</strong>'));
  expect(html).not.toContain('data-editable');
  expect(html).toContain('data-comment-action="delete"');
  const agent = String(messageHtml({ ...root(), kind: 'ai', author: 'Codex' }));
  expect(agent).toContain('comment-avatar-fallback');
  expect(agent).not.toContain('github.com/Codex');
});

it('folds a resolved code thread and its replies together, keeping searchable content', () => {
  const r = { ...root(), resolved: true, destination: 'github' as const, remoteId: 123 };
  const reply = { ...r, id: 'reply', remoteId: 124, parentId: 123, body: 'Reply text' };
  const html = String(threadHtml(r, [r, reply]));
  expect(html).toContain('<details class="resolved-thread"');
  expect(html).toContain('>Resolved</span>');
  expect(html).not.toMatch(/<details[^>]*\sopen(?:\s|=|>)/);
  expect(html).toContain('Request'); expect(html).toContain('Reply text');
  expect(html.match(/data-comment-thread=/g)).toHaveLength(1);
  expect(html.indexOf('<summary>')).toBeLessThan(html.indexOf('data-message="root"'));
  expect(html.indexOf('data-message="reply"')).toBeLessThan(html.indexOf('</details>'));
  expect(String(threadHtml(r, [r, reply], true))).toMatch(/<details[^>]*\sopen(?:\s|=|>)/);
});

it('unfolds reopened threads and leaves unresolved code and Main comments unchanged', () => {
  for (const r of [root(), { ...root(), resolved: false }, { ...root(), kind: 'issue' as const, resolved: true }]) {
    const html = String(threadHtml(r, [r], true));
    expect(html).not.toContain('class="resolved-thread"'); expect(html).toContain('Request');
  }
});
