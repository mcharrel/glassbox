import { type CompanyDeployments,CompanyDeploymentsSchema } from '../api/company-deployments.js';
import { readGlobalConfig, updateGlobalConfig } from '../global-config.js';

export function deploymentSettings(): CompanyDeployments {
  const parsed = CompanyDeploymentsSchema.safeParse(readGlobalConfig().companyDeployments);
  return parsed.success ? parsed.data : CompanyDeploymentsSchema.parse({});
}

export function saveDeploymentSettings(value: CompanyDeployments): CompanyDeployments {
  const settings = CompanyDeploymentsSchema.parse(value);
  settings.organizations = [...new Set(settings.organizations.map(owner => owner.toLowerCase()))];
  // Company settings belong only in the user's private config, never project files or exports.
  updateGlobalConfig(config => { config.companyDeployments = settings; });
  return settings;
}
