import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';

const mocks = vi.hoisted(() => ({
  data: { tabs: [] as any[], archived: [] as any[], active: null as string | null, outbox: [] as any[] },
  github: vi.fn(),
  save: vi.fn(),
  agent: vi.fn(),
}));
vi.mock('../../../src/workspace/storage.js', () => ({
  workspaceData: () => mocks.data,
  saveWorkspace: mocks.save,
}));
vi.mock('../../../src/workspace/agent.js', () => ({ startCommentAgent: mocks.agent }));
vi.mock('../../../src/workspace/checkout.js', () => ({ importPull: vi.fn(), ensureCheckout: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../src/workspace/retention.js', () => ({ startWorkspaceCleanup: vi.fn(() => () => {}) }));
vi.mock('../../../src/workspace/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/workspace/github.js')>()),
  github: mocks.github,
  loadPull: vi.fn(),
  loadComments: vi.fn().mockResolvedValue([]),
}));
import { flushOutbox, insertTab, mutateWorkspace, startWorkspace, syncTab } from '../../../src/workspace/service.js';
import { loadComments, loadPull, parsePullUrl } from '../../../src/workspace/github.js';
import { ensureCheckout, importPull } from '../../../src/workspace/checkout.js';

function tab(number = 1) {
  return PullTabSchema.parse({
    key: `example/project#${number}`,
    ref: parsePullUrl(`https://github.com/example/project/pull/${number}`),
    reviewId: 'review',
    repoRoot: '/checkout',
    info: null,
    viewer: 'alice',
  });
}
function remote(id: number, body = 'comment') {
  return {
    id,
    body,
    user: { login: 'alice' },
    created_at: '2026-01-01T00:00:00Z',
    html_url: `https://github.com/example/project/pull/1#issuecomment-${id}`,
  };
}
beforeEach(() => {
  vi.restoreAllMocks();
  mocks.github.mockReset();
  mocks.agent.mockClear();
  mocks.data.tabs = [tab()];
  mocks.data.archived = [];
  mocks.data.outbox = [];
  mocks.data.active = 'example/project#1';
});
describe('durable comment outbox', () => {
  it('posts once, records the link and starts the configured agent job', async () => {
    mocks.github.mockResolvedValue(remote(10));
    await mutateWorkspace(
      { op: 'comment', key: 'example/project#1', body: 'Please simplify this' },
      'review',
    );
    await vi.waitFor(() => expect(mocks.data.outbox).toHaveLength(0));
    expect(mocks.github).toHaveBeenCalledTimes(1);
    expect(mocks.github.mock.calls[0][3].body).toContain('<!-- glassbox:');
    expect(mocks.data.tabs[0].comments[0].url).toContain('issuecomment-10');
    expect(mocks.agent).toHaveBeenCalledTimes(1);
  });
  it('waits five minutes and reconciles an ambiguous successful POST before retrying', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.github.mockRejectedValueOnce(new Error('connection dropped'));
    await mutateWorkspace({ op: 'comment', key: 'example/project#1', body: 'Hello' }, 'review');
    await vi.waitFor(() => expect(mocks.data.tabs[0].comments[0].status).toBe('error'));
    await flushOutbox();
    expect(mocks.github).toHaveBeenCalledTimes(1);
    const message = mocks.data.tabs[0].comments[0];
    mocks.github.mockResolvedValueOnce([remote(11, `Hello\n<!-- glassbox:${message.id} -->`)]);
    now += 300000;
    await flushOutbox();
    expect(mocks.data.outbox).toHaveLength(0);
    expect(message.remoteId).toBe(11);
    expect(mocks.github.mock.calls.filter((call) => call[2] === 'POST')).toHaveLength(1);
  });
  it('continues syncing offline comments after their tab is closed', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.github.mockRejectedValueOnce(new Error('offline'));
    await mutateWorkspace({ op: 'comment', key: 'example/project#1', body: 'Keep this comment' }, 'review');
    await vi.waitFor(() => expect(mocks.data.tabs[0].comments[0].status).toBe('error'));
    await mutateWorkspace({ op: 'close', key: 'example/project#1' }, 'review');
    expect(mocks.data.tabs).toHaveLength(0);
    expect(mocks.data.archived).toHaveLength(1);
    mocks.github.mockResolvedValueOnce([]).mockResolvedValueOnce(remote(12));
    now += 300000;
    await flushOutbox();
    expect(mocks.data.archived[0].comments[0].status).toBe('synced');
  });
  it('rejects editing somebody else’s comment without contacting GitHub', async () => {
    mocks.data.tabs[0].comments.push({ id: 'other', editable: false });
    await expect(
      mutateWorkspace(
        { op: 'edit-comment', key: 'example/project#1', id: 'other', body: 'replacement' },
        'review',
      ),
    ).rejects.toThrow('Only your comments');
    expect(mocks.github).not.toHaveBeenCalled();
  });
});
describe('PR ordering', () => {
  it('handles an empty workspace and rejects missing or repeated reorder ids', async () => {
    const tabs: ReturnType<typeof tab>[] = [];
    insertTab(tabs, tab());
    expect(tabs).toHaveLength(1);
    await expect(mutateWorkspace({ op: 'order', keys: [] }, 'review')).rejects.toThrow('exactly once');
    await expect(
      mutateWorkspace({ op: 'order', keys: ['example/project#1', 'example/project#1'] }, 'review'),
    ).rejects.toThrow('exactly once');
  });
  it('keeps a stack together regardless of load order', () => {
    const parent = tab(1);
    const child = tab(2);
    parent.info = { author: { login: 'alice' }, headRefName: 'parent', baseRefName: 'main' } as any;
    child.info = { author: { login: 'alice' }, headRefName: 'child', baseRefName: 'parent' } as any;
    const first = [parent];
    insertTab(first, child);
    expect(first.map((t) => t.ref.number)).toEqual([1, 2]);
    const reversed = [child];
    insertTab(reversed, parent);
    expect(reversed.map((t) => t.ref.number)).toEqual([1, 2]);
  });
});
describe('PR URL parsing', () => {
  it('accepts trailing GitHub paths/query fragments and rejects unrelated hosts', () => {
    expect(parsePullUrl('https://github.com/example/project/pull/12/files#diff-abc').number).toBe(12);
    expect(() => parsePullUrl('https://github.com.attacker.test/example/project/pull/12')).toThrow();
    expect(() => parsePullUrl('https://github.com/example/project/pull/12abc')).toThrow();
  });
});

