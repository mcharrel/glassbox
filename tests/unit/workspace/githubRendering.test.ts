import { afterEach, expect, it, vi } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';
import { pullInfo } from './fixtures.js';
vi.mock('node:child_process', () => ({ execFile: Object.assign(vi.fn(), {
  [Symbol.for('nodejs.util.promisify.custom')]: async () => ({ stdout: 'fixture-token', stderr: '' }),
}) }));
vi.mock('node:fs', () => ({ readFileSync: () => '{}' }));
import { loadComments, loadPull, parsePullUrl } from '../../../src/workspace/github.js';
const ref = parsePullUrl('https://github.com/example/project/pull/1');
afterEach(() => vi.unstubAllGlobals());
it('fetches rendered descriptions, reviewers and check results in one metadata request', async () => {
  const info = pullInfo();
  const fetch = vi.fn(async () => Response.json({ data: { repository: { pullRequest: { ...info, bodyHTML: '<h1>Description</h1>',
    reviewRequests: { nodes: [{ requestedReviewer: { login: 'reviewer' } }, { requestedReviewer: { name: 'team' } }, { requestedReviewer: null }] },
    reviews: { nodes: [{ author: { login: 'reviewer' }, state: 'APPROVED', submittedAt: '2026-01-01' }] },
    commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ name: 'Build', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://example.test' }, { context: 'External', state: 'PENDING', targetUrl: 'https://example.test' }] } } } }] },
  } } } })); vi.stubGlobal('fetch', fetch);
  const result = await loadPull(ref);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.bodyHTML).toBe('<h1>Description</h1>'); expect(result.body).toBe(info.body);
  expect(result.reviewRequests).toEqual([{ login: 'reviewer' }, { name: 'team' }]);
  expect(result.reviews[0].state).toBe('APPROVED'); expect(result.statusCheckRollup).toHaveLength(2);
  expect(JSON.parse(fetch.mock.calls[0][1].body).query).toContain('bodyHTML');
});
it('keeps null authors and absent check rollups usable, and surfaces GraphQL errors', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ data: { repository: { pullRequest: { ...pullInfo(), author: null,
    reviewRequests: { nodes: [] }, reviews: { nodes: [] }, commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
  } } } })).mockResolvedValueOnce(Response.json({ errors: [{ message: 'Not accessible' }] })); vi.stubGlobal('fetch', fetch);
  expect(await loadPull(ref)).toMatchObject({ author: { login: 'ghost' }, statusCheckRollup: [], reviews: [], reviewRequests: [] });
  await expect(loadPull(ref)).rejects.toThrow('Not accessible');
});
it('gets editable source and rendered HTML for issue, inline and review comments without extra calls', async () => {
  const fetch = vi.fn(async (url: string) => Response.json([{ id: 1, body: '**body**\n<!-- glassbox:local-id -->', body_html: '<p><strong>body</strong></p>', user: { login: 'author' },
    html_url: 'https://github.com/example/project/pull/1#comment', created_at: '2026-01-01', submitted_at: '2026-01-01', state: 'COMMENTED',
    ...(url.includes('/pulls/1/comments') ? { path: 'file.ts', line: 3, side: 'RIGHT' } : {}),
  }])); vi.stubGlobal('fetch', fetch);
  const tab = PullTabSchema.parse({ key: 'example/project#1', ref, info: null, reviewId: null, repoRoot: null, viewer: 'author' });
  const comments = await loadComments(tab);
  expect(fetch).toHaveBeenCalledTimes(3); expect(comments).toHaveLength(3);
  for (const call of fetch.mock.calls) expect(call[1].headers.Accept).toBe('application/vnd.github.full+json');
  for (const comment of comments) expect(comment.bodyHTML).toBe('<p><strong>body</strong></p>');
  expect(comments[0].body).toBe('**body**'); expect(comments[1]).toMatchObject({ path: 'file.ts', line: 3 });
});
