import { z } from 'zod';

import { apiCall } from './_runner.js';

const login = z.string().trim().regex(/^[\w-]+$/).max(100);
export const GitHubAccountsSchema = z.object({
  defaultUser: login.or(z.literal('')).default(''),
  organizations: z.record(z.string().trim().regex(/^[a-zA-Z0-9-]+$/).max(100), login).default({}),
}).superRefine((value, ctx) => {
  const names = Object.keys(value.organizations).map(name => name.toLowerCase());
  if (new Set(names).size !== names.length) ctx.addIssue({ code: 'custom', message: 'Use each organization only once.' });
});
export type GitHubAccounts = z.infer<typeof GitHubAccountsSchema>;
export const GitHubAccountSettingsSchema = z.object({
  settings: GitHubAccountsSchema,
  users: z.array(z.string()),
});
export type GitHubAccountSettings = z.infer<typeof GitHubAccountSettingsSchema>;
export const getGitHubAccounts = () => apiCall(GitHubAccountSettingsSchema, '/github/accounts');
export const saveGitHubAccounts = (settings: GitHubAccounts) =>
  apiCall(GitHubAccountSettingsSchema, '/github/accounts', { method: 'PUT', body: settings });
