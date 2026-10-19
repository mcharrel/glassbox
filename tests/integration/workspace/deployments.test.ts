import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, expect, it, vi } from 'vitest';
import { PullTabSchema, WorkspaceSchema } from '../../../src/api/workspace.js';
import { checks } from '../../../src/client/workspace/checks.js';
import { setDataDir } from '../../../src/db/connection.js';
import { refreshDeployment, stopDeployments } from '../../../src/workspace/deployments.js';
import { workspaceRoutes } from '../../../src/workspace/routes.js';
import { workspaceData } from '../../../src/workspace/storage.js';
import { pullInfo } from '../../unit/workspace/fixtures.js';
let dir: string;
afterEach(() => { stopDeployments(); vi.unstubAllEnvs(); if (dir) rmSync(dir, { recursive: true, force: true }); });
it('runs the CLI, publishes nonblocking API progress, persists results, and renders the merged list', async () => {
  dir = mkdtempSync(join(tmpdir(), 'rev-deployments-'));
  setDataDir(dir);
  // A real subprocess stands in for the external Devflow service; no browser or live credentials.
  writeFileSync(join(dir, 'ddr'), `#!${process.execPath}\nsetTimeout(() => console.log('**api**\\n| DATACENTER | ENV | NAMESPACE | DEPLOYED |\\n| west.example | prod | app | ❌ (missing) |\\n| east.example | prod | app | ✅ (deployed) |'), 100);\n`, { mode: 0o755 });
  vi.stubEnv('PATH', `${dir}:${process.env.PATH}`);
  const t = PullTabSchema.parse({ key: 'ddoghq/example#1', ref: { owner: 'ddoghq', repo: 'example', number: 1, url: '' },
    info: { ...pullInfo(), state: 'MERGED' }, viewer: 'alice', repoRoot: null, reviewId: null });
  workspaceData().tabs.push(t); workspaceData().active = t.key;
  const app = new Hono().route('/api/workspace', workspaceRoutes);
  const pending = refreshDeployment(t);
  const loading = WorkspaceSchema.parse(await (await app.request('/api/workspace')).json());
  expect(loading.tabs[0].deployment?.status).toBe('loading');
  await pending;
  const result = WorkspaceSchema.parse(await (await app.request('/api/workspace')).json());
  expect(result.tabs[0].deployment?.targets).toHaveLength(2);
  expect(result.tabs[0].deployment?.status).toBe('ready');
  const html = String(checks(result.tabs[0]));
  expect(html.indexOf('east.example')).toBeLessThan(html.indexOf('west.example'));
  expect(html).toContain('aria-label="Reached"');
  const saved = WorkspaceSchema.parse(JSON.parse(readFileSync(join(dir, 'workspace.json'), 'utf8')));
  expect(saved.tabs[0].deployment).toEqual(result.tabs[0].deployment);
});
