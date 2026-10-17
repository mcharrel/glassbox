import { expect, it } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';
import { pullHeader } from '../../../src/client/workspace/header.js';

function tab(base = 'main', author = 'me', state = 'OPEN', draft = true) {
  return PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: '' },
    reviewId: 'review', repoRoot: '/repo', viewer: 'me', info: { id: 'PR1', number: 1, url: '', title: 'Title', body: '',
      author: { login: author }, state, isDraft: draft, baseRefName: base, headRefName: 'my-branch', baseRefOid: 'base', headRefOid: 'head', mergeable: 'MERGEABLE', mergedAt: null } });
}
it.each(['main', 'prod'])('places totals above the PR branch and omits the ordinary %s target', base => {
  const html = String(pullHeader(tab(base), { added: 12, removed: 3 }));
  expect(html.indexOf('+12')).toBeLessThan(html.indexOf('my-branch'));
  expect(html).not.toContain('into ');
  expect(html).toContain('<option value="draft" selected');
  expect(html).not.toContain('data-pr-action="draft"');
});
it('shows a stacked target on a separate line', () => {
  expect(String(pullHeader(tab('parent-branch'), null))).toContain('<div>my-branch</div><div>into parent-branch</div>');
});
it('keeps other PRs under Review and offers the human-readable explanation request', () => {
  const html = String(pullHeader(tab('main', 'someone'), null));
  expect(html).toContain('selected disabled>Review');
  expect(html).toContain('Make explanations more human');
  expect(html).toContain('Request code change');
  expect(html).not.toContain('data-workspace="title"');
});
it('keeps merged PRs disabled without action choices', () => {
  const html = String(pullHeader(tab('main', 'me', 'MERGED'), null));
  expect(html).toContain('disabled>Merged');
  expect(html).not.toContain('<select');
});
