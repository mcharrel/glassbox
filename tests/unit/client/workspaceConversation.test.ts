import { expect, it, vi } from 'vitest';
import { PullTabSchema, ThreadMessageSchema } from '../../../src/api/workspace.js';
vi.mock('../../../src/client/workspace/state.js', () => ({ activeTab: () => undefined }));
vi.mock('../../../src/client/diff/find.js', () => ({ refreshFind: vi.fn() }));
vi.mock('../../../src/client/stores/index.js', () => ({ reviewStore: {} }));
import { conversation } from '../../../src/client/workspace/conversation.js';
const message = (id: number, authorIsBot?: boolean) => ThreadMessageSchema.parse({ id: String(id), author: `user-${id}`, authorIsBot,
  kind: 'issue', date: `2026-01-${String(id).padStart(2, '0')}`, body: `Comment ${id}` });
const tab = () => PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: '' }, info: null, reviewId: null, repoRoot: null });
it('keeps zero, human-only and entirely deleted conversations unfolded', () => {
  const t = tab(); expect(String(conversation(t))).toBe('');
  t.comments = [message(1), message(2, false), { ...message(3, true), deleted: true }];
  const html = String(conversation(t));
  expect(html).not.toContain('<details'); expect(html).not.toContain('Comment 3');
  expect(html.indexOf('Comment 2')).toBeLessThan(html.indexOf('Comment 1'));
  t.comments.forEach(m => { m.deleted = true; }); expect(String(conversation(t))).toBe('');
});
it('folds adjacent bot comments together without crossing humans or changing order', () => {
  const t = tab(); t.comments = [message(1, true), message(4, true), message(3, false), message(2, true), message(5, true)];
  const html = String(conversation(t));
  expect(html.match(/<details/g)).toHaveLength(2);
  expect(html.match(/>2 bot comments</g)).toHaveLength(2);
  expect(html).not.toMatch(/<details[^>]*\sopen(?:\s|=|>)/);
  expect(html.indexOf('</details>')).toBeLessThan(html.indexOf('Comment 3'));
  expect(html.indexOf('Comment 3')).toBeLessThan(html.lastIndexOf('<details'));
  expect(html.indexOf('Comment 5')).toBeLessThan(html.indexOf('Comment 4'));
  expect(html).toContain('data-message="1"'); // Search can still reveal the retained body.
  const key = 'data-key="example/project#1:bots:4"';
  expect(html).toContain(key);
  t.comments.push(message(6, true)); expect(String(conversation(t))).toContain(key);
});
it('supports older canonical bot names but never guesses unknown accounts', () => {
  const t = tab(); t.comments = [{ ...message(1), author: 'automation[bot]' }];
  expect(String(conversation(t))).toContain('1 bot comment');
  t.comments[0].authorIsBot = false; expect(String(conversation(t))).not.toContain('<details');
  t.comments = [{ ...message(1), author: 'robot-assistant' }]; expect(String(conversation(t))).not.toContain('<details');
});
it('keeps human replies visible even when nested under a bot and received out of order', () => {
  const t = tab(); const root = message(1, true);
  const botReply = { ...message(2, true), parentKey: root.id };
  const humanReply = { ...message(3, false), parentKey: botReply.id };
  t.comments = [humanReply, botReply, root];
  expect(String(conversation(t))).not.toContain('<details');
  expect(String(conversation(t))).toContain('Comment 3');
  humanReply.deleted = true; expect(String(conversation(t))).toContain('1 bot comment');
  root.kind = 'review'; expect(String(conversation(t))).toBe('');
});
