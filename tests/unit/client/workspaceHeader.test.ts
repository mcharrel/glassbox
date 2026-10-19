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
  expect(html).not.toContain('-&gt; ');
  expect(html).toContain('<option value="draft" selected');
  expect(html).not.toContain('data-pr-action="draft"');
});
it('shows a stacked target on a separate line', () => {
  expect(String(pullHeader(tab('parent-branch'), null))).toContain('<div>my-branch</div><div>-&gt; parent-branch</div>');
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

it('reflects the viewer’s submitted review through comments, pending drafts, dismissal and account changes', () => {
  const t = tab('main', 'someone');
  const review = (state: string, submittedAt: string | null, login = 'ME') => ({ author: { login }, state, submittedAt });
  t.info!.reviews = [review('APPROVED', '2026-01-01')];
  let html = String(pullHeader(t, null));
  expect(html).toContain('pr-review-approved'); expect(html).toContain('selected disabled>Approved');
  t.info!.reviews.push(review('COMMENTED', '2026-01-03'), review('PENDING', null), review('CHANGES_REQUESTED', '2026-01-04', 'someone-else'));
  expect(String(pullHeader(t, null))).toContain('selected disabled>Approved');
  t.info!.reviews.unshift(review('CHANGES_REQUESTED', '2026-01-05'));
  html = String(pullHeader(t, null));
  expect(html).toContain('pr-review-changes'); expect(html).toContain('selected disabled>Changes requested');
  t.info!.reviews.push(review('DISMISSED', '2026-01-06'));
  expect(String(pullHeader(t, null))).toContain('selected disabled>Review');
  t.viewer = 'new-viewer'; t.action = 'approve'; t.info!.reviewDecision = 'APPROVED';
  expect(String(pullHeader(t, null))).toContain('selected disabled>Review');
  t.viewer = ''; expect(String(pullHeader(t, null))).not.toContain('pr-review-approved');
});
