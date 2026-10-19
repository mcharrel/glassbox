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
const tab = () => PullTabSchema.parse({ key: 'example/project#1', ref, info: null, reviewId: null, repoRoot: null, viewer: 'author' });
const pageInfo = { hasNextPage: false, endCursor: null };
const row = (id = 1) => ({ id: `comment-${id}`, fullDatabaseId: String(id), body: '**body**', bodyHTML: '<p><strong>body</strong></p>',
  author: { login: 'author' }, createdAt: '2026-01-01', url: `${ref.url}#discussion_r${id}`, commit: { oid: 'head' }, viewerCanDelete: true, state: 'SUBMITTED' });
const thread = (id = 1, isResolved = true) => ({ id: `thread-${id}`, isResolved, path: 'file.ts', line: 3, diffSide: 'RIGHT',
  comments: { nodes: [row(id)], pageInfo } });
const graph = (nodes: unknown[], info = pageInfo) => ({ data: { repository: { pullRequest: { reviewThreads: { nodes, pageInfo: info } } } } });
it('loads resolved threads and rendered bodies without increasing the normal request count', async () => {
  const fetch = vi.fn(async (url: string) => Response.json(url.endsWith('/graphql') ? graph([{ ...thread(), comments: { nodes: [{ ...row(), body: '**body**\n<!-- glassbox:local-inline -->' }, row(2)], pageInfo } }]) : [{ id: 1, body: '**body**\n<!-- glassbox:local-id -->', body_html: '<p><strong>body</strong></p>', user: { login: 'author' },
    html_url: `${ref.url}#comment`, created_at: '2026-01-01', submitted_at: '2026-01-01', state: 'COMMENTED' }]));
  vi.stubGlobal('fetch', fetch);
  const comments = await loadComments(tab());
  expect(fetch).toHaveBeenCalledTimes(3); expect(comments).toHaveLength(4);
  expect(comments[1]).toMatchObject({ id: 'local-inline', body: '**body**', resolved: true, line: 3, remoteId: 1, editable: true });
  expect(comments[2]).toMatchObject({ remoteId: 2, parentId: 1, resolved: true });
  for (const comment of comments) expect(comment.bodyHTML).toBe('<p><strong>body</strong></p>');
  expect(comments[0].resolved).toBeUndefined(); expect(comments[3].resolved).toBeUndefined();
});
it('retains GitHub bot identity for both issue comments and submitted review summaries', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/graphql') ? graph([]) : [
    { id: 1, body: 'Automated report', user: { login: 'automation', type: 'Bot' }, html_url: `${ref.url}#comment`,
      created_at: '2026-01-01', submitted_at: '2026-01-01', state: 'COMMENTED' },
    { id: 2, body: 'Human comment', user: { login: 'alice', type: 'User' }, html_url: `${ref.url}#comment`,
      created_at: '2026-01-02', submitted_at: '2026-01-02', state: 'COMMENTED' },
  ])));
  expect((await loadComments(tab())).map(comment => comment.authorIsBot)).toEqual([true, false, true, false]);
});
it('paginates both threads and long conversations, retaining root identity and unresolved state', async () => {
  const fetch = vi.fn(async (url: string, options: RequestInit) => {
    if (!url.endsWith('/graphql')) return Response.json([]);
    const { variables } = JSON.parse(String(options.body));
    if (variables.id) return Response.json({ data: { node: { comments: { nodes: [row(2)], pageInfo } } } });
    return Response.json(variables.cursor ? graph([thread(3, false)]) : graph([
      { ...thread(), comments: { nodes: [row()], pageInfo: { hasNextPage: true, endCursor: 'more-comments' } } },
    ], { hasNextPage: true, endCursor: 'more-threads' }));
  }); vi.stubGlobal('fetch', fetch);
  const comments = await loadComments(tab());
  expect(comments.map(c => [c.remoteId, c.parentId, c.resolved])).toEqual([[1, undefined, true], [2, 1, true], [3, undefined, false]]);
  const variables = fetch.mock.calls.filter(([url]) => url.endsWith('/graphql')).map(([, opts]) => JSON.parse(String(opts.body)).variables);
  expect(variables).toContainEqual({ id: 'thread-1', cursor: 'more-comments' });
  expect(variables).toContainEqual({ owner: 'example', repo: 'project', number: 1, cursor: 'more-threads' });
});
it('keeps current anchors, handles deleted authors and missing numeric IDs, and excludes unpublished comments', async () => {
  const fetch = vi.fn(async (url: string) => Response.json(url.endsWith('/graphql') ? graph([null,
    { ...thread(), line: null, diffSide: 'LEFT', comments: { nodes: [null, { ...row(9), state: 'PENDING' },
      { ...row(10), author: null, fullDatabaseId: null }, { ...row(11), fullDatabaseId: '9000000000', viewerCanDelete: false }], pageInfo } },
    { ...thread(3), comments: { nodes: [], pageInfo } },
  ]) : [])); vi.stubGlobal('fetch', fetch);
  const comments = await loadComments(tab());
  expect(comments).toHaveLength(2);
  expect(comments[0]).toMatchObject({ id: 'github-review-comment-10', author: 'ghost', editable: false, line: null, side: 'old' });
  expect(comments[1]).toMatchObject({ remoteId: 9000000000, parentKey: comments[0].id, editable: false });
});
it.each([graph([]), graph([null, { ...thread(), comments: { nodes: [{ ...row(), state: 'PENDING' }], pageInfo } }])])('accepts an empty or entirely filtered thread collection', async result => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/graphql') ? result : [])));
  expect(await loadComments(tab())).toEqual([]);
});
it.each([{ errors: [{ message: 'Unavailable' }] }, graph([], { hasNextPage: true, endCursor: null })])('rejects incomplete snapshots rather than deleting cached comments', async result => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(url.endsWith('/graphql') ? result : [])));
  await expect(loadComments(tab())).rejects.toThrow();
});
