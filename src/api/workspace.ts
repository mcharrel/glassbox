import { z } from 'zod';

import { apiCall } from './_runner.js';

export const VisibilitySchema = z.object({ id: z.string().min(1).max(100), visible: z.boolean(), codeTab: z.string().nullable().optional(), draftTab: z.string().nullable().optional() });
export const reportVisibility = (body: z.infer<typeof VisibilitySchema>) =>
  apiCall(z.object({ ok: z.boolean() }), '/workspace/visibility', { method: 'POST', body, reviewId: null });

export const PullRefSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  number: z.number().int().positive(),
  url: z.string(),
});
export type PullRef = z.infer<typeof PullRefSchema>;
export const PullInfoSchema = z.object({
  id: z.string(),
  number: z.number(),
  url: z.string(),
  title: z.string(),
  body: z.string(),
  bodyHTML: z.string().optional(),
  author: z.object({ login: z.string() }),
  state: z.string(),
  isDraft: z.boolean(),
  baseRefName: z.string(),
  headRefName: z.string(),
  baseRefOid: z.string(),
  headRefOid: z.string(),
  mergeable: z.string(),
  mergeStateStatus: z.string().default('UNKNOWN'),
  reviewDecision: z.string().nullable().default(''),
  mergedAt: z.string().nullable(),
  reviewRequests: z
    .array(z.object({ login: z.string().optional(), name: z.string().optional() }))
    .default([]),
  reviews: z
    .array(
      z.object({
        author: z.object({ login: z.string() }).nullable(),
        state: z.string(),
        submittedAt: z.string().nullable(),
      }),
    )
    .default([]),
  statusCheckRollup: z
    .array(
      z.object({
        name: z.string().optional(),
        context: z.string().optional(),
        status: z.string().optional(),
        state: z.string().optional(),
        conclusion: z.string().nullable().optional(),
        detailsUrl: z.string().optional(),
        targetUrl: z.string().optional(),
      }),
    )
    .nullable()
    .default([]),
});
export type PullInfo = z.infer<typeof PullInfoSchema>;
export const CodexDeliverySchema = z.object({
  threadId: z.uuid(),
  mode: z.enum(['queue', 'steer']),
  status: z.enum(['queued', 'sending', 'sent', 'uncertain']),
  error: z.string().optional(),
});
export const ThreadMessageSchema = z.object({
  id: z.string(),
  body: z.string(),
  bodyHTML: z.string().optional(),
  author: z.string(),
  date: z.string(),
  url: z.string().default(''),
  parentKey: z.string().optional(),
  remoteId: z.number().optional(),
  parentId: z.number().optional(),
  annotationId: z.string().optional(),
  path: z.string().optional(),
  line: z.number().nullable().optional(),
  side: z.enum(['old', 'new']).optional(),
  commit: z.string().optional(),
  fileComment: z.boolean().optional(),
  resolved: z.boolean().optional(),
  kind: z.enum(['issue', 'review', 'ai']),
  status: z.enum(['pending', 'synced', 'error', 'working', 'done']).default('synced'),
  error: z.string().optional(),
  editable: z.boolean().default(false),
  deleted: z.boolean().default(false),
  codex: CodexDeliverySchema.optional(),
  destination: z.enum(['local', 'github']).optional(),
  codexRequested: z.boolean().optional(),
  agentStatus: z.enum(['pending', 'processing', 'answered']).optional(),
  revision: z.number().int().positive().optional(),
  replyToRevision: z.number().int().positive().optional(),
  workspaceUpdatedAt: z.number().optional(),
  workspaceSafeHead: z.string().optional(),
});
export type ThreadMessage = z.infer<typeof ThreadMessageSchema>;

