import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PullTabSchema, ThreadMessageSchema } from '../../../src/api/workspace.js';
const mocks = vi.hoisted(() => ({ dataDir: '', request: vi.fn() }));
vi.mock('../../../src/ai/config.js', () => ({
  loadAIConfig: () => ({
    platform: 'openai',
    model: 'chosen-guidance-model',
    apiKey: 'fixture',
    keySource: 'config',
  }),
}));
vi.mock('../../../src/ai/client.js', () => ({ sendAIRequest: mocks.request }));
vi.mock('../../../src/db/connection.js', () => ({ getDataDir: () => mocks.dataDir }));
vi.mock('../../../src/workspace/storage.js', () => ({ saveWorkspace: vi.fn() }));
import { startCommentAgent } from '../../../src/workspace/agent.js';
let root: string;
let head: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'glassbox-agent-test-'));
  mocks.dataDir = root;
  execFileSync('git', ['init', '-q', root]);
  writeFileSync(join(root, 'example.ts'), 'export const count = 1;\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'fixture',
    ],
    { cwd: root },
  );
  head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  mocks.request.mockReset();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const tab = PullTabSchema.parse({
    key: 'example/project#1',
    ref: { owner: 'example', repo: 'project', number: 1, url: 'https://github.com/example/project/pull/1' },
    info: null,
    reviewId: 'r1',
    repoRoot: root,
    reviewedHead: head,
  });
  const comment = ThreadMessageSchema.parse({
    id: 'c1',
    body: 'Use 2',
    author: 'alice',
    date: '2026-01-01T00:00:00Z',
    kind: 'review',
    path: 'example.ts',
    line: 1,
  });
  return { tab, comment };
}
it('uses the selected guidance model and edits an isolated checkout, preserving the reviewed source', async () => {
  mocks.request.mockResolvedValue({
    content: JSON.stringify({
      edits: [{ path: 'example.ts', before: 'count = 1', after: 'count = 2' }],
      reply: 'Updated the count.',
      done: true,
    }),
  });
  const { tab, comment } = fixture();
  startCommentAgent(tab, comment);
  await vi.waitFor(() => expect(tab.comments[0].status).toBe('done'), { timeout: 5000 });
  expect(mocks.request.mock.calls[0][0].model).toBe('chosen-guidance-model');
  expect(readFileSync(join(root, 'example.ts'), 'utf8')).toContain('count = 1');
  expect(readFileSync(join(root, 'agents', tab.comments[0].id, 'example.ts'), 'utf8')).toContain('count = 2');
  expect(tab.comments[0].body).toContain('have not been pushed');
});
it('rejects edits outside the checkout and reports the blocker in the thread', async () => {
  mocks.request.mockResolvedValue({
    content: JSON.stringify({
      edits: [{ path: '../outside.txt', before: 'secret', after: 'changed' }],
      done: true,
    }),
  });
  const { tab, comment } = fixture();
  startCommentAgent(tab, comment);
  await vi.waitFor(() => expect(tab.comments[0].status).toBe('error'), { timeout: 5000 });
  expect(tab.comments[0].error).toContain('Not a tracked file');
});
