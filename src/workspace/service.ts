import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  type PullTab,
  PullTabSchema,
  reviewerStates,
  type ThreadMessage,
  type WorkspaceMutation,
} from '../api/workspace.js';
import {
  type Annotation,
  deleteAnnotation,
  getAnnotationById,
  getAnnotationsForReview,
  getReview,
  getReviewFile,
  updateAnnotation,
} from '../db/queries.js';
import { parseDiffData } from '../git/parseDiffData.js';
import { ensureCheckout, importPull } from './checkout.js';
import { flushCodexComments, queueCodexComment, recoverCodexComments, retryCodexComment } from './codex.js';
import {
  github,
  loadComments,
  loadPull,
  localWorkspaceConfig,
  mutatePull,
  parsePullUrl,
  pullKey,
  RemoteCommentSchema,
  repoApi,
} from './github.js';
import { notify } from './notifications.js';
import { startWorkspaceCleanup } from './retention.js';
import { saveWorkspace, workspaceData } from './storage.js';

const syncing = new Map<string, boolean>();
const pendingRefresh = new Set<string>();
let flushing = false;
export function tabForReview(reviewId: string): PullTab | undefined {
  const data = workspaceData();
  return [...data.tabs, ...data.archived].find((t) => t.reviewId === reviewId);
}
function requireTab(key: string): PullTab {
  const tab = workspaceData().tabs.find((t) => t.key === key);
  if (!tab) throw new Error('PR tab not found');
  return tab;
}
export function insertTab(tabs: PullTab[], tab: PullTab): void {
  const parent = tabs.findIndex(
    (t) =>
      tab.info !== null &&
      t.info !== null &&
      t.ref.owner === tab.ref.owner &&
      t.ref.repo === tab.ref.repo &&
      t.info.headRefName === tab.info.baseRefName,
  );
  const child = tabs.findIndex(
    (t) =>
      tab.info !== null &&
      t.info !== null &&
      t.ref.owner === tab.ref.owner &&
      t.ref.repo === tab.ref.repo &&
      t.info.baseRefName === tab.info.headRefName,
  );
  const own = tab.info?.author.login === tab.viewer;
  const firstOther = tabs.findIndex((t) => t.info?.author.login !== t.viewer);
  const index =
    parent >= 0 ? parent + 1 : child >= 0 ? child : own ? 0 : firstOther < 0 ? tabs.length : firstOther;
  tabs.splice(index, 0, tab);
}
function notifyChanges(before: PullTab['info'], tab: PullTab): void {
  const after = tab.info;
  if (!before || !after) return;
  const oldReviews = reviewerStates(before);
  for (const [name, state] of reviewerStates(after)) {
    if (state !== oldReviews.get(name))
      notify(after.title, `${name}: ${state.toLowerCase().replaceAll('_', ' ')}`);
  }
  if (before.mergeStateStatus !== 'CLEAN' && after.mergeStateStatus === 'CLEAN' && !after.isDraft)
    notify(after.title, 'Ready to merge');
  if (before.state !== 'MERGED' && after.state === 'MERGED') notify(after.title, 'PR merged');
}
export async function syncTab(tab: PullTab, refreshDiff = false): Promise<void> {
  if (syncing.has(tab.key)) {
    if (refreshDiff && syncing.get(tab.key) === false) pendingRefresh.add(tab.key);
    return;
  }
  syncing.set(tab.key, refreshDiff);
  tab.loading = true;
  try {
    const before = tab.info;
    const [info, viewer] = await Promise.all([
      loadPull(tab.ref),
      tab.viewer
        ? Promise.resolve({ login: tab.viewer })
        : github(tab.ref, 'user').then((v) => z.object({ login: z.string() }).parse(v)),
    ]);
    if (!workspaceData().tabs.includes(tab)) return;
    tab.info = info;
    tab.viewer = viewer.login;
    const directory = localWorkspaceConfig().slack;
    tab.slack = Object.fromEntries(
      [...reviewerStates(info).keys()]
        .filter((name) => name in directory)
        .map((name) => [name, directory[name]]),
    );
    if (!before) {
      const data = workspaceData();
      data.tabs = data.tabs.filter((t) => t !== tab);
      insertTab(data.tabs, tab);
    }
    notifyChanges(before, tab);
    tab.error = undefined;
    tab.updatedAt = Date.now();
    saveWorkspace();
    // Let code become usable independently of slow comment pagination.
    const results = await Promise.allSettled([
      syncComments(tab),
      (async () => {
        if (
          tab.reviewId === null || tab.checkoutEvicted ||
          ((refreshDiff || tab.importLocalComments) &&
            (tab.reviewedHead !== info.headRefOid || tab.reviewedBase !== info.baseRefOid))
        ) await importPull(tab);
        saveWorkspace();
      })(),
    ]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
    if (tab.importLocalComments && tab.reviewId !== null) {
      for (const annotation of await getAnnotationsForReview(tab.reviewId)) {
        if (!tab.comments.some((message) => message.annotationId === annotation.id))
          await queueAnnotation(tab.reviewId, annotation, false);
      }
      tab.importLocalComments = false;
    }
  } catch (error) {
    tab.error = error instanceof Error ? error.message : 'Sync failed';
  } finally {
    tab.loading = false;
    tab.lastUsedAt = Date.now();
    syncing.delete(tab.key);
    saveWorkspace();
    if (pendingRefresh.delete(tab.key) && workspaceData().tabs.includes(tab)) void syncTab(tab, true);
  }
}
async function syncComments(tab: PullTab): Promise<void> {
  // Keep comments being published while this remote snapshot is in flight.
  const pendingIds = new Set(
    workspaceData()
      .outbox.filter((item) => item.tab === tab.key)
      .map((item) => item.message),
  );
  const knownRemoteIds = new Set(
    tab.comments.filter((message) => message.remoteId !== undefined).map((message) => message.remoteId),
  );
  const remote = await loadComments(tab);
  for (const item of workspaceData().outbox) if (item.tab === tab.key) pendingIds.add(item.message);
  for (const message of tab.comments)
    if (message.remoteId !== undefined && !knownRemoteIds.has(message.remoteId)) pendingIds.add(message.id);
  const local = tab.comments.filter(
    (m) => m.kind === 'ai' || pendingIds.has(m.id) || m.annotationId !== undefined || m.codex !== undefined,
  );
  tab.comments = [
    ...local,
    ...remote.filter((m) => !local.some((l) => l.remoteId === m.remoteId || l.id === m.id)),
  ];
  // Reconcile externally edited replies while retaining local annotation identity.
  for (const message of local) {
    const match = remote.find((r) => r.remoteId === message.remoteId);
    if (!pendingIds.has(message.id) && message.remoteId !== undefined) {
      if (!match) {
        message.deleted = true;
        if (message.annotationId !== undefined) await deleteAnnotation(message.annotationId);
        continue;
      }
      const annotationId = message.annotationId;
      const line = message.line;
      const side = message.side;
      const body =
        message.fileComment === true
          ? match.body.replace(/^\[Line \d+\]\(https:\/\/github\.com\/[^\n]+\)\n\n/, '')
          : match.body;
      if (annotationId !== undefined && message.body !== body) {
        const annotation = await getAnnotationById(annotationId);
        if (annotation) await updateAnnotation(annotation.id, body, annotation.category);
      }
      Object.assign(message, match, {
        id: message.id,
        codex: message.codex,
        annotationId,
        body,
        ...(annotationId !== undefined ? { line, side } : {}),
      });
    }
  }
  tab.commentsLoaded = true;
  saveWorkspace();
}
function needsInitialSync(tab: PullTab): boolean {
  return tab.info === null || tab.reviewId === null || !tab.viewer || !tab.commentsLoaded || tab.importLocalComments;
}
export function startWorkspace(pinnedRoot?: string): () => void {
  const data = workspaceData();
  recoverCodexComments();
  for (const tab of [...data.tabs, ...data.archived]) {
    for (const message of tab.comments)
      if (message.kind === 'ai' && message.status === 'working') {
        message.status = 'error';
        message.error = 'The app restarted while the agent was working. Any local edits were preserved.';
      }
    tab.loading = false;
    if (!data.tabs.includes(tab)) continue;
    if (tab.checkoutEvicted && tab.key !== data.active) continue;
    if (needsInitialSync(tab)) void syncTab(tab);
    else if (tab.key === data.active) void ensureCheckout(tab).catch(() => {});
  }
  saveWorkspace();
  // Only pending writes retry in the background; cached PRs refresh on demand.
  const timer = setInterval(() => {
    void flushOutbox();
    void flushCodexComments();
  }, 10_000);
  timer.unref();
  void flushOutbox();
  void flushCodexComments();
  const stopCleanup = startWorkspaceCleanup(pinnedRoot);
  return () => {
    clearInterval(timer);
    stopCleanup();
  };
}
function enqueue(tab: PullTab, message: ThreadMessage, operation: 'create' | 'edit' | 'delete'): void {
  tab.lastUsedAt = Date.now();
  message.status = 'pending';
  const data = workspaceData();
  if (
    !data.outbox.some(
      (item) => item.tab === tab.key && item.message === message.id && item.operation === operation,
    )
  ) {
    data.outbox.push({
      id: randomUUID(),
      tab: tab.key,
      message: message.id,
      operation,
      nextAttempt: 0,
      attempted: false,
    });
  }
  saveWorkspace();
  void flushOutbox();
}
export async function queueAnnotation(
  reviewId: string,
  annotation: Annotation,
  forwardToCodex = true,
): Promise<void> {
  const tab = tabForReview(reviewId);
  if (!tab) return;
  const file = await getReviewFile(annotation.review_file_id);
  if (!file || file.review_id !== reviewId) throw new Error('Comment does not belong to this PR');
  const message: ThreadMessage = {
    id: randomUUID(),
    annotationId: annotation.id,
    body: annotation.content,
    author: tab.viewer || 'You',
    date: annotation.created_at,
    url: '',
    path: file.file_path,
    fileComment: !(
      parseDiffData(file.diff_data)?.hunks.some((hunk) =>
        hunk.lines.some(
          (line) => (annotation.side === 'old' ? line.oldNum : line.newNum) === annotation.line_number,
        ),
      ) ?? false
    ),
    line: annotation.line_number,
    side: annotation.side === 'old' ? 'old' : 'new',
    commit: tab.reviewedHead,
    kind: 'review',
    status: 'pending',
    editable: true,
    deleted: false,
  };
  tab.comments.push(message);
  enqueue(tab, message, 'create');
  if (forwardToCodex) queueCodexComment(tab, message);
}
export function queueAnnotationChange(
  reviewId: string,
  id: string,
  operation: 'edit' | 'delete',
  content?: string,
): void {
  const tab = tabForReview(reviewId);
  const message = tab?.comments.find((m) => m.annotationId === id);
  if (!tab || !message) return;
  if (!message.editable) throw new Error('Only your comments can be edited');
  if (operation === 'delete') message.deleted = true;
  else message.body = content ?? message.body;
  enqueue(tab, message, Boolean(message.remoteId) || operation === 'delete' ? operation : 'create');
}
export async function flushOutbox(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    const data = workspaceData();
    for (const item of [...data.outbox]) {
      if (!data.outbox.includes(item) || item.nextAttempt > Date.now()) continue;
      const tab = [...data.tabs, ...data.archived].find((t) => t.key === item.tab);
      const message = tab?.comments.find((m) => m.id === item.message);
      if (!tab || !message) continue;
      if (
        item.operation !== 'create' &&
        message.remoteId === undefined &&
        data.outbox.some((other) => other.message === item.message && other.operation === 'create')
      )
        continue;
      try {
        if (!tab.viewer) throw new Error('Waiting for GitHub authentication');
        const prefix = repoApi(tab.ref);
        const endpoint = message.kind === 'issue' ? 'issues/comments' : 'pulls/comments';
        const sentBody = message.body;
        if (item.operation === 'create' && message.remoteId === undefined) {
          if (message.deleted && !item.attempted) {
            data.outbox = data.outbox.filter((q) => q.message !== message.id);
            continue;
          }
          if (item.attempted) {
            // A prior timeout may have followed a successful POST. Look for its durable marker first.
            const kindPath =
              message.kind === 'issue'
                ? `issues/${tab.ref.number}/comments`
                : `pulls/${tab.ref.number}/comments`;
            for (let page = 1; ; page++) {
              const rows = z
                .array(RemoteCommentSchema)
                .parse(await github(tab.ref, `${prefix}/${kindPath}?per_page=100&page=${page}`));
              const existing = rows.find(
                (row) => row.body?.includes(`<!-- glassbox:${message.id} -->`) === true,
              );
              if (existing) {
                message.remoteId = existing.id;
                message.url = existing.html_url;
                break;
              }
              if (rows.length < 100) break;
            }
          }
          if (message.deleted && message.remoteId === undefined) {
            data.outbox = data.outbox.filter((q) => q.message !== message.id);
            continue;
          }
          if (message.remoteId === undefined) {
            item.attempted = true;
            saveWorkspace();
            const location =
              message.fileComment === true &&
              message.path !== undefined &&
              message.line !== null &&
              message.line !== undefined
                ? `[Line ${message.line}](https://github.com/${tab.ref.owner}/${tab.ref.repo}/blob/${message.side === 'old' ? tab.reviewedBase : message.commit}/${message.path.split('/').map(encodeURIComponent).join('/')}#L${message.line})\n\n`
                : '';
            const body = `${location}${sentBody}\n\n<!-- glassbox:${message.id} -->`;
            const payload =
              message.kind === 'issue'
                ? { body }
                : message.parentId !== undefined
                  ? { body, in_reply_to: message.parentId }
                  : {
                      body,
                      commit_id: message.commit,
                      path: message.path,
                      ...((message.line ?? 0) > 0 && message.fileComment !== true
                        ? {
                            line: message.line,
                            side: message.side === 'old' ? 'LEFT' : 'RIGHT',
                          }
                        : { subject_type: 'file' }),
                    };
            const remote = RemoteCommentSchema.parse(
              await github(
                tab.ref,
                `${prefix}/${message.kind === 'issue' ? 'issues' : 'pulls'}/${tab.ref.number}/comments`,
                'POST',
                payload,
              ),
            );
            message.remoteId = remote.id;
            message.url = remote.html_url;
          }
        } else if (item.operation === 'edit' && Boolean(message.remoteId)) {
          await github(tab.ref, `${prefix}/${endpoint}/${message.remoteId}`, 'PATCH', {
            body: `${sentBody}\n\n<!-- glassbox:${message.id} -->`,
          });
        } else if (item.operation === 'delete' && Boolean(message.remoteId)) {
          try {
            await github(tab.ref, `${prefix}/${endpoint}/${message.remoteId}`, 'DELETE');
          } catch (error) {
            if (!(error instanceof Error && error.message.startsWith('GitHub 404:'))) throw error;
          }
        }
        data.outbox = data.outbox.filter((q) => q.id !== item.id);
        message.status = 'synced';
        message.error = undefined;
        if (message.body !== sentBody && !message.deleted) enqueue(tab, message, 'edit');
      } catch (error) {
        message.status = 'error';
        message.error = error instanceof Error ? error.message : 'Offline';
        item.nextAttempt = Date.now() + 300_000;
      }
      saveWorkspace();
    }
  } finally {
    flushing = false;
  }
}
export async function mutateWorkspace(input: WorkspaceMutation, currentReviewId: string): Promise<void> {
  const data = workspaceData();
  if (input.op === 'open') {
    const ref = parsePullUrl(input.url);
    let tab = data.tabs.find((t) => t.key === pullKey(ref));
    const archived = data.archived.find((t) => t.key === pullKey(ref));
    if (!tab && archived) {
      tab = archived;
      data.archived = data.archived.filter((t) => t !== archived);
      insertTab(data.tabs, archived);
    }
    if (!tab) {
      tab = PullTabSchema.parse({
        key: pullKey(ref),
        ref,
        reviewId: null,
        repoRoot: null,
        info: null,
        loading: true,
      });
      if (input.attachReviewId !== undefined) {
        if (input.attachReviewId !== currentReviewId) throw new Error('Can only attach the current review');
        const review = await getReview(currentReviewId);
        if (!review) throw new Error('Review not found');
        tab.reviewId = review.id;
        tab.repoRoot = review.repo_path;
        tab.reviewedHead = review.head_commit ?? '';
        tab.reviewedBase = review.mode.startsWith('range:') ? review.mode.slice(6).split('..')[0] : '';
        tab.importLocalComments = true;
      }
      data.tabs.unshift(tab);
    }
    data.active = tab.key;
    tab.lastUsedAt = Date.now();
    saveWorkspace();
    if (needsInitialSync(tab)) void syncTab(tab);
    else void ensureCheckout(tab).catch(() => {});
    return;
  }
  if (input.op === 'order') {
    if (
      new Set(input.keys).size !== data.tabs.length ||
      input.keys.length !== data.tabs.length ||
      input.keys.some((key) => !data.tabs.some((t) => t.key === key))
    )
      throw new Error('Order must contain each PR exactly once');
    data.tabs = input.keys.map(requireTab);
    saveWorkspace();
    return;
  }
  const tab = requireTab(input.key);
  tab.lastUsedAt = Date.now();
  if (input.op === 'retry-codex') {
    const message = tab.comments.find(item => item.id === input.id && !item.deleted);
    if (!message) throw new Error('Comment not found');
    retryCodexComment(message);
  }
  if (input.op === 'retry-agent') {
    const reply = tab.comments.find((message) => message.id === input.id && message.kind === 'ai');
    const original = tab.comments.find((message) => message.id === reply?.parentKey);
    if (reply?.status !== 'error' || !original) throw new Error('No failed agent job to retry');
    queueCodexComment(tab, original);
  }
  if (input.op === 'select') {
    data.active = tab.key;
    if (needsInitialSync(tab)) void syncTab(tab);
    else void ensureCheckout(tab).catch(() => {});
  }
  if (input.op === 'view') tab.view = input.view;
  if (input.op === 'close') {
    data.tabs = data.tabs.filter((t) => t !== tab);
    data.archived.push(tab);
    if (data.active === tab.key) data.active = data.tabs[0]?.key ?? null;
    const next = data.tabs.find(item => item.key === data.active);
    if (next) void ensureCheckout(next).catch(() => {});
  }
  if (input.op === 'refresh') {
    tab.loading = true;
    saveWorkspace();
    await syncTab(tab, true);
  }
  if (input.op === 'edit') {
    if (input.title !== undefined && (!tab.info || tab.info.author.login !== tab.viewer))
      throw new Error('Only the PR author can edit its title in rev');
    await github(tab.ref, `${repoApi(tab.ref)}/pulls/${tab.ref.number}`, 'PATCH', {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
    });
    if (tab.info) {
      if (input.title !== undefined) tab.info.title = input.title;
      if (input.body !== undefined) tab.info.body = input.body;
    }
  }
  if (input.op === 'action') {
    await mutatePull(tab, input.action, input.body);
    tab.action = input.action;
    void syncTab(tab);
  }
  if (input.op === 'comment') {
    const parent =
      input.parentId !== undefined ? tab.comments.find((m) => m.remoteId === input.parentId) : undefined;
    if (Boolean(input.parentId) && !parent) throw new Error('Comment thread not found');
    const message: ThreadMessage = {
      id: randomUUID(),
      body: input.body,
      author: tab.viewer || 'You',
      date: new Date().toISOString(),
      url: '',
      kind: parent ? 'review' : 'issue',
      parentId: parent?.parentId ?? parent?.remoteId,
      path: parent?.path,
      line: parent?.line,
      side: parent?.side,
      commit: parent?.commit,
      status: 'pending',
      editable: true,
      deleted: false,
    };
    tab.comments.push(message);
    enqueue(tab, message, 'create');
    queueCodexComment(tab, message);
  }
  if (input.op === 'edit-comment' || input.op === 'delete-comment') {
    const message = tab.comments.find((m) => m.id === input.id);
    if (message?.editable !== true) throw new Error('Only your comments can be edited');
    if (input.op === 'edit-comment') message.body = input.body;
    else message.deleted = true;
    enqueue(
      tab,
      message,
      input.op === 'delete-comment' ? 'delete' : message.remoteId !== undefined ? 'edit' : 'create',
    );
  }
  saveWorkspace();
}
export async function assertOwnAnnotation(reviewId: string, id: string): Promise<void> {
  const annotation = await getAnnotationById(id);
  const file = annotation && (await getReviewFile(annotation.review_file_id));
  if (!file || file.review_id !== reviewId) throw new Error('Comment not found in this review');
}
