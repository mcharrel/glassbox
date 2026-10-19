import { spawn } from 'node:child_process';

import type { CompanyDeployments } from '../api/company-deployments.js';
import type { PullRef } from '../api/workspace.js';
import { GLOBAL_CONFIG_DIR } from '../global-config.js';

const OUTPUT_LIMIT = 1024 * 1024;

function runCommand(command: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    // Only the local settings supply shell code. PR data is passed separately in environment variables.
    const child = spawn(process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command],
      { cwd: GLOBAL_CONFIG_DIR, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'ignore'] });
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    function stop() {
      failed = true;
      // Kill the whole shell process group so canceling a lookup cannot leave its children running.
      try {
        if (process.platform !== 'win32' && child.pid !== undefined) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* process already exited */ }
    }
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > OUTPUT_LIMIT) stop();
      else chunks.push(chunk);
    });
    child.on('error', () => { signal.removeEventListener('abort', stop); reject(new Error('Could not start the deployment command.')); });
    child.on('close', code => {
      signal.removeEventListener('abort', stop);
      if (failed || code !== 0) reject(new Error('The deployment command did not complete.'));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

export async function runDeploymentSource(settings: CompanyDeployments, ref: PullRef, services: string[], signal: AbortSignal): Promise<string> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(90_000)]);
  const prUrl = `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`;
  if (settings.source === 'command') return runCommand(settings.command, { ...process.env,
    REV_PR_URL: prUrl, REV_PR_OWNER: ref.owner, REV_PR_REPO: ref.repo, REV_PR_NUMBER: String(ref.number),
    REV_SERVICES: services.join('\n'),
  }, bounded);

  const values: Record<string, string> = { pr_url: prUrl, owner: ref.owner, repo: ref.repo, number: String(ref.number), services: JSON.stringify(services) };
  const url = settings.endpoint.replace(/\{(pr_url|owner|repo|number|services)\}/g, (_match, key: string) => encodeURIComponent(values[key]));
  const response = await fetch(url, { signal: bounded, redirect: 'error',
    headers: settings.authorization ? { Authorization: settings.authorization } : {},
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error('The deployment endpoint did not return a report.');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > OUTPUT_LIMIT) throw new Error('The deployment report is too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks).toString('utf8');
}