it('deletes a remotely accepted comment after an ambiguous create even when deletion was requested offline', async () => {
  let now = 1000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mocks.github.mockRejectedValueOnce(new Error('timeout after accepting create'));
  await mutateWorkspace({ op: 'comment', key: 'example/project#1', body: 'Remove this' }, 'review');
  await vi.waitFor(() => expect(mocks.data.tabs[0].comments[0].status).toBe('error'));
  const message = mocks.data.tabs[0].comments[0];
  await mutateWorkspace({ op: 'delete-comment', key: 'example/project#1', id: message.id }, 'review');
  await flushOutbox();
  expect(mocks.data.outbox).toHaveLength(2);
  mocks.github
    .mockResolvedValueOnce([remote(15, `Remove this\n<!-- glassbox:${message.id} -->`)])
    .mockResolvedValueOnce(null);
  now += 300000;
  await flushOutbox();
  expect(mocks.github.mock.calls.at(-1)?.[2]).toBe('DELETE');
  expect(mocks.data.outbox).toHaveLength(0);
});

it('does not delete a comment published while an older remote snapshot is loading', async () => {
  const tab = mocks.data.tabs[0];
  const info = { id: 'pr', author: { login: 'alice' }, title: 'PR', reviews: [], reviewRequests: [], state: 'OPEN', isDraft: true, mergeStateStatus: 'DRAFT', baseRefName: 'main', headRefName: 'topic' };
  tab.info = info;
  vi.mocked(loadPull).mockResolvedValue(info as any);
  let resolveComments: (value: any[]) => void = () => {};
  vi.mocked(loadComments).mockImplementationOnce(() => new Promise(resolve => { resolveComments = resolve; }));
  const sync = syncTab(tab);
  await vi.waitFor(() => expect(vi.mocked(loadComments)).toHaveBeenCalled());
  mocks.github.mockResolvedValue(remote(19));
  await mutateWorkspace({ op: 'comment', key: tab.key, body: 'New while loading' }, 'review');
  await vi.waitFor(() => expect(tab.comments[0].remoteId).toBe(19));
  resolveComments([]); await sync;
  expect(tab.comments[0].deleted).toBe(false);
  expect(tab.comments[0].body).toBe('New while loading');
});

