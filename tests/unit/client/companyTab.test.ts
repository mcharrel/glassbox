import { expect, it } from 'vitest';
import { CompanyDeploymentsSchema } from '../../../src/api/company-deployments.js';
import { companyTab, renderCompanyDeployments } from '../../../src/client/settings/companyTab.js';

it('offers a company deployments form with command and endpoint modes', () => {
  const defaults = CompanyDeploymentsSchema.parse({});
  expect(companyTab.label).toBe('My company');
  const command = String(renderCompanyDeployments({ ...defaults, command: '</textarea><script>unsafe</script>' }, 'example-org', false));
  expect(command).toContain('Deployments</h3>');
  expect(command).toContain('company-deployments-command');
  expect(command).toContain('$REV_PR_URL');
  expect(command).not.toContain('<script>');
  expect(command).not.toContain('company-deployments-endpoint');
  const endpoint = String(renderCompanyDeployments({ ...defaults, source: 'endpoint' }, 'example-org', true));
  expect(endpoint).toContain('company-deployments-endpoint');
  expect(endpoint).toContain('type="password"');
  expect(endpoint).toContain('disabled');
  expect(endpoint).toContain('Saving…');
});
