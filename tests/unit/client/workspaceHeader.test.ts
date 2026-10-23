import { afterEach, expect, it, vi } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';
const toast = vi.hoisted(() => vi.fn());
vi.mock('../../../src/client/toast.js', () => ({ showToast: toast }));
import { copyPullLink, pullHeader } from '../../../src/client/workspace/header.js';
afterEach(() => { vi.unstubAllGlobals(); toast.mockClear(); });

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

it('separates Slack failure and retry from the accepted GitHub review', () => {
  const t = tab('main', 'someone');
  t.info!.reviews = [{ author: { login: 'me' }, state: 'APPROVED', submittedAt: '2026-01-01' }];
  t.slackReaction = { status: 'error', review: 'APPROVED', reviewer: 'me', count: 0, message: 'Slack unavailable' };
  const html = String(pullHeader(t, null));
  expect(html).toContain('selected disabled>Approved');
  expect(html).toContain('Slack unavailable'); expect(html).toContain('data-workspace="retry-slack"');
});

it('places refresh progress before Share, with Close still immediately after Share', () => {
  for (const refreshing of [false, true]) {
    const t = tab(); t.loading = !refreshing;
    const html = String(pullHeader(t, null, refreshing));
    expect(html.indexOf('aria-label="Refreshing PR"')).toBeLessThan(html.indexOf('data-workspace="share"'));
    expect(html.indexOf('data-workspace="share"')).toBeLessThan(html.indexOf('data-workspace="close"'));
  }
  expect(String(pullHeader(tab(), null))).not.toContain('aria-label="Refreshing PR"');
});
it('shows closing progress inside the disabled close button without disabling Share', () => {
  const html = String(pullHeader(tab(), null, false, true));
  expect(html).toContain('data-workspace="close" title="Closing PR tab…" disabled');
  expect(html).toContain('aria-label="Closing PR tab"');
  expect(html).toContain('data-workspace="share" title="Copy PR link" aria-label="Share PR: copy GitHub link">');
  expect(String(pullHeader(tab(), null))).not.toContain('aria-label="Closing PR tab"');
});
it('anchors the copy confirmation to the clicked PR and does not show it after switching away', async () => {
  const feedback = { isConnected: true };
  const button = { closest: () => ({ querySelector: () => feedback }) } as unknown as Element;
  let finish!: () => void;
  const copy = vi.fn().mockResolvedValueOnce(undefined).mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  vi.stubGlobal('navigator', { clipboard: { writeText: copy } });
  const t = tab(); t.ref.url = 'https://github.com/example/project/pull/1';
  await copyPullLink(t, button);
  expect(copy).toHaveBeenCalledWith(t.ref.url);
  expect(toast).toHaveBeenCalledExactlyOnceWith('Link copied!', { container: feedback, className: 'pr-share-toast' });
  const pending = copyPullLink(t, button);
  feedback.isConnected = false; finish(); await pending;
  expect(toast).toHaveBeenCalledOnce();
  const html = String(pullHeader(t, null));
  expect(html).toContain('data-key="share:example/project#1"');
  expect(html).toContain('data-morph-skip-children=""');
});

it('offers Merge only for own PRs and disables it for drafts and closed PRs', () => {
  const own = tab('main', 'me', 'OPEN', false); own.reviewedHead = 'reviewed-head';
  const html = String(pullHeader(own, null));
  expect(html).toContain('<option value="merge">Merge</option>');
  expect(html).toContain('data-merge-head="reviewed-head"');
  expect(String(pullHeader(tab(), null))).toContain('<option value="merge" disabled>Merge</option>');
  expect(String(pullHeader(tab('main', 'me', 'CLOSED', false), null))).toContain('<option value="merge" disabled>Merge</option>');
  expect(String(pullHeader(tab('main', 'other', 'OPEN', false), null))).not.toContain('value="merge"');
  const busy = String(pullHeader(own, null, false, false, true));
  expect(busy).toContain('disabled aria-busy="true">Merging…'); expect(busy).not.toContain('<select');
  expect(busy).toContain('data-workspace="share"');
});
