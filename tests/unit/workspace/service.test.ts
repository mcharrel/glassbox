import { pullInfo } from './fixtures.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PullTabSchema } from '../../../src/api/workspace.js';

const mocks = vi.hoisted(() => ({
  data: { tabs: [] as any[], archived: [] as any[], active: null as string | null, outbox: [] as any[] },
  github: vi.fn(),
  save: vi.fn(),
  agent: vi.fn(),
  notify: vi.fn(),
  discard: vi.fn(),
}));
vi.mock('../../../src/workspace/storage.js', () => ({
  workspaceData: () => mocks.data,
  saveWorkspace: mocks.save,
}));
vi.mock('../../../src/workspace/codex.js', () => ({ queueCodexComment: mocks.agent, flushCodexComments: vi.fn(), recoverCodexComments: vi.fn(), retryCodexComment: vi.fn() }));
vi.mock('../../../src/workspace/checkout.js', () => ({ importPull: vi.fn(), ensureCheckout: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../../src/workspace/discard.js', () => ({ discardTabData: mocks.discard }));
vi.mock('../../../src/workspace/retention.js', () => ({ startWorkspaceCleanup: vi.fn(() => () => {}) }));
vi.mock('../../../src/workspace/notifications.js', () => ({ notify: mocks.notify }));
vi.mock('../../../src/workspace/github.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/workspace/github.js')>()),
  github: mocks.github,
  loadPull: vi.fn(),
  loadComments: vi.fn().mockResolvedValue([]),
}));
import { flushOutbox, insertTab, mutateWorkspace, queueAnnotation, startWorkspace, syncTab } from '../../../src/workspace/service.js';
import { loadComments, loadPull, parsePullUrl } from '../../../src/workspace/github.js';
import { ensureCheckout, importPull } from '../../../src/workspace/checkout.js';