it('makes imported files available before slow remote comments finish', async () => {
  const tab = mocks.data.tabs[0]; tab.reviewId = null;
  vi.mocked(loadPull).mockResolvedValue({ id: 'pr', author: { login: 'alice' }, title: 'PR', reviews: [], reviewRequests: [], state: 'OPEN', isDraft: true, mergeStateStatus: 'DRAFT', baseRefName: 'main', headRefName: 'topic' } as any);
  let finish!: (value: any[]) => void;
  vi.mocked(loadComments).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.mocked(importPull).mockImplementationOnce(async target => { target.reviewId = 'ready'; });
  const syncing = syncTab(tab);
  await vi.waitFor(() => expect(tab.reviewId).toBe('ready'));
  expect(tab.commentsLoaded).toBe(false);
  expect(mocks.save).toHaveBeenCalled();
  finish([]); await syncing;
  expect(tab.commentsLoaded).toBe(true);
});

it('rejects title edits on another author’s PR before calling GitHub', async () => {
  const tab = mocks.data.tabs[0]; tab.info = { author: { login: 'bob' } };
  await expect(mutateWorkspace({ op: 'edit', key: tab.key, title: 'New' }, 'review')).rejects.toThrow('Only the PR author');
  expect(mocks.github).not.toHaveBeenCalled();
});


