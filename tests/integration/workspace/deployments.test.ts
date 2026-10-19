import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type RequestListener, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompanyDeploymentsSchema } from '../../../src/api/company-deployments.js';
import { PullTabSchema, WorkspaceSchema } from '../../../src/api/workspace.js';
import { checks } from '../../../src/client/workspace/checks.js';
import { pullInfo } from '../../unit/workspace/fixtures.js';

let dir: string;
let server: Server | undefined;
let deployments: typeof import('../../../src/workspace/deployments.js');
const report = [
  '**worker**', '| DATACENTER | ENV | NAMESPACE | DEPLOYED |',
  '| east.example | prod | app | (missing) |',
  '**api**', '| DATACENTER | ENV | NAMESPACE | DEPLOYED |',
  '| federal.example | gov | app | (deployed) |',
  '| east.example | prod | app | (deployed) |',
  '| west.example | staging | app | (missing) |',
].join('\n');
const ref = { owner: 'example-org', repo: 'example', number: 1, url: 'https://github.com/example-org/example/pull/1' };
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'rev-deployments-'));
  vi.stubEnv('GLASSBOX_CONFIG_DIR', dir);
  vi.resetModules();
  const { setDataDir } = await import('../../../src/db/connection.js');
  setDataDir(dir);
  deployments = await import('../../../src/workspace/deployments.js');
});
afterEach(async () => {
  deployments.stopDeployments();
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server!.close(() => resolve())); server = undefined; }
  vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true });
});
async function endpoint(handler: RequestListener): Promise<string> {
  server = createServer(handler);
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
  return `http://127.0.0.1:${address.port}`;
}

it('saves local settings, runs a real command and renders persisted results without blocking workspace reads', async () => {
  const { workspaceData } = await import('../../../src/workspace/storage.js');
  const { workspaceRoutes } = await import('../../../src/workspace/routes.js');
  const { companyDeploymentsRoutes } = await import('../../../src/routes/api/company-deployments.js');
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ unrelatedPreference: true }));
  writeFileSync(join(dir, 'report.cjs'), `setTimeout(() => console.log(${JSON.stringify(report)}), 100);`);
  const app = new Hono().route('/api/workspace', workspaceRoutes).route('/api', companyDeploymentsRoutes);
  const config = CompanyDeploymentsSchema.parse({ enabled: true, organizations: ['Example-Org'], command: `"${process.execPath}" report.cjs` });
  const savedResponse = await app.request('/api/company/deployments', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
  expect(savedResponse.status).toBe(200);
  const settings = await savedResponse.json();
  expect(settings.organizations).toEqual(['example-org']);
  expect(await (await app.request('/api/company/deployments')).json()).toEqual(settings);
  const savedConfig = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  expect(savedConfig).toEqual({ unrelatedPreference: true, companyDeployments: settings });
  const invalid = await app.request('/api/company/deployments', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
  expect(invalid.status).toBe(400);
  const form = await app.request('/api/company/deployments', { method: 'PUT', body: JSON.stringify(config) });
  expect(form.status).toBe(415);
  expect(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))).toEqual(savedConfig);
  expect(statSync(join(dir, 'config.json')).mode & 0o777).toBe(0o600);
  const t = PullTabSchema.parse({ key: 'example-org/example#1', ref, info: { ...pullInfo(), state: 'MERGED' }, repoRoot: null, reviewId: null });
  workspaceData().tabs.push(t); workspaceData().active = t.key;
  const pending = deployments.refreshDeployment(t);
  const loading = WorkspaceSchema.parse(await (await app.request('/api/workspace')).json());
  expect(loading.tabs[0].deployment?.status).toBe('loading');
  await pending;
  const result = WorkspaceSchema.parse(await (await app.request('/api/workspace')).json());
  expect(result.tabs[0].deployment?.targets).toHaveLength(4);
  expect(result.tabs[0].deployment?.status).toBe('ready');
  const html = String(checks(result.tabs[0]));
  expect(html.indexOf('west.example')).toBeLessThan(html.indexOf('east.example'));
  expect(html.indexOf('east.example')).toBeLessThan(html.indexOf('federal.example'));
  expect(html.match(/class="deployment-name">east.example/g)).toHaveLength(2);
  expect(html).toContain('aria-label="Reached"');
  const saved = WorkspaceSchema.parse(JSON.parse(readFileSync(join(dir, 'workspace.json'), 'utf8')));
  expect(saved.tabs[0].deployment).toEqual(result.tabs[0].deployment);
  expect(JSON.stringify(saved)).not.toContain('report.cjs');
});

