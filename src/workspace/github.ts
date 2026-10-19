import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod';

import { PullInfoSchema, type PullRef, type PullTab, type ThreadMessage } from '../api/workspace.js';
import { githubAccount } from './accounts.js';

const exec = promisify(execFile);
export { localWorkspaceConfig } from './accounts.js';
export function parsePullUrl(input: string): PullRef {
  const match = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?=$|[/?#\s])/i.exec(input.trim());
  if (!match || Number(match[3]) < 1) throw new Error('Paste a GitHub pull request URL');
  return {
    owner: match[1],
    repo: match[2],
    number: Number(match[3]),
    url: `https://github.com/${match[1]}/${match[2]}/pull/${Number(match[3])}`,
  };
}
export function pullKey(ref: PullRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`.toLowerCase();
}
const tokens = new Map<string, { value: string; until: number }>();
export async function githubToken(ref: PullRef): Promise<string> {
  const account = githubAccount(ref);
  const cached = tokens.get(account);
  if (cached && cached.until > Date.now()) return cached.value;
  const { stdout } = await exec(
    'gh',
    ['auth', 'token', '--hostname', 'github.com', ...(account ? ['--user', account] : [])],
    { timeout: 15000 },
  );
  if (account !== githubAccount(ref)) throw new Error('GitHub account changed; retry this request.');
  const value = stdout.trim();
  tokens.set(account, { value, until: Date.now() + 300_000 });
  return value;
}
export async function github(ref: PullRef, path: string, method = 'GET', body?: unknown, accept = 'application/vnd.github+json'): Promise<unknown> {
  const account = githubAccount(ref);
  const token = await githubToken(ref);
  if (account !== githubAccount(ref)) throw new Error('GitHub account changed; retry this request.');
  const response = await fetch(`https://api.github.com/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: accept,
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  // Keep receipts for writes already accepted by GitHub, but discard stale identity reads.
  if (['GET', 'HEAD'].includes(method) && account !== githubAccount(ref)) throw new Error('GitHub account changed; retry this request.');
  if (!response.ok) {
    const error = z.object({ message: z.string() }).safeParse(await response.json().catch(() => null));
    throw new Error(`GitHub ${response.status}: ${error.success ? error.data.message : response.statusText}`);
  }
  return response.status === 204 ? null : response.json();
}
export const repoApi = (ref: PullRef) => `repos/${ref.owner}/${ref.repo}`;
const PullGraphSchema = PullInfoSchema.omit({ reviewRequests: true, reviews: true, statusCheckRollup: true }).extend({
  author: z.object({ login: z.string() }).nullable(),
  reviewRequests: z.object({ nodes: z.array(z.object({ requestedReviewer: z.object({ login: z.string().optional(), name: z.string().optional() }).nullable() })) }),
  reviews: z.object({ nodes: PullInfoSchema.shape.reviews }),
  commits: z.object({ nodes: z.array(z.object({ commit: z.object({ statusCheckRollup: z.object({ contexts: z.object({ nodes: PullInfoSchema.shape.statusCheckRollup }) }).nullable() }) })) }),
});
export async function loadPull(ref: PullRef) {
  // Fetch rendered description in the same metadata request, without per-body Markdown API calls.
  const result = z.object({
    data: z.object({ repository: z.object({ pullRequest: PullGraphSchema.nullable() }).nullable() }).nullish(),
    errors: z.array(z.object({ message: z.string() })).optional(),
  }).parse(await github(ref, 'graphql', 'POST', {
    query: `query($owner:String!,$repo:String!,$number:Int!) {
      repository(owner:$owner,name:$repo) { pullRequest(number:$number) {
        id number url title body bodyHTML author { login } state isDraft
        baseRefName headRefName baseRefOid headRefOid mergeable mergeStateStatus reviewDecision mergedAt
        reviewRequests(first:100) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
        reviews(last:100) { nodes { author { login } state submittedAt } }
        commits(last:1) { nodes { commit { statusCheckRollup { contexts(first:100) { nodes {
          ... on CheckRun { name status conclusion detailsUrl }
          ... on StatusContext { context state targetUrl }
        } } } } } }
      } }
    }`,
    variables: { owner: ref.owner, repo: ref.repo, number: ref.number },
  }));
  if (result.errors !== undefined && result.errors.length > 0) throw new Error(result.errors.map(error => error.message).join('; '));
  const pull = result.data?.repository?.pullRequest;
  if (!pull) throw new Error('Pull request not found');
  return PullInfoSchema.parse({ ...pull, author: pull.author ?? { login: 'ghost' },
    reviewRequests: pull.reviewRequests.nodes.flatMap(node => node.requestedReviewer ? [node.requestedReviewer] : []),
    reviews: pull.reviews.nodes,
    statusCheckRollup: pull.commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [],
  });
}
export const RemoteCommentSchema = z.object({
  id: z.number(),
  body: z.string().nullable(),
  body_html: z.string().nullable().optional(),
  user: z.object({ login: z.string() }).nullable(),
  created_at: z.string(),
  html_url: z.string(),
  path: z.string().optional(),
  line: z.number().nullable().optional(),
  original_line: z.number().nullable().optional(),
  side: z.string().optional(),
  commit_id: z.string().optional(),
  in_reply_to_id: z.number().optional(),
});
const PageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const ReviewCommentSchema = z.object({
  id: z.string(), fullDatabaseId: z.union([z.string().regex(/^\d+$/), z.number()]).transform(Number).pipe(z.number().int().positive()).nullable(),
  body: z.string(), bodyHTML: z.string(), author: z.object({ login: z.string() }).nullable(),
  createdAt: z.string(), url: z.string(), commit: z.object({ oid: z.string() }).nullable(),
  viewerCanDelete: z.boolean(), state: z.string(),
});
const ReviewCommentsSchema = z.object({ nodes: z.array(ReviewCommentSchema.nullable()), pageInfo: PageInfoSchema });
const ReviewThreadSchema = z.object({
  id: z.string(), isResolved: z.boolean(), path: z.string(), line: z.number().nullable(),
  diffSide: z.enum(['LEFT', 'RIGHT']), comments: ReviewCommentsSchema,
});
const reviewCommentFields = `nodes { id fullDatabaseId body bodyHTML author { login } createdAt url
  commit { oid } viewerCanDelete state } pageInfo { hasNextPage endCursor }`;
function nextCursor(page: z.infer<typeof PageInfoSchema>, previous: string | null): string | null {
  if (!page.hasNextPage) return null;
  if (page.endCursor === null || page.endCursor === previous) throw new Error('GitHub returned an incomplete comment page');
  return page.endCursor;
}
async function reviewGraph(ref: PullRef, query: string, variables: Record<string, unknown>): Promise<unknown> {
  const result = z.object({ data: z.unknown().optional(), errors: z.array(z.object({ message: z.string() })).optional() })
    .parse(await github(ref, 'graphql', 'POST', { query, variables }));
  if (result.errors !== undefined && result.errors.length > 0) throw new Error(result.errors.map(error => error.message).join('; '));
  return result.data;
}
/** GraphQL replaces the inline-comment REST read, adding resolution without another polling request. */
async function loadReviewThreads(ref: PullRef): Promise<ThreadMessage[]> {
  const result: ThreadMessage[] = [];
  let cursor: string | null = null;
  do {
    const data = z.object({ repository: z.object({ pullRequest: z.object({ reviewThreads: z.object({
      nodes: z.array(ReviewThreadSchema.nullable()), pageInfo: PageInfoSchema,
    }) }) }) }).parse(await reviewGraph(ref, `query($owner:String!,$repo:String!,$number:Int!,$cursor:String) {
      repository(owner:$owner,name:$repo) { pullRequest(number:$number) { reviewThreads(first:100,after:$cursor) {
        nodes { id isResolved path line diffSide comments(first:100) { ${reviewCommentFields} } }
        pageInfo { hasNextPage endCursor }
      } } }
    }`, { owner: ref.owner, repo: ref.repo, number: ref.number, cursor }));
    const page = data.repository.pullRequest.reviewThreads;
    for (const thread of page.nodes) {
      if (!thread) continue;
      const rows = [...thread.comments.nodes];
      let commentCursor = nextCursor(thread.comments.pageInfo, null);
      while (commentCursor !== null) {
        const more = z.object({ node: z.object({ comments: ReviewCommentsSchema }) }).parse(await reviewGraph(ref,
          `query($id:ID!,$cursor:String!) { node(id:$id) { ... on PullRequestReviewThread {
            comments(first:100,after:$cursor) { ${reviewCommentFields} }
          } } }`, { id: thread.id, cursor: commentCursor })).node.comments;
        rows.push(...more.nodes);
        commentCursor = nextCursor(more.pageInfo, commentCursor);
      }
      let root: ThreadMessage | undefined;
      for (const row of rows) {
        if (!row || row.state === 'PENDING') continue;
        const message: ThreadMessage = {
          id: /<!-- glassbox:([\w-]+) -->/.exec(row.body)?.[1] ?? `github-review-${row.fullDatabaseId ?? row.id}`,
          remoteId: row.fullDatabaseId ?? undefined,
          body: row.body.replace(/\n?<!-- glassbox:[\w-]+ -->/g, '').trimEnd(), bodyHTML: row.bodyHTML,
          author: row.author?.login ?? 'ghost', date: row.createdAt, url: row.url, kind: 'review',
          path: thread.path, line: thread.line, side: thread.diffSide === 'LEFT' ? 'old' : 'new',
          commit: row.commit?.oid, resolved: thread.isResolved, status: 'synced', deleted: false,
          editable: row.viewerCanDelete && row.fullDatabaseId !== null,
          ...(root ? root.remoteId !== undefined ? { parentId: root.remoteId } : { parentKey: root.id } : {}),
        };
        root ??= message;
        result.push(message);
      }
    }
    cursor = nextCursor(page.pageInfo, cursor);
  } while (cursor !== null);
  return result;
}
export async function loadComments(tab: PullTab): Promise<ThreadMessage[]> {
  const groups = await Promise.all(
    [loadReviewThreads(tab.ref), (async () => {
      const kind = 'issue' as const;
      const endpoint = `issues/${tab.ref.number}/comments`;
      const result: ThreadMessage[] = [];
      for (let page = 1; ; page++) {
        const rows = z
          .array(RemoteCommentSchema)
          .parse(await github(tab.ref, `${repoApi(tab.ref)}/${endpoint}?per_page=100&page=${page}`, 'GET', undefined, 'application/vnd.github.full+json'));
        result.push(
          ...rows.map((row) => ({
            id: /<!-- glassbox:([\w-]+) -->/.exec(row.body ?? '')?.[1] ?? `github-${kind}-${row.id}`,
            remoteId: row.id,
            body: (row.body ?? '').replace(/\n?<!-- glassbox:[\w-]+ -->/g, '').trimEnd(),
            bodyHTML: row.body_html ?? undefined,
            author: row.user?.login ?? 'ghost',
            date: row.created_at,
            url: row.html_url,
            kind,
            parentId: row.in_reply_to_id,
            path: row.path,
            line: row.line,
            side: row.side === 'LEFT' ? ('old' as const) : ('new' as const),
            commit: row.commit_id,
            status: 'synced' as const,
            editable: row.user?.login === tab.viewer,
            deleted: false,
          })),
        );
        if (rows.length < 100) break;
      }
      return result;
    })()],
  );
  // Submitted review bodies appear in the conversation too; they are decisions, not editable issue comments.
  const summaries: ThreadMessage[] = [];
  const reviewSchema = RemoteCommentSchema.omit({ created_at: true }).extend({
    submitted_at: z.string().nullable(),
    state: z.string(),
  });
  for (let page = 1; ; page++) {
    const rows = z
      .array(reviewSchema)
      .parse(
        await github(
          tab.ref,
          `${repoApi(tab.ref)}/pulls/${tab.ref.number}/reviews?per_page=100&page=${page}`,
          'GET', undefined, 'application/vnd.github.full+json',
        ),
      );
    for (const row of rows) {
      if (row.body === null || row.body.trim() === '' || row.submitted_at === null || row.state === 'PENDING') continue;
      summaries.push({
        id: `github-summary-${row.id}`,
        body: row.body,
        bodyHTML: row.body_html ?? undefined,
        author: row.user?.login ?? 'ghost',
        date: row.submitted_at,
        url: row.html_url,
        kind: 'issue',
        status: 'synced',
        editable: false,
        deleted: false,
      });
    }
    if (rows.length < 100) break;
  }
  return [...groups[1], ...groups[0], ...summaries];
}
export async function mutatePull(tab: PullTab, action: string, body?: string): Promise<void> {
  if (!tab.info) throw new Error('PR details are still loading');
  const ref = tab.ref;
  if (tab.info.state === 'MERGED') throw new Error('This PR is already merged');
  if (action === 'draft' || action === 'ready') {
    if (tab.info.state === 'CLOSED')
      await github(ref, `${repoApi(ref)}/pulls/${ref.number}`, 'PATCH', { state: 'open' });
    if (tab.info.isDraft === (action === 'draft')) return;
    const name = action === 'draft' ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview';
    const result = z
      .object({ errors: z.array(z.object({ message: z.string() })).optional() })
      .loose()
      .parse(
        await github(ref, 'graphql', 'POST', {
          query: `mutation($id:ID!) { ${name}(input:{pullRequestId:$id}) { pullRequest { id } } }`,
          variables: { id: tab.info.id },
        }),
      );
    if ((result.errors?.length ?? 0) > 0)
      throw new Error((result.errors ?? []).map((e) => e.message).join('; '));
  } else if (action === 'close')
    await github(ref, `${repoApi(ref)}/pulls/${ref.number}`, 'PATCH', {
      state: 'closed',
    });
  else {
    if (action === 'humanize')
      body = 'Could you make the explanations (description, in-line comments) easier to digest for a human ?';
    if (action === 'changes' && (body?.trim() ?? '') === '')
      throw new Error('Explain the requested changes before submitting');
    await github(ref, `${repoApi(ref)}/pulls/${ref.number}/reviews`, 'POST', {
      event: action === 'approve' ? 'APPROVE' : 'REQUEST_CHANGES',
      ...(body !== undefined ? { body } : {}),
    });
  }
}
