import { expect, it } from 'vitest';
import { PullTabSchema, type DeploymentTarget } from '../../../src/api/workspace.js';
import { checks, datacenterStatus } from '../../../src/client/workspace/checks.js';
import { pullInfo } from '../workspace/fixtures.js';
const target = (datacenter: string, status: DeploymentTarget['status'], service = 'api'): DeploymentTarget =>
  ({ datacenter, status, service, environment: 'prod', namespace: 'app' });
const tab = () => PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: '' },
  info: { ...pullInfo(), state: 'MERGED', statusCheckRollup: [{ name: 'Build', conclusion: 'FAILURE' }] }, reviewId: null, repoRoot: null });
it('aggregates conservatively with fully reached datacenters first, regardless of input order', () => {
  const rows = [target('a.example', 'reached'), target('z.example', 'reached'), target('a.example', 'missing', 'worker')];
  for (const input of [rows, [...rows].reverse()]) {
    expect(datacenterStatus(input).map(g => [g.datacenter, g.status])).toEqual([['z.example', 'reached'], ['a.example', 'partial']]);
  }
  expect(datacenterStatus([])).toEqual([]);
  expect(datacenterStatus([target('east', 'unknown'), target('east', 'deploying', 'worker')])[0].status).toBe('unknown');
});
it('replaces checks with deployments only after merge and keeps names escaped', () => {
  const t = tab();
  t.deployment = { status: 'ready', updatedAt: 1, attemptedAt: 1, targets: [target('<east>', 'missing'), target('west', 'reached')] };
  const html = String(checks(t));
  expect(html).not.toContain('Build');
  expect(html).toContain('aria-label="Reached"');
  expect(html).toContain('&lt;east&gt;');
  expect(html.indexOf('west')).toBeLessThan(html.indexOf('&lt;east&gt;'));
  t.info!.state = 'OPEN';
  expect(String(checks(t))).toContain('Build');
  expect(String(checks(t))).not.toContain('west');
});
it('distinguishes pending, empty, unavailable and stale results', () => {
  const t = tab();
  expect(String(checks(t))).toContain('Loading deployments');
  t.deployment = { status: 'ready', updatedAt: 1, attemptedAt: 1, targets: [] };
  expect(String(checks(t))).toContain('No datacenters reported');
  t.deployment = { ...t.deployment, status: 'error', message: 'Offline', targets: [target('east', 'reached')] };
  expect(String(checks(t))).toContain('Showing last known status. Offline');
  expect(String(checks(t))).toContain('east');
  t.deployment = { ...t.deployment, status: 'unavailable', updatedAt: 0, targets: [], message: 'Unavailable' };
  expect(String(checks(t))).toContain('Unavailable');
  expect(String(checks(t))).not.toContain('No datacenters');
});
