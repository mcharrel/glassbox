import { Hono } from 'hono';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ tabs: [] as any[], enabled: true, request: vi.fn(), close: vi.fn(), configure: vi.fn(), reconcile: vi.fn(), save: vi.fn(), flush: vi.fn() }));
vi.mock('../../../src/workspace/codex-settings.js', () => ({ codexEnabled: () => mocks.enabled }));
vi.mock('../../../src/workspace/codex-setup.js', () => ({ codexHandshake: async () => ({ request: mocks.request, close: mocks.close }), configureCodex: mocks.configure, codexSetupStatus: async () => ({ state: 'connected' }) }));
vi.mock('../../../src/workspace/storage.js', () => ({ workspaceData: () => ({ tabs: mocks.tabs }), saveWorkspace: mocks.save }));
vi.mock('../../../src/workspace/codex.js', () => ({ flushCodexComments: mocks.flush }));
vi.mock('../../../src/workspace/service.js', () => ({ reconcileCommentRouting: mocks.reconcile }));
import { codexConnectionRoutes } from '../../../src/routes/api/codex-connection.js';
const app = new Hono().route('/', codexConnectionRoutes);
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const post = () => app.request('/codex/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'pr', threadId: id }) });
beforeEach(() => {
  vi.clearAllMocks(); mocks.enabled = true;
  mocks.tabs = [{ key: 'pr', viewer: 'alice', info: { author: { login: 'alice' } } }];
  mocks.request.mockImplementation(async method => method === 'thread/loaded/list' ? { data: [id] } : { thread: { id, name: 'Original chat', status: { type: 'idle' } } });
});
it('links an own PR to the selected existing chat and releases pending comments', async () => {
  expect((await post()).status).toBe(200); expect(mocks.tabs[0].codexThreadId).toBe(id);
  expect(mocks.request).toHaveBeenCalledExactlyOnceWith('thread/read', { threadId: id, includeTurns: false });
  expect(mocks.reconcile).toHaveBeenCalledOnce(); expect(mocks.flush).toHaveBeenCalledOnce(); expect(mocks.close).toHaveBeenCalledOnce();
});
it.each(['other', 'unknown', 'already-linked', 'disabled', 'unloaded'])('does not link %s or change chat settings', async kind => {
  if (kind === 'other') mocks.tabs[0].info.author.login = 'other';
  if (kind === 'unknown') mocks.tabs[0].viewer = '';
  if (kind === 'already-linked') mocks.tabs[0].codexThreadId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  if (kind === 'disabled') mocks.enabled = false;
  if (kind === 'unloaded') mocks.request.mockResolvedValue({ thread: { id, status: { type: 'notLoaded' } } });
  expect((await post()).status).toBeGreaterThanOrEqual(400); expect(mocks.reconcile).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
});
it.each(['closed', 'ownership-changed', 'linked-elsewhere', 'disabled'])('rechecks %s after an in-flight lookup', async kind => {
  mocks.request.mockImplementation(async () => {
    if (kind === 'closed') mocks.tabs = [];
    if (kind === 'ownership-changed') mocks.tabs[0].viewer = 'other';
    if (kind === 'linked-elsewhere') mocks.tabs[0].codexThreadId = 'another';
    if (kind === 'disabled') mocks.enabled = false;
    return { thread: { id, status: { type: 'idle' } } };
  });
  expect((await post()).status).toBe(409); expect(mocks.save).not.toHaveBeenCalled();
});
it('offers only loaded chats and reads metadata without loading history', async () => {
  const response = await app.request('/codex/chats'); expect(await response.json()).toEqual({ chats: [{ id, title: 'Original chat' }] });
  expect(mocks.request.mock.calls.map(call => call[0])).toEqual(['thread/loaded/list', 'thread/read']);
});
it('requires JSON for settings and linking mutations', async () => {
  const r = await app.request('/codex/connection', { method: 'PUT', body: 'enabled=true' }); expect(r.status).toBe(415); expect(mocks.configure).not.toHaveBeenCalled();
});
