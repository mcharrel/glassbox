import { expect, it } from 'vitest';
import { PullTabSchema, type DeploymentTarget } from '../../../src/api/workspace.js';
import { checks, deploymentServices } from '../../../src/client/workspace/checks.js';
import { pullInfo } from '../workspace/fixtures.js';
const target = (datacenter: string, status: DeploymentTarget['status'], service = 'api'): DeploymentTarget =>
  ({ datacenter, status, service, environment: 'prod', namespace: 'app' });
const tab = () => PullTabSchema.parse({ key: 'example/project#1', ref: { owner: 'example', repo: 'project', number: 1, url: '' },
  info: { ...pullInfo(), state: 'MERGED', statusCheckRollup: [{ name: 'Build', conclusion: 'FAILURE' }] }, reviewId: null, repoRoot: null });
it('keeps services separate and aggregates namespaces only within each service', () => {
  const rows = [target('a.example', 'reached'), target('z.example', 'reached'),
    { ...target('a.example', 'missing'), namespace: 'secondary' }, target('a.example', 'reached', 'worker')];
  for (const input of [rows, [...rows].reverse()]) {
    expect(deploymentServices(input).map(group => [group.service, group.datacenters.map(dc => [dc.datacenter, dc.status])])).toEqual([
      ['api', [['z.example', 'reached'], ['a.example', 'partial']]],
      ['worker', [['a.example', 'reached']]],
    ]);
  }
  expect(deploymentServices([])).toEqual([]);
  expect(deploymentServices([target('east', 'unknown'), target('east', 'deploying')])[0].datacenters[0].status).toBe('unknown');
});
it('sorts staging, prod, federal and unclassified datacenters before considering reached status', () => {
  const rows = [
    { ...target('federal.example', 'reached'), environment: 'gov' },
    { ...target('unknown.example', 'reached'), environment: 'other' },
    target('a.prod.example', 'missing'), target('z.prod.example', 'reached'),
    { ...target('z.stage.example', 'missing'), environment: 'staging' },
    { ...target('a.stage.example', 'reached'), environment: 'staging' },
    { ...target('x.staging-fed.example', 'reached'), environment: 'staging' },
    { ...target('y.prod.example', 'reached'), environment: 'other' },
  ];
  const expected = ['a.stage.example', 'z.stage.example', 'y.prod.example', 'z.prod.example', 'a.prod.example',
    'federal.example', 'x.staging-fed.example', 'unknown.example'];
  for (const input of [rows, [...rows].reverse()])
    expect(deploymentServices(input)[0].datacenters.map(dc => dc.datacenter)).toEqual(expected);
  expect(rows[0].datacenter).toBe('federal.example');
});
it('renders an escaped service heading per group, including the same datacenter in multiple services', () => {
  const t = tab();
  t.deployment = { status: 'ready', updatedAt: 1, attemptedAt: 1,
    targets: [target('east.example', 'missing', 'worker'), target('east.example', 'reached', '<api>')] };
  const html = String(checks(t));
  expect(html).toContain('class="deployment-service-name">&lt;api&gt;</h3>');
  expect(html).toContain('class="deployment-service-name">worker</h3>');
  expect(html.match(/class="deployment-name">east.example/g)).toHaveLength(2);
  expect(html).toContain('deployment-reached'); expect(html).toContain('deployment-missing');
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
