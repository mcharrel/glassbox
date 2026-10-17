import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';

import type { PullRef } from '../api/workspace.js';
import { localWorkspaceConfig } from './github.js';

const exec = promisify(execFile);

/** Find an existing clone by its remotes, never by a directory name alone. */
export async function findLocalRepository(ref: PullRef): Promise<string | undefined> {
  const home = homedir();
  const configured = localWorkspaceConfig().repositories[`${ref.owner}/${ref.repo}`];
  const roots = [
    ...[...(process.env.GOPATH?.split(delimiter) ?? []), join(home, 'go')].map(root => join(root, 'src', 'github.com')),
    ...['src', 'code', 'projects', 'github', 'Developer'].map(name => join(home, name)),
  ];
  const candidates = new Set(configured ? [configured] : []);
  for (const root of roots) {
    candidates.add(join(root, ref.owner, ref.repo));
    candidates.add(join(root, ref.repo));
    // Owner folders may retain an old company name after a GitHub organization rename.
    for (const folder of await readdir(root, { withFileTypes: true }).catch(() => []))
      if (folder.isDirectory()) candidates.add(join(root, folder.name, ref.repo));
  }
  for (const root of candidates) {
    if (!existsSync(join(root, '.git'))) continue;
    try {
      const { stdout } = await exec('git', ['remote', '-v'], { cwd: root, timeout: 3000 });
      if (stdout.split('\n').some(line => {
        const remote = line.split(/\s+/)[1] ?? '';
        const match = /^(?:https?:\/\/|ssh:\/\/(?:[^@]+@)?|[^@]+@)(?:[\w-]+\.)?github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(remote);
        return match?.[1].toLowerCase() === ref.owner.toLowerCase() && match[2].toLowerCase() === ref.repo.toLowerCase();
      })) return root;
    } catch { /* An unavailable candidate should not prevent trying another clone. */ }
  }
  return undefined;
}