function tab(number = 1) {
  return PullTabSchema.parse({
    key: `example/project#${number}`,
    ref: parsePullUrl(`https://github.com/example/project/pull/${number}`),
    reviewId: 'review',
    repoRoot: '/checkout',
    info: pullInfo('bob'),
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
  mocks.discard.mockReset().mockResolvedValue(undefined);
  mocks.notify.mockReset();
  mocks.agent.mockReset().mockImplementation((tab, message) => {
    if (tab.codexThreadId && !message.codex && !message.deleted)
      message.codex = { threadId: tab.codexThreadId, mode: 'queue', status: 'queued' };
  });
  mocks.data.tabs = [tab()];
  mocks.data.archived = [];
  mocks.data.outbox = [];
  mocks.data.active = 'example/project#1';
});
describe('durable comment outbox', () => {
  it('posts another PR’s comment once, records its link and never calls Codex', async () => {
    mocks.github.mockResolvedValue(remote(10));
    await mutateWorkspace(
      { op: 'comment', key: 'example/project#1', body: 'Please simplify this' },
      'review',
    );
    await vi.waitFor(() => expect(mocks.data.outbox).toHaveLength(0));
    expect(mocks.github).toHaveBeenCalledTimes(1);
    expect(mocks.github.mock.calls[0][3].body).toContain('<!-- glassbox:');
    expect(mocks.data.tabs[0].comments[0].url).toContain('issuecomment-10');
    expect(mocks.agent).not.toHaveBeenCalled();
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
  it('deletes closed tabs and cancels their offline comments', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.github.mockRejectedValueOnce(new Error('offline'));
    await mutateWorkspace({ op: 'comment', key: 'example/project#1', body: 'Keep this comment' }, 'review');
    await vi.waitFor(() => expect(mocks.data.tabs[0].comments[0].status).toBe('error'));
    await mutateWorkspace({ op: 'close', key: 'example/project#1' }, 'review');
    expect(mocks.data.tabs).toHaveLength(0);
    expect(mocks.data.archived).toHaveLength(0);
    expect(mocks.data.outbox).toHaveLength(0);
    expect(mocks.discard).toHaveBeenCalledTimes(1);
    mocks.github.mockResolvedValueOnce([]).mockResolvedValueOnce(remote(12));
    now += 300000;
    await flushOutbox();
    expect(mocks.github).toHaveBeenCalledTimes(1);
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
it('drops stale description HTML after editing while preserving the raw Markdown', async () => {
  const t = mocks.data.tabs[0];
  t.info.bodyHTML = '<p>Previous description</p>';
  mocks.github.mockResolvedValue({});
  await mutateWorkspace({ op: 'edit', key: t.key, body: '# New description' }, 'review');
  expect(t.info.body).toBe('# New description');
  expect(t.info.bodyHTML).toBeUndefined();
  expect(mocks.github.mock.calls[0][3]).toEqual({ body: '# New description' });
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
  const info = { id: 'pr', author: { login: 'bob' }, title: 'PR', reviews: [], reviewRequests: [], state: 'OPEN', isDraft: true, mergeStateStatus: 'DRAFT', baseRefName: 'main', headRefName: 'topic' };
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


describe('GitHub refresh', () => {
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

  it.each([0, 1, 5])('uses cached data for %i tabs before the five-minute refresh, including startup and selecting an already-open PR', async count => {
    vi.useFakeTimers();
    mocks.data.tabs = Array.from({ length: count }, (_, index) => cached(index + 1));
    stop = startWorkspace();
    await vi.advanceTimersByTimeAsync(299999);
    for (const tab of [...mocks.data.tabs]) {
      await mutateWorkspace({ op: 'select', key: tab.key }, 'review');
      await mutateWorkspace({ op: 'open', url: tab.ref.url }, 'review');
    }
    expect(loadPull).not.toHaveBeenCalled();
    expect(loadComments).not.toHaveBeenCalled();
    expect(mocks.github).not.toHaveBeenCalled();
    expect(importPull).not.toHaveBeenCalled();
  });
  it.each([0, 1, 5])('refreshes all %i open tabs every five minutes and stops when the workspace stops', async count => {
    vi.useFakeTimers();
    mocks.data.tabs = Array.from({ length: count }, (_, index) => cached(index + 1));
    for (const [index, tab] of mocks.data.tabs.entries()) tab.info.state = ['OPEN', 'MERGED', 'CLOSED'][index % 3];
    mocks.data.archived = [cached(99)];
    vi.mocked(loadPull).mockImplementation(async ref => ({ ...cached(ref.number).info!, title: `Refreshed ${ref.number}` }));
    stop = startWorkspace();
    await vi.advanceTimersByTimeAsync(300000);
    expect(vi.mocked(loadPull).mock.calls.map(([ref]) => ref.number)).toEqual(mocks.data.tabs.map(tab => tab.ref.number));
    expect(loadComments).toHaveBeenCalledTimes(count);
    for (const tab of mocks.data.tabs) expect(tab.info.title).toBe(`Refreshed ${tab.ref.number}`);
    expect(mocks.data.archived).toEqual([]);
    await vi.advanceTimersByTimeAsync(300000);
    expect(loadPull).toHaveBeenCalledTimes(count * 2);
    expect(loadComments).toHaveBeenCalledTimes(count * 2);
    expect(importPull).not.toHaveBeenCalled();
    stop(); stop = undefined;
    await vi.advanceTimersByTimeAsync(600000);
    expect(loadPull).toHaveBeenCalledTimes(count * 2);
  });
  it('refreshes silently without changing source, reading state, local comments, or checkout activity', async () => {
    vi.useFakeTimers();
    const tab = mocks.data.tabs[0];
    const activity = Date.now() - 15 * 24 * 60 * 60 * 1000;
    tab.lastUsedAt = activity; tab.updatedAt = activity; tab.view = 'file';
    const local = { id: 'local', body: 'Private', destination: 'local', kind: 'issue', status: 'done' };
    tab.comments.push(local);
    let finish!: (value: any) => void;
    vi.mocked(loadPull).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const remote = { id: 'remote', remoteId: 42, body: 'New feedback', kind: 'issue', status: 'synced' };
    vi.mocked(loadComments).mockResolvedValue([remote] as any);
    stop = startWorkspace(); await vi.advanceTimersByTimeAsync(300000);
    expect(tab.loading).toBe(false);
    finish({ ...tab.info, headRefOid: 'new-head', state: 'MERGED' });
    await vi.advanceTimersByTimeAsync(0);
    expect(tab.info.state).toBe('MERGED'); expect(tab.info.headRefOid).toBe('new-head');
    expect(mocks.notify).toHaveBeenCalledWith('PR', 'PR merged');
    expect(tab.comments).toEqual([local, remote]);
    expect(tab.reviewedHead).toBe('head'); expect(tab.view).toBe('file');
    expect(tab.lastUsedAt).toBe(activity); expect(tab.updatedAt).toBe(Date.now());
    expect(tab.loading).toBe(false); expect(importPull).not.toHaveBeenCalled();
    expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.github).not.toHaveBeenCalled();
  });
  it('keeps an expired checkout expired during refresh and migrates legacy activity', async () => {
    vi.useFakeTimers();
    const expired = cached(2); expired.checkoutEvicted = true;
    expired.lastUsedAt = 0; expired.updatedAt = Date.now() - 15 * 24 * 60 * 60 * 1000;
    const activity = expired.updatedAt;
    mocks.data.tabs.push(expired); vi.mocked(ensureCheckout).mockClear();
    stop = startWorkspace(); await vi.advanceTimersByTimeAsync(600000);
    expect(expired.checkoutEvicted).toBe(true);
    expect(expired.lastUsedAt).toBe(activity); expect(expired.updatedAt).toBe(Date.now());
    expect(ensureCheckout).not.toHaveBeenCalledWith(expired);
    expect(importPull).not.toHaveBeenCalled(); expect(loadComments).toHaveBeenCalledWith(expired);
  });
  it('keeps cached data after failure and retries on the next five-minute tick', async () => {
    vi.useFakeTimers();
    const tab = mocks.data.tabs[0], info = tab.info;
    vi.mocked(loadPull).mockRejectedValueOnce(new Error('offline'));
    stop = startWorkspace(); await vi.advanceTimersByTimeAsync(300000);
    expect(tab.error).toBe('offline'); expect(tab.info).toBe(info); expect(tab.loading).toBe(false);
    await vi.advanceTimersByTimeAsync(299999); expect(loadPull).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(loadPull).toHaveBeenCalledTimes(2);
    expect(tab.error).toBeUndefined(); expect(loadComments).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('coalesces slow polls and waits for a requested full refresh (closed: %s)', async closed => {
    vi.useFakeTimers();
    const tab = mocks.data.tabs[0];
    let finish!: (value: any) => void;
    vi.mocked(loadPull).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    stop = startWorkspace(); await vi.advanceTimersByTimeAsync(600000);
    expect(loadPull).toHaveBeenCalledTimes(1);
    const latest = { ...tab.info, headRefOid: 'new-head' };
    vi.mocked(loadPull).mockResolvedValue(latest);
    vi.mocked(importPull).mockImplementation(async tab => { tab.reviewedHead = 'new-head'; });
    let settled = false;
    const refresh = mutateWorkspace({ op: 'refresh', key: tab.key }, 'review').then(() => { settled = true; });
    const repeated = mutateWorkspace({ op: 'refresh', key: tab.key }, 'review');
    await Promise.resolve(); expect(settled).toBe(false);
    const close = closed ? mutateWorkspace({ op: 'close', key: tab.key }, 'review') : Promise.resolve();
    finish(latest); await Promise.all([refresh, repeated, close]);
    expect(loadPull).toHaveBeenCalledTimes(closed ? 1 : 2);
    expect(importPull).toHaveBeenCalledTimes(closed ? 0 : 1);
    expect(tab.reviewedHead).toBe(closed ? 'head' : 'new-head');
    expect(tab.loading).toBe(false);
    if (closed) {
      await vi.advanceTimersByTimeAsync(300000);
      expect(loadPull).toHaveBeenCalledTimes(1); expect(mocks.data.tabs).toHaveLength(0);
    }
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
  it('initializes an unfinished PR immediately alongside cached tabs', async () => {
    vi.useFakeTimers();
    const pending = cached(2); pending.info = null; pending.reviewId = null;
    mocks.data.tabs.push(pending);
    vi.mocked(importPull).mockImplementation(async tab => { tab.reviewId = 'imported'; });
    stop = startWorkspace();
    await vi.advanceTimersByTimeAsync(299999);
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
    const repeated = mutateWorkspace({ op: 'refresh', key: tab.key }, 'review');
    finish(latest); await Promise.all([refresh, repeated]);
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
    tab.info.author.login = 'bob';
    vi.mocked(loadPull).mockResolvedValue(tab.info);
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
    expect(loadPull).toHaveBeenCalledTimes(1);
    expect(loadComments).toHaveBeenCalledTimes(1);
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
it('migrates an existing code conversation to local-only and preserves it on GitHub refresh', async () => {
  const tab = mocks.data.tabs[0];
  const info = { id: 'pr', author: { login: 'alice' }, title: 'PR', reviews: [], reviewRequests: [], state: 'OPEN', isDraft: true, mergeStateStatus: 'DRAFT', baseRefName: 'main', headRefName: 'topic' };
  tab.info = info; vi.mocked(loadPull).mockResolvedValue(info as any);
  const original = { id: 'local-comment', remoteId: 42, kind: 'review', path: 'file.ts', body: 'Please fix this', author: 'alice', date: '', url: '', deleted: false, status: 'synced', editable: true, codex: { threadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'queued', mode: 'queue' } };
  tab.comments.push(original);
  vi.mocked(loadComments).mockResolvedValueOnce([{ ...original, id: 'remote-comment', codex: undefined, body: 'Updated from GitHub' }] as any);
  await syncTab(tab);
  expect(tab.comments[0]).toMatchObject({ id: 'local-comment', body: 'Please fix this', destination: 'local', codex: original.codex });
  expect(tab.comments[0].codex?.threadId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

describe('comment scope and ownership routing', () => {
  const chat = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  function own() {
    const t = mocks.data.tabs[0]; t.info = pullInfo('ALICE'); t.codexThreadId = chat;
    vi.mocked(loadPull).mockResolvedValue(t.info);
    vi.mocked(loadComments).mockResolvedValue([]);
    return t;
  }
  async function codeComment(t: any, body: string) {
    const queries = await import('../../../src/db/queries.js');
    vi.spyOn(queries, 'getReviewFile').mockResolvedValue({ review_id: t.reviewId, file_path: 'file.ts', diff_data: null } as any);
    await queueAnnotation(t.reviewId, { id: crypto.randomUUID(), content: body, review_file_id: 'file', side: 'new', line_number: 8, created_at: '' } as any);
  }
  it.each(['alice', 'bob', null])('publishes Main comments to GitHub for author %s without delivering to Codex', async author => {
    const t = own(); t.info = author === null ? null : pullInfo(author);
    mocks.github.mockResolvedValue(remote(120));
    await mutateWorkspace({ op: 'comment', key: t.key, body: 'PR update' }, 'review');
    await vi.waitFor(() => expect(mocks.data.outbox).toHaveLength(0));
    expect(t.comments[0]).toMatchObject({ kind: 'issue', destination: 'github', status: 'synced', remoteId: 120, codexRequested: false });
    expect(mocks.github.mock.calls[0][1]).toBe('repos/example/project/issues/1/comments');
    expect(t.comments[0].codex).toBeUndefined(); expect(mocks.agent).not.toHaveBeenCalled();
    if (author === 'alice') expect(t.codexThreadId).toBe(chat);
  });
  it('publishes edits and deletes of own Main comments and receives remote edits', async () => {
    const t = own(); mocks.github.mockResolvedValue(remote(121));
    await mutateWorkspace({ op: 'comment', key: t.key, body: 'Status update' }, 'review');
    await vi.waitFor(() => expect(mocks.data.outbox).toHaveLength(0));
    const original = t.comments[0];
    original.bodyHTML = '<p>Status update</p>';
    await mutateWorkspace({ op: 'edit-comment', key: t.key, id: original.id, body: 'Updated status' }, 'review');
    expect(original.bodyHTML).toBeUndefined();
    await vi.waitFor(() => expect(mocks.data.outbox).toHaveLength(0));
    expect(mocks.github.mock.calls[1].slice(1, 3)).toEqual(['repos/example/project/issues/comments/121', 'PATCH']);
    vi.mocked(loadComments).mockResolvedValue([{ ...original, body: 'Edited on GitHub' }]);
    await syncTab(t); expect(t.comments[0].body).toBe('Edited on GitHub');
    await mutateWorkspace({ op: 'delete-comment', key: t.key, id: original.id }, 'review');
    await vi.waitFor(() => expect(mocks.data.outbox).toHaveLength(0));
    expect(mocks.github.mock.calls[2].slice(1, 3)).toEqual(['repos/example/project/issues/comments/121', 'DELETE']);
    expect(mocks.agent).not.toHaveBeenCalled();
  });
  it('holds Main comments for authentication, then retries offline publication on own PRs', async () => {
    const t = own(); t.viewer = '';
    let now = 1000; vi.spyOn(Date, 'now').mockImplementation(() => now);
    await mutateWorkspace({ op: 'comment', key: t.key, body: 'Public update' }, 'review');
    await flushOutbox(); expect(mocks.github).not.toHaveBeenCalled();
    mocks.github.mockRejectedValueOnce(new Error('offline'));
    t.viewer = 'alice'; await flushOutbox();
    expect(t.comments[0]).toMatchObject({ destination: 'github', status: 'error' });
    now += 299999; await flushOutbox(); expect(mocks.github).toHaveBeenCalledTimes(1);
    mocks.github.mockResolvedValueOnce([]).mockResolvedValueOnce(remote(122));
    now++; await flushOutbox();
    expect(t.comments[0].status).toBe('synced'); expect(mocks.data.outbox).toHaveLength(0);
    expect(mocks.agent).not.toHaveBeenCalled();
  });
  it.each(['local', undefined])('does not republish or forward historical private Main conversations (saved destination: %s)', async destination => {
    const t = own();
    const legacy = { id: 'legacy', kind: 'issue', body: 'Private history', destination, status: 'done', editable: true,
      codexRequested: true, codex: { threadId: chat, mode: 'queue', status: 'queued' } };
    t.comments.push(legacy);
    await flushOutbox(); await syncTab(t);
    await mutateWorkspace({ op: 'edit-comment', key: t.key, id: legacy.id, body: 'Still private' }, 'review');
    expect(t.comments[0]).toMatchObject({ destination: 'local', body: 'Still private' });
    expect(t.comments[0].codex).toBeUndefined(); expect(mocks.github).not.toHaveBeenCalled(); expect(mocks.agent).not.toHaveBeenCalled();
    await expect(mutateWorkspace({ op: 'comment', key: t.key, body: 'Reply', parentKey: legacy.id }, 'review')).rejects.toThrow('Main view composer');
  });
  it('keeps own PR code comments, replies, edits and deletes local through refresh', async () => {
    const t = own();
    await codeComment(t, 'Please change this');
    const first = t.comments[0];
    expect(first).toMatchObject({ destination: 'local', status: 'done', codex: { threadId: chat } });
    await mutateWorkspace({ op: 'comment', key: t.key, body: 'And keep the API', parentKey: first.id }, 'review');
    const reply = t.comments[1];
    expect(reply).toMatchObject({ destination: 'local', kind: 'review', path: 'file.ts', parentKey: first.id });
    await mutateWorkspace({ op: 'edit-comment', key: t.key, id: first.id, body: 'Clarified request' }, 'review');
    await mutateWorkspace({ op: 'delete-comment', key: t.key, id: reply.id }, 'review');
    await syncTab(t);
    expect(t.comments).toEqual([first, reply]);
    expect(first.body).toBe('Clarified request'); expect(reply.deleted).toBe(true);
    expect(mocks.data.outbox).toHaveLength(0); expect(mocks.github).not.toHaveBeenCalled();
    expect(mocks.agent).toHaveBeenCalledTimes(2);
  });
  it.each(['alice', 'bob'])('waits for ownership and then routes to author %s exactly once', async author => {
    const t = mocks.data.tabs[0]; t.info = null; t.codexThreadId = chat;
    await codeComment(t, 'Wait for metadata');
    await flushOutbox();
    expect(mocks.github).not.toHaveBeenCalled(); expect(mocks.agent).not.toHaveBeenCalled();
    expect(mocks.data.outbox).toHaveLength(1);
    vi.mocked(loadPull).mockResolvedValue(pullInfo(author));
    vi.mocked(loadComments).mockResolvedValue([]);
    mocks.github.mockResolvedValue(remote(101));
    await syncTab(t); await flushOutbox();
    expect(mocks.data.outbox).toHaveLength(0);
    expect(t.comments[0].destination).toBe(author === 'alice' ? 'local' : 'github');
    expect(mocks.github).toHaveBeenCalledTimes(author === 'alice' ? 0 : 1);
    expect(mocks.agent).toHaveBeenCalledTimes(author === 'alice' ? 1 : 0);
    if (author === 'bob') expect(t.codexThreadId).toBeUndefined();
  });
  it('holds writes when the authenticated viewer is unknown', async () => {
    const t = mocks.data.tabs[0]; t.viewer = '';
    await codeComment(t, 'Private until identified');
    await flushOutbox();
    expect(mocks.github).not.toHaveBeenCalled(); expect(mocks.agent).not.toHaveBeenCalled();
    t.viewer = 'bob'; await flushOutbox();
    expect(t.comments[0].destination).toBe('local'); expect(mocks.data.outbox).toHaveLength(0);
  });
  it('cancels delayed and ambiguous own-PR writes, including archived edits/deletes, while publishing other PR comments', async () => {
    const mine = own(); const other = tab(2); other.codexThreadId = chat;
    for (const t of [mine, other]) {
      t.comments.push({ id: `message-${t.key}`, body: 'Saved', author: 'alice', date: '', url: '', kind: 'review', path: 'file.ts', status: 'pending', codex: { threadId: chat, mode: 'queue', status: 'queued' } });
      for (const operation of t === mine ? ['create', 'edit', 'delete'] : ['create'])
        mocks.data.outbox.push({ id: `${t.key}-${operation}`, tab: t.key, message: t.comments[0].id, operation, nextAttempt: t === mine ? Date.now() + 300000 : 0, attempted: t === mine });
    }
    mocks.data.tabs = [other]; mocks.data.archived = [mine];
    mocks.github.mockResolvedValue(remote(103));
    await flushOutbox();
    expect(mocks.data.outbox).toHaveLength(0);
    expect(other.comments[0].codex).toBeUndefined(); expect(other.codexThreadId).toBeUndefined();
    expect(mocks.github).toHaveBeenCalledTimes(1); expect(mocks.github.mock.calls[0][0].number).toBe(2);
  });
  it('never publishes a private message if the account subsequently changes', async () => {
    const t = own();
    await codeComment(t, 'Private');
    const message = t.comments[0]; t.viewer = 'another-account';
    await mutateWorkspace({ op: 'edit-comment', key: t.key, id: message.id, body: 'Still private' }, 'review');
    await mutateWorkspace({ op: 'delete-comment', key: t.key, id: message.id }, 'review');
    expect(message.destination).toBe('local'); expect(message.codex).toBeUndefined();
    expect(mocks.data.outbox).toHaveLength(0); expect(mocks.github).not.toHaveBeenCalled();
  });
  it('keeps edits of already-public comments local on own PRs without losing them on refresh', async () => {
    const t = own(); const original = { id: 'existing', remoteId: 106, body: 'Published earlier', kind: 'review', path: 'file.ts', author: 'alice', date: '', url: 'https://github.com/example/project/pull/1', status: 'synced', editable: true };
    t.comments.push(original); vi.mocked(loadComments).mockResolvedValue([{ ...original } as any]);
    await mutateWorkspace({ op: 'edit-comment', key: t.key, id: original.id, body: 'Local correction' }, 'review');
    await syncTab(t); expect(t.comments[0].body).toBe('Local correction');
    await mutateWorkspace({ op: 'delete-comment', key: t.key, id: original.id }, 'review');
    await syncTab(t); expect(t.comments[0].deleted).toBe(true);
    expect(mocks.github).not.toHaveBeenCalled(); expect(mocks.agent).not.toHaveBeenCalled();
  });
  it('retains unlinked private comments and only queues fresh requests when their chat is linked later', async () => {
    const t = own(); delete t.codexThreadId;
    await codeComment(t, 'New request');
    t.comments.push({ id: 'imported', kind: 'review', body: 'Historical annotation', destination: 'local', status: 'done' });
    await syncTab(t);
    expect(t.comments).toHaveLength(2); expect(t.comments[0].codex).toBeUndefined();
    t.codexThreadId = chat; await flushOutbox(); await flushOutbox();
    expect(t.comments[0].codex?.status).toBe('queued'); expect(t.comments[1].codex).toBeUndefined();
    expect(mocks.github).not.toHaveBeenCalled();
  });
  it('rejects invalid local replies and never turns them into public replies', async () => {
    const t = own();
    await expect(mutateWorkspace({ op: 'comment', key: t.key, body: 'Reply', parentKey: 'missing' }, 'review')).rejects.toThrow('not found');
    await codeComment(t, 'Root');
    t.info = pullInfo('bob');
    await expect(mutateWorkspace({ op: 'comment', key: t.key, body: 'Reply', parentKey: t.comments[0].id }, 'review')).rejects.toThrow('own PRs');
    expect(mocks.github).not.toHaveBeenCalled();
  });
});

it('keeps imported annotations local on own PRs without treating historical feedback as a new Codex request', async () => {
  const queries = await import('../../../src/db/queries.js');
  const { queueAnnotation, queueAnnotationChange } = await import('../../../src/workspace/service.js');
  const t = mocks.data.tabs[0]; t.info = pullInfo(); t.codexThreadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  vi.spyOn(queries, 'getReviewFile').mockResolvedValue({ review_id: 'review', file_path: 'file.ts', diff_data: null } as any);
  await queueAnnotation('review', { id: 'old-note', content: 'Imported note', review_file_id: 'file', side: 'new', line_number: 8, created_at: '' } as any, false);
  expect(t.comments[0]).toMatchObject({ destination: 'local', codexRequested: false, path: 'file.ts', line: 8 });
  expect(mocks.agent).not.toHaveBeenCalled();
  await queueAnnotation('review', { id: 'new-note', content: 'Fresh note', review_file_id: 'file', side: 'new', line_number: 9, created_at: '' } as any);
  queueAnnotationChange('review', 'new-note', 'edit', 'Edited note');
  queueAnnotationChange('review', 'new-note', 'delete');
  expect(t.comments[1]).toMatchObject({ destination: 'local', body: 'Edited note', deleted: true });
  expect(mocks.agent).toHaveBeenCalledTimes(1); expect(mocks.github).not.toHaveBeenCalled();
});

it('still refreshes other people’s GitHub comments on own PRs', async () => {
  const t = mocks.data.tabs[0]; t.info = pullInfo();
  vi.mocked(loadPull).mockResolvedValue(t.info);
  vi.mocked(loadComments).mockResolvedValue([{ id: 'remote', remoteId: 110, author: 'bob', body: 'Feedback', kind: 'issue', status: 'synced', date: '', url: '', editable: false } as any]);
  await syncTab(t); expect(t.comments[0].body).toBe('Feedback');
  vi.mocked(loadComments).mockResolvedValue([{ ...t.comments[0], body: 'Updated feedback' }]);
  await syncTab(t); expect(t.comments[0].body).toBe('Updated feedback');
  expect(mocks.agent).not.toHaveBeenCalled(); expect(mocks.github).not.toHaveBeenCalled();
});

it('starts a fresh review after closing and reopening the same PR', async () => {
  const old = mocks.data.tabs[0]; old.comments.push({ body: 'Discard me' });
  await mutateWorkspace({ op: 'close', key: old.key }, 'review');
  expect(mocks.data.active).toBeNull();
  vi.mocked(loadPull).mockResolvedValue(pullInfo());
  await mutateWorkspace({ op: 'open', url: old.ref.url }, 'review');
  expect(mocks.data.tabs[0]).not.toBe(old);
  expect(mocks.data.tabs[0].comments).toEqual([]);
  expect(mocks.data.tabs[0].reviewId).toBeNull();
  await syncTab(mocks.data.tabs[0]);
});
it('leaves the tab visible if its unpublished source cannot be discarded', async () => {
  const old = mocks.data.tabs[0];
  mocks.discard.mockRejectedValue(new Error('Unpublished changes'));
  await expect(mutateWorkspace({ op: 'close', key: old.key }, 'review')).rejects.toThrow('Unpublished changes');
  expect(mocks.data.tabs).toEqual([old]); expect(mocks.data.active).toBe(old.key);
  expect(mocks.data.archived).toEqual([]);
});
it('waits for a pending import before deleting, and prevents a late metadata response from restarting it', async () => {
  const old = mocks.data.tabs[0];
  let resolve!: (value: ReturnType<typeof pullInfo>) => void;
  vi.mocked(loadPull).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const sync = syncTab(old);
  const close = mutateWorkspace({ op: 'close', key: old.key }, 'review');
  expect(mocks.discard).not.toHaveBeenCalled();
  resolve(pullInfo()); await Promise.all([sync, close]);
  expect(mocks.discard).toHaveBeenCalledWith(old);
  expect(mocks.data.tabs).toEqual([]); expect(mocks.data.archived).toEqual([]);
});
it('removes legacy archived tabs on startup without restoring them on reopening', async () => {
  const old = tab(9); mocks.data.tabs = []; mocks.data.archived = [old];
  const stop = startWorkspace();
  try {
    await vi.waitFor(() => expect(mocks.data.archived).toEqual([]));
    expect(mocks.discard).toHaveBeenCalledWith(old);
    expect(mocks.data.tabs).toEqual([]);
  } finally { stop(); }
});
