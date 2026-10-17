import { pullInfo } from './fixtures.js';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PullTabSchema, type PullTab } from '../../../src/api/workspace.js';
import type { AppEnv } from '../../../src/types.js';
const mocks = vi.hoisted(() => ({ data: { tabs: [] as PullTab[], archived: [] as PullTab[], active: null, externalSelection: 0 }, mutate: vi.fn(), save: vi.fn() }));
vi.mock('../../../src/workspace/storage.js', () => ({ workspaceData: () => mocks.data, saveWorkspace: mocks.save }));
vi.mock('../../../src/workspace/service.js', () => ({ mutateWorkspace: mocks.mutate, reconcileCommentRouting: vi.fn() }));
import { authorizeControl, controlPath, registerControl } from '../../../src/workspace/control.js';
import { workspaceRoutes } from '../../../src/workspace/routes.js';
let dir: string;
let app: Hono<AppEnv>;
const chat = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const url = 'https://github.com/owner/repo/pull/123/files';
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rev-control-')); vi.stubEnv('REV_CONFIG_DIR', dir);
  mocks.data.tabs = []; mocks.data.archived = []; mocks.data.externalSelection = 0;
  mocks.mutate.mockReset().mockImplementation(async () => {
    if (!mocks.data.tabs.length) mocks.data.tabs.push(PullTabSchema.parse({ key: 'owner/repo#123', ref: { owner: 'owner', repo: 'repo', number: 123, url }, reviewId: null, repoRoot: null, info: null }));
  });
  app = new Hono<AppEnv>(); app.use('*', async (c, next) => { c.set('reviewId', 'review'); await next(); }); app.route('/api/workspace', workspaceRoutes);
});
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
const post = (body: unknown, token?: string) => app.request('/api/workspace/codex-open', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'x-rev-token': token } : {}) }, body: JSON.stringify(body) });
it('requires a local secret, stored only in an owner-readable connection file', async () => {
  const stop = registerControl(4183); const connection = JSON.parse(readFileSync(controlPath(), 'utf8'));
  expect(statSync(controlPath()).mode & 0o777).toBe(0o600);
  expect(authorizeControl(connection.token)).toBe(true); expect(authorizeControl('bad')).toBe(false);
  expect((await post({ url, threadId: chat })).status).toBe(401); expect(mocks.mutate).not.toHaveBeenCalled(); stop();
});
it('opens the correct PR and records its originating chat without waiting for GitHub', async () => {
  const stop = registerControl(4183); const { token } = JSON.parse(readFileSync(controlPath(), 'utf8'));
  const result = await post({ url, threadId: chat }, token);
  expect(result.status).toBe(200); expect(mocks.data.tabs[0].codexThreadId).toBe(chat);
  expect(mocks.data.externalSelection).toBe(1); stop();
});
it('rejects another chat trying to silently replace the original binding', async () => {
  const stop = registerControl(4183); const { token } = JSON.parse(readFileSync(controlPath(), 'utf8'));
  await post({ url, threadId: chat }, token); mocks.mutate.mockClear();
  expect((await post({ url, threadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, token)).status).toBe(409);
  expect(mocks.mutate).not.toHaveBeenCalled(); expect(mocks.data.tabs[0].codexThreadId).toBe(chat); stop();
});
it('does not remove a newer server registration when the old server closes', () => {
  const oldStop = registerControl(4183); const newStop = registerControl(4184); oldStop();
  expect(JSON.parse(readFileSync(controlPath(), 'utf8')).port).toBe(4184); newStop();
});

it('opens another person’s PR without binding a Codex chat', async () => {
  const stop = registerControl(4183); const { token } = JSON.parse(readFileSync(controlPath(), 'utf8'));
  await mocks.mutate();
  mocks.data.tabs[0].viewer = 'alice'; mocks.data.tabs[0].info = pullInfo('bob');
  const response = await post({ url, threadId: chat }, token);
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ linked: false });
  expect(mocks.data.tabs[0].codexThreadId).toBeUndefined(); stop();
});
