import { z } from 'zod';

import { apiCall } from './_runner.js';

function deploymentEndpointValid(value: string): boolean {
  try {
    const url = new URL(value);
    return !url.username && !url.password && !url.hash && !/[{}]/.test(url.host)
      && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
  } catch { return false; }
}

export const CompanyDeploymentsSchema = z.object({
  enabled: z.boolean().default(false),
  organizations: z.array(z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9-]*$/).max(100)).max(100).default([]),
  source: z.enum(['command', 'endpoint']).default('command'),
  command: z.string().max(16384).default(''),
  endpoint: z.string().trim().max(8192).default(''),
  authorization: z.string().max(8192).regex(/^[^\r\n]*$/).default(''),
}).superRefine((value, ctx) => {
  if (!value.enabled) return;
  if (!value.organizations.length) ctx.addIssue({ code: 'custom', path: ['organizations'], message: 'Choose at least one GitHub organization.' });
  if (value.source === 'command' && !value.command.trim())
    ctx.addIssue({ code: 'custom', path: ['command'], message: 'Enter a deployment command.' });
  if (value.source === 'endpoint' && !deploymentEndpointValid(value.endpoint))
    ctx.addIssue({ code: 'custom', path: ['endpoint'], message: 'Use an HTTPS endpoint (HTTP is allowed on localhost), without URL credentials or a fragment.' });
});
export type CompanyDeployments = z.infer<typeof CompanyDeploymentsSchema>;

export function getCompanyDeployments(): Promise<CompanyDeployments> {
  return apiCall(CompanyDeploymentsSchema, '/company/deployments');
}
export function saveCompanyDeployments(settings: CompanyDeployments): Promise<CompanyDeployments> {
  return apiCall(CompanyDeploymentsSchema, '/company/deployments', { method: 'PUT', body: settings });
}
