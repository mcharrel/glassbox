import { expect, it } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';
import { CommentAuthor, codeCommentPlaceholder } from '../../../src/components/commentAuthor.js';
import { pullInfo } from '../workspace/fixtures.js';
it('uses ownership-aware instructions and leaves unknown ownership neutral', () => {
  const tab = PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: '' }, reviewId: null, repoRoot: null, viewer: 'alice', info: pullInfo() });
  expect(codeCommentPlaceholder(tab)).toBe('Leave a comment, agent will respond...');
  expect(codeCommentPlaceholder({ ...tab, info: pullInfo('bob') })).toBe('Post a comment on GitHub...');
  expect(codeCommentPlaceholder({ ...tab, info: null })).toBe('Leave a comment...');
  expect(codeCommentPlaceholder()).toBe('Leave a comment...');
});
it('shows GitHub avatars for authors and a neutral icon for agents or unknown users', () => {
  expect(String(CommentAuthor({ author: 'alice' }))).toContain('https://github.com/alice.png?size=48');
  expect(String(CommentAuthor({ author: 'build[bot]' }))).toContain('build%5Bbot%5D.png');
  expect(String(CommentAuthor({ author: 'Codex', agent: true }))).toContain('comment-avatar-fallback');
  expect(String(CommentAuthor({ author: 'You' }))).toContain('comment-avatar-fallback');
});