it('passes PR data as literal environment values and retries suggested services once', async () => {
  const { loadDeploymentTargets } = deployments;
  const { runDeploymentSource } = await import('../../../src/workspace/deployment-source.js');
  const command = `"${process.execPath}" report.cjs`;
  writeFileSync(join(dir, 'report.cjs'), `console.log(process.env.REV_PR_URL);`);
  const hostile = { ...ref, repo: 'example; echo unsafe $(whoami)' };
  expect((await runDeploymentSource(CompanyDeploymentsSchema.parse({ command }), hostile, [], new AbortController().signal)).trim())
    .toBe(`https://github.com/example-org/${hostile.repo}/pull/1`);
  writeFileSync(join(dir, 'report.cjs'), `const fs = require('node:fs'); fs.appendFileSync('calls', process.env.REV_SERVICES + '\\n---\\n'); console.log(process.env.REV_SERVICES === 'api\\nworker' ? ${JSON.stringify(report)} : 'Here is the list of all impacted services detected:\\n- worker\\n- api');`);
  const result = await loadDeploymentTargets(CompanyDeploymentsSchema.parse({ command }), ref, new AbortController().signal);
  expect(result).toHaveLength(4);
  expect(readFileSync(join(dir, 'calls'), 'utf8')).toBe('\n---\napi\nworker\n---\n');
});

it('fetches endpoint reports with encoded parameters, local authorization and service discovery', async () => {
  const calls: { url: URL; authorization?: string }[] = [];
  const base = await endpoint((req, res) => {
    const url = new URL(req.url!, 'http://localhost');
    calls.push({ url, authorization: req.headers.authorization });
    res.end(url.searchParams.get('services') === '[]' ? 'Changed services found: `api` `worker`' : report);
  });
  const settings = CompanyDeploymentsSchema.parse({ enabled: true, organizations: ['example-org'], source: 'endpoint',
    endpoint: `${base}/status?pr={pr_url}&services={services}`, authorization: 'Bearer local-test-value' });
  const result = await deployments.loadDeploymentTargets(settings, ref, new AbortController().signal);
  expect(result).toHaveLength(4);
  expect(calls).toHaveLength(2);
  expect(calls[0].url.searchParams.get('pr')).toBe(ref.url);
  expect(calls[1].url.searchParams.get('services')).toBe('["api","worker"]');
  expect(calls[0].authorization).toBe('Bearer local-test-value');
});

it('rejects redirects and oversized or failed endpoint responses without leaking details', async () => {
  const { runDeploymentSource } = await import('../../../src/workspace/deployment-source.js');
  let count = 0;
  const base = await endpoint((_req, res) => {
    count++;
    if (count === 1) { res.writeHead(302, { location: '/secret-url' }); res.end(); }
    else if (count === 2) { res.writeHead(500); res.end('secret-provider-output'); }
    else res.end('x'.repeat(1024 * 1024 + 1));
  });
  const settings = CompanyDeploymentsSchema.parse({ source: 'endpoint', endpoint: base });
  await expect(deployments.loadDeploymentTargets(settings, ref, new AbortController().signal)).rejects.not.toThrow('secret');
  expect(count).toBe(1);
  await expect(deployments.loadDeploymentTargets(settings, ref, new AbortController().signal)).rejects.not.toThrow('secret');
  await expect(runDeploymentSource(settings, ref, [], new AbortController().signal)).rejects.toThrow('too large');
});

it('cancels a real command and prevents its delayed work from running', async () => {
  const { runDeploymentSource } = await import('../../../src/workspace/deployment-source.js');
  writeFileSync(join(dir, 'slow.cjs'), `require('node:fs').writeFileSync('started', String(process.pid)); setTimeout(() => require('node:fs').writeFileSync('late', 'bad'), 10000);`);
  const controller = new AbortController();
  const pending = runDeploymentSource(CompanyDeploymentsSchema.parse({ command: `"${process.execPath}" slow.cjs` }), ref, [], controller.signal);
  const failed = expect(pending).rejects.toThrow('did not complete');
  await vi.waitFor(() => expect(readFileSync(join(dir, 'started'), 'utf8')).toMatch(/^\d+$/));
  controller.abort(); await failed;
  const pid = Number(readFileSync(join(dir, 'started'), 'utf8'));
  await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
});
