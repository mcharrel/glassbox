import { beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema, ThreadMessageSchema } from '../../../src/api/workspace.js';
import { pullInfo } from '../workspace/fixtures.js';
const mocks = vi.hoisted(() => ({ active: vi.fn() }));
vi.mock('../../../src/client/workspace/state.js', () => ({ activeTab: mocks.active }));
vi.mock('../../../src/client/diff/find.js', () => ({ refreshFind: vi.fn() }));
vi.mock('../../../src/client/stores/index.js', () => ({ reviewStore: {} }));
import { threadHtml } from '../../../src/client/workspace/threads.js';
const root = () => ThreadMessageSchema.parse({ id: 'root', author: 'alice', body: 'Request', date: '', kind: 'issue', status: 'done', destination: 'local' });
beforeEach(() => mocks.active.mockReturnValue(PullTabSchema.parse({ key: 'example/project#1', info: pullInfo(), viewer: 'alice', ref: { owner: 'example', repo: 'project', number: 1, url: '' }, reviewId: null, repoRoot: null })));
it('shows local follow-ups and Codex answers without a GitHub ID, share button or offline marker', () => {
  const r = root(); const followup = { ...r, id: 'followup', parentKey: r.id, body: 'Follow-up' };
  const answer = { ...r, id: 'answer', parentKey: followup.id, author: 'Codex', body: 'Fixed', kind: 'ai' as const };
  const html = String(threadHtml(r, [r, followup, answer]));
  expect(html).toContain('data-parent-key="root"'); expect(html).toContain('Reply locally');
  expect(html).toContain('Follow-up'); expect(html).toContain('Fixed'); expect(html).toContain('>Local<');
  expect(html).not.toContain('comment-share'); expect(html).not.toContain('comment-offline');
  expect(html.match(/data-message="followup"/g)).toHaveLength(1);
});
it('uses GitHub reply IDs on another PR and does not expose local reply controls', () => {
  mocks.active().info = pullInfo('bob');
  const r = { ...root(), kind: 'review' as const, destination: 'github' as const, remoteId: 123, status: 'synced' as const, url: 'https://github.com/example/project/pull/1#discussion_r123' };
  const html = String(threadHtml(r, [r]));
  expect(html).toContain('data-reply-to="123"'); expect(html).toContain('Reply on GitHub');
  expect(html).toContain('comment-share'); expect(html).not.toContain('data-parent-key');
});