/** Delivery to a chat is not an acknowledgement that an agent has begun work. */
export function commentAgentStatus(message: ThreadMessage): 'pending' | 'processing' | 'answered' | undefined {
  return message.kind === 'review' && message.destination === 'local'
    ? message.agentStatus ?? 'pending' : undefined;
}
export const DeploymentTargetSchema = z.object({
  datacenter: z.string(),
  environment: z.string(),
  namespace: z.string(),
  service: z.string(),
  status: z.enum(['reached', 'deploying', 'missing', 'unknown']),
});
export type DeploymentTarget = z.infer<typeof DeploymentTargetSchema>;
export const DeploymentSnapshotSchema = z.object({
  targets: z.array(DeploymentTargetSchema).default([]),
  status: z.enum(['loading', 'ready', 'error', 'unavailable']),
  updatedAt: z.number().default(0),
  attemptedAt: z.number().default(0),
  message: z.string().optional(),
});
export const PullTabSchema = z.object({
  key: z.string(),
  ref: PullRefSchema,
  reviewId: z.string().nullable(),
  repoRoot: z.string().nullable(),
  info: PullInfoSchema.nullable(),
  viewer: z.string().default(''),
  view: z.enum(['main', 'file']).default('main'),
  loading: z.boolean().default(false),
  error: z.string().optional(),
  updatedAt: z.number().default(0),
  lastUsedAt: z.number().default(0),
  checkoutEvicted: z.boolean().default(false),
  comments: z.array(ThreadMessageSchema).default([]),
  commentsLoaded: z.boolean().default(false),
  slack: z.record(z.string(), z.string()).default({}),
  action: z.string().default(''),
  reviewedHead: z.string().default(''),
  reviewedBase: z.string().default(''),
  importLocalComments: z.boolean().default(false),
  codexThreadId: z.uuid().optional(),
  sourceRefreshRequested: z.uuid().optional(),
  deployment: DeploymentSnapshotSchema.optional(),
});
export type PullTab = z.infer<typeof PullTabSchema>;
export function isPullAuthor(tab: Pick<PullTab, 'info' | 'viewer'>): boolean {
  return Boolean(tab.viewer) && tab.viewer.toLowerCase() === tab.info?.author.login.toLowerCase();
}
// Unknown ownership must never default to publishing a private comment.
export function codeCommentDestination(tab: Pick<PullTab, 'info' | 'viewer'>): 'local' | 'github' | null {
  const author = tab.info?.author.login;
  if (!tab.viewer || author === undefined || author === '') return null;
  return isPullAuthor(tab) ? 'local' : 'github';
}
export function commentDestination(tab: Pick<PullTab, 'info' | 'viewer'>, message: Pick<ThreadMessage, 'kind'>): 'local' | 'github' | null {
  if (message.kind === 'ai') return 'local';
  if (message.kind === 'issue') return tab.viewer ? 'github' : null;
  return codeCommentDestination(tab);
}
export const WorkspaceSchema = z.object({
  tabs: z.array(PullTabSchema),
  active: z.string().nullable(),
  externalSelection: z.number().optional(),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
export const WorkspaceMutationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('retry-codex'), key: z.string(), id: z.string() }),
  z.object({ op: z.literal('retry-agent'), key: z.string(), id: z.string() }),
  z.object({
    op: z.literal('open'),
    url: z.string(),
    attachReviewId: z.string().optional(),
  }),
  z.object({ op: z.literal('select'), key: z.string() }),
  z.object({ op: z.literal('close'), key: z.string() }),
  z.object({ op: z.literal('order'), keys: z.array(z.string()) }),
  z.object({
    op: z.literal('view'),
    key: z.string(),
    view: z.enum(['main', 'file']),
  }),
  z.object({ op: z.literal('refresh'), key: z.string() }),
  z.object({
    op: z.literal('edit'),
    key: z.string(),
    title: z.string().optional(),
    body: z.string().optional(),
  }),
  z.object({
    op: z.literal('action'),
    key: z.string(),
    action: z.enum(['draft', 'ready', 'close', 'approve', 'changes', 'humanize']),
    body: z.string().optional(),
  }),
  z.object({
    op: z.literal('comment'),
    key: z.string(),
    body: z.string().min(1),
    parentId: z.number().optional(),
    parentKey: z.string().optional(),
  }),
  z.object({
    op: z.literal('edit-comment'),
    key: z.string(),
    id: z.string(),
    body: z.string().min(1),
  }),
  z.object({
    op: z.literal('delete-comment'),
    key: z.string(),
    id: z.string(),
  }),
]);
export type WorkspaceMutation = z.infer<typeof WorkspaceMutationSchema>;
export const getWorkspace = () => apiCall(WorkspaceSchema, '/workspace', { reviewId: null });
export const changeWorkspace = (body: WorkspaceMutation) =>
  apiCall(WorkspaceSchema, '/workspace', { method: 'POST', body,
    reviewId: body.op === 'open' ? body.attachReviewId ?? null : null });

export const SearchHitSchema = z.object({
  fileId: z.string().nullable(),
  path: z.string(),
  line: z.number(),
  side: z.enum(['old', 'new']),
  occurrence: z.number(),
  commentId: z.string().optional(),
  annotationId: z.string().optional(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;
export const searchReview = (query: string) =>
  apiCall(z.array(SearchHitSchema), `/workspace/search?q=${encodeURIComponent(query)}`);

/** Latest review per person, with an outstanding re-review request taking precedence. */
export function reviewerStates(info: PullInfo): Map<string, string> {
  const states = new Map<string, string>();
  for (const review of [...info.reviews].sort((a, b) =>
    (a.submittedAt ?? '').localeCompare(b.submittedAt ?? ''),
  )) {
    if (review.author && review.state !== 'COMMENTED') states.set(review.author.login, review.state);
  }
  for (const request of info.reviewRequests) {
    const name = request.login ?? request.name;
    if (name !== undefined) states.set(name, 'PENDING');
  }
  return states;
}
