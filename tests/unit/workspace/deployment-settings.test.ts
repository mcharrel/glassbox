import { beforeEach, expect, it, vi } from 'vitest';
import { CompanyDeploymentsSchema } from '../../../src/api/company-deployments.js';
import { deploymentSettings, saveDeploymentSettings } from '../../../src/workspace/deployment-settings.js';
const local = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));
vi.mock('../../../src/global-config.js', () => ({
  readGlobalConfig: () => local.config,
  updateGlobalConfig: (fn: (config: Record<string, unknown>) => void) => fn(local.config),
}));
beforeEach(() => { local.config = {}; });
it('fails closed for absent or corrupt settings', () => {
  expect(deploymentSettings()).toMatchObject({ enabled: false, command: '', endpoint: '', organizations: [] });
  local.config.companyDeployments = { enabled: true, organizations: [], source: 'command', command: 'echo unsafe' };
  expect(deploymentSettings().enabled).toBe(false);
});
it('requires an explicit scope and source when enabled, and preserves unrelated preferences', () => {
  expect(() => CompanyDeploymentsSchema.parse({ enabled: true, command: 'status' })).toThrow();
  expect(() => CompanyDeploymentsSchema.parse({ enabled: true, organizations: ['example'] })).toThrow();
  local.config.ai = { model: 'existing' };
  saveDeploymentSettings(CompanyDeploymentsSchema.parse({ enabled: true, organizations: ['Example', 'example'], command: 'status' }));
  expect(deploymentSettings().organizations).toEqual(['example']);
  expect(local.config.ai).toEqual({ model: 'existing' });
});
it('limits endpoint schemes, credentials, dynamic hosts and header injection', () => {
  const value = { enabled: true, organizations: ['example'], source: 'endpoint' };
  for (const endpoint of ['file:///private', 'http://example.com', 'https://user:secret@example.com', 'https://{owner}.example.com', 'https://example.com/#fragment'])
    expect(CompanyDeploymentsSchema.safeParse({ ...value, endpoint }).success).toBe(false);
  for (const endpoint of ['https://example.com/{number}?pr={pr_url}', 'http://127.0.0.1:1234', 'http://[::1]:1234'])
    expect(CompanyDeploymentsSchema.safeParse({ ...value, endpoint }).success).toBe(true);
  expect(CompanyDeploymentsSchema.safeParse({ ...value, endpoint: 'https://example.com', authorization: 'token\r\nX-Injected: true' }).success).toBe(false);
});
