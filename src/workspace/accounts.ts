import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { z } from 'zod';

import { type GitHubAccounts, GitHubAccountsSchema } from '../api/github-accounts.js';
import type { PullRef } from '../api/workspace.js';
import { readGlobalConfig, updateGlobalConfig } from '../global-config.js';

const exec = promisify(execFile);
const LocalConfigSchema = z.object({
  accounts: z.record(z.string(), z.string()).default({}),
  slack: z.record(z.string(), z.string()).default({}),
  repositories: z.record(z.string(), z.string()).default({}),
});
export function localWorkspaceConfig() {
  try {
    return LocalConfigSchema.parse(
      JSON.parse(readFileSync(join(homedir(), '.glassbox', 'workspace-config.json'), 'utf8')),
    );
  } catch {
    return LocalConfigSchema.parse({});
  }
}

export function accountSettings(): GitHubAccounts {
  const saved = readGlobalConfig().githubAccounts;
  if (saved !== undefined) return GitHubAccountsSchema.parse(saved);
  return GitHubAccountsSchema.parse({ organizations: Object.fromEntries(
    Object.entries(localWorkspaceConfig().accounts).filter(([key]) => !key.includes('/')),
  ) });
}
export function githubAccount(ref: Pick<PullRef, 'owner' | 'repo'>): string {
  const saved = readGlobalConfig().githubAccounts;
  const settings = accountSettings();
  const owner = ref.owner.toLowerCase();
  const legacy = saved === undefined ? localWorkspaceConfig().accounts : {};
  const repo = Object.entries(legacy).find(([key]) => key.toLowerCase() === `${owner}/${ref.repo.toLowerCase()}`)?.[1];
  return (repo ?? '') || (Object.entries(settings.organizations).find(([key]) => key.toLowerCase() === owner)?.[1] ?? '') || settings.defaultUser;
}
export async function availableAccounts(): Promise<{ users: string[]; active: string }> {
  try {
    const { stdout } = await exec('gh', ['auth', 'status', '--hostname', 'github.com', '--json', 'hosts'], { timeout: 15000 });
    const parsed = z.object({ hosts: z.record(z.string(), z.array(z.object({ login: z.string(), active: z.boolean() }))) }).parse(JSON.parse(stdout));
    const accounts = parsed.hosts['github.com'] ?? [];
    return { users: [...new Set(accounts.map(account => account.login))], active: accounts.find(account => account.active)?.login ?? '' };
  } catch {
    throw new Error('Could not read signed-in GitHub accounts. Run gh auth login, then try again.');
  }
}
export async function getAccountSettings() {
  const { users, active } = await availableAccounts();
  const settings = accountSettings();
  return { settings: { ...settings, defaultUser: settings.defaultUser || active }, users };
}
export async function saveAccountSettings(input: GitHubAccounts) {
  const settings = GitHubAccountsSchema.parse(input);
  const { users } = await availableAccounts();
  const canonical = (name: string): string => {
    const user = users.find(user => user.toLowerCase() === name.toLowerCase());
    if (user === undefined) throw new Error(`Sign in to GitHub as ${name || 'your default account'} with gh auth login first.`);
    return user;
  };
  const normalized = {
    defaultUser: canonical(settings.defaultUser),
    organizations: Object.fromEntries(Object.entries(settings.organizations).map(([org, user]) => [org.toLowerCase(), canonical(user)])),
  };
  updateGlobalConfig(config => { config.githubAccounts = normalized; });
  return { settings: normalized, users };
}