describe('manual GitHub refresh', () => {
  let stop: (() => void) | undefined;
  function cached(number = 1) {
    const value = tab(number);
    value.commentsLoaded = true;
    value.reviewedBase = 'base'; value.reviewedHead = 'head';
    value.info = { id: 'pr', number, url: value.ref.url, author: { login: 'alice' }, title: 'PR', body: '',
      reviews: [], reviewRequests: [], statusCheckRollup: [], state: 'OPEN', isDraft: true,
      mergeable: 'UNKNOWN', mergeStateStatus: 'DRAFT', reviewDecision: '', mergedAt: null,
      baseRefName: 'main', headRefName: 'topic', baseRefOid: 'base', headRefOid: 'head' };
    return value;
  }
  beforeEach(() => {
    stop = undefined;
    vi.mocked(loadPull).mockReset().mockResolvedValue(cached().info!);
    vi.mocked(loadComments).mockReset().mockResolvedValue([]);
    vi.mocked(importPull).mockReset();
    mocks.data.tabs = [cached()];
  });
  afterEach(() => { stop?.(); vi.useRealTimers(); });

  it.each([0, 1, 5])('makes zero idle GitHub requests with %i cached tabs, including startup and reopening', async count => {
    vi.useFakeTimers();
    mocks.data.tabs = Array.from({ length: count }, (_, index) => cached(index + 1));
    stop = startWorkspace();
    await vi.advanceTimersByTimeAsync(3600000);
    for (const tab of [...mocks.data.tabs]) {
      await mutateWorkspace({ op: 'select', key: tab.key }, 'review');
      await mutateWorkspace({ op: 'open', url: tab.ref.url }, 'review');
      await mutateWorkspace({ op: 'close', key: tab.key }, 'review');
      await mutateWorkspace({ op: 'open', url: tab.ref.url }, 'review');
    }
    expect(loadPull).not.toHaveBeenCalled();
    expect(loadComments).not.toHaveBeenCalled();
    expect(mocks.github).not.toHaveBeenCalled();
    expect(importPull).not.toHaveBeenCalled();
  });
  it('restores an expired checkout only on selection, without refreshing cached GitHub metadata', async () => {
    vi.useFakeTimers();
    const expired = cached(2); expired.checkoutEvicted = true;
    mocks.data.tabs.push(expired); vi.mocked(ensureCheckout).mockClear();
    stop = startWorkspace(); await vi.advanceTimersByTimeAsync(100);
    expect(ensureCheckout).not.toHaveBeenCalledWith(expired);
    await mutateWorkspace({ op: 'select', key: expired.key }, 'review');
    expect(ensureCheckout).toHaveBeenCalledWith(expired);
    expect(expired.lastUsedAt).toBe(Date.now());
    expect(loadPull).not.toHaveBeenCalled(); expect(loadComments).not.toHaveBeenCalled();
  });
  it('initializes an unfinished PR once alongside cached tabs without periodic refresh', async () => {
    vi.useFakeTimers();
    const pending = cached(2); pending.info = null; pending.reviewId = null;
    mocks.data.tabs.push(pending);
    vi.mocked(importPull).mockImplementation(async tab => { tab.reviewId = 'imported'; });
    stop = startWorkspace();
    await vi.advanceTimersByTimeAsync(3600000);
    expect(loadPull).toHaveBeenCalledTimes(1);
    expect(loadPull).toHaveBeenCalledWith(pending.ref);
    expect(loadComments).toHaveBeenCalledTimes(1);
    expect(pending.reviewId).toBe('imported');
  });
  it('waits for an explicit refresh and coalesces overlapping requests', async () => {
    const tab = mocks.data.tabs[0];
    const latest = { ...tab.info, title: 'Updated', headRefOid: 'next-head' };
    let finish!: (value: any) => void;
    vi.mocked(loadPull).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    vi.mocked(importPull).mockImplementation(async tab => { tab.reviewedHead = 'next-head'; });
    let settled = false;
    const refresh = mutateWorkspace({ op: 'refresh', key: tab.key }, 'review').then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(tab.loading).toBe(true);
    await mutateWorkspace({ op: 'refresh', key: tab.key }, 'review');
    finish(latest); await refresh;
    expect(loadPull).toHaveBeenCalledTimes(1);
    expect(loadComments).toHaveBeenCalledTimes(1);
    expect(importPull).toHaveBeenCalledTimes(1);
    expect(tab.info.title).toBe('Updated');
    expect(tab.reviewedHead).toBe('next-head');
    expect(tab.loading).toBe(false);
  });
  it('still publishes an offline comment when its five-minute retry becomes due', async () => {
    vi.useFakeTimers();
    const tab = mocks.data.tabs[0];
    tab.comments.push({ id: 'offline', author: 'alice', body: 'Retry me', kind: 'issue', status: 'error', date: '', url: '' });
    mocks.data.outbox.push({ id: 'queued', tab: tab.key, message: 'offline', operation: 'create', nextAttempt: Date.now() + 300000, attempted: false });
    mocks.github.mockResolvedValue(remote(40));
    stop = startWorkspace();
    await vi.advanceTimersByTimeAsync(299999);
    expect(mocks.github).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.github).toHaveBeenCalledTimes(1);
    expect(mocks.github.mock.calls[0][2]).toBe('POST');
    expect(mocks.data.outbox).toHaveLength(0);
    expect(loadPull).not.toHaveBeenCalled();
    expect(loadComments).not.toHaveBeenCalled();
  });
});

it('recovers interrupted agents in closed tabs so they cannot block retention forever', () => {
  const archived = tab(2);
  archived.loading = true;
  archived.comments.push({ id: 'a', kind: 'ai', status: 'working', body: 'Working', author: 'AI', date: '', url: '', editable: false, deleted: false });
  mocks.data.tabs = []; mocks.data.archived = [archived];
  const stop = startWorkspace();
  try {
    expect(archived.loading).toBe(false);
    expect(archived.comments[0].status).toBe('error');
    expect(archived.comments[0].error).toContain('local edits were preserved');
  } finally { stop(); }
});
