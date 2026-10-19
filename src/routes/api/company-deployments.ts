import { Hono } from 'hono';

import { CompanyDeploymentsSchema } from '../../api/company-deployments.js';
import type { AppEnv } from '../../types.js';
import { parseBody } from '../../utils/parseBody.js';
import { deploymentSettings, saveDeploymentSettings } from '../../workspace/deployment-settings.js';
import { resetDeployments } from '../../workspace/deployments.js';

export const companyDeploymentsRoutes = new Hono<AppEnv>();
companyDeploymentsRoutes.get('/company/deployments', c => {
  c.header('Cache-Control', 'no-store');
  return c.json(deploymentSettings());
});
companyDeploymentsRoutes.put('/company/deployments', async c => {
  if (c.req.header('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return c.json({ error: 'Use application/json.' }, 415);
  const parsed = await parseBody(c, CompanyDeploymentsSchema);
  if (!parsed.ok) return parsed.response;
  const settings = saveDeploymentSettings(parsed.data);
  resetDeployments();
  c.header('Cache-Control', 'no-store');
  return c.json(settings);
});
