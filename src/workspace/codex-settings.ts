import { z } from 'zod';

import { readGlobalConfig } from '../global-config.js';

export function codexEnabled(): boolean {
  const saved = z.object({ enabled: z.boolean() }).safeParse(readGlobalConfig().codexConnection);
  return saved.success ? saved.data.enabled : process.env.REV_CODEX_SHARED_SERVER === '1';
}
