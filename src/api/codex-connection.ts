import { z } from 'zod';

import { apiCall } from './_runner.js';

export const CodexSetupSchema = z.object({
  enabled: z.boolean(), supported: z.boolean(),
  state: z.enum(['disabled', 'connected', 'restart', 'unavailable', 'unsupported']),
  message: z.string(),
});
export type CodexSetup = z.infer<typeof CodexSetupSchema>;
export const CodexChatsSchema = z.object({ chats: z.array(z.object({ id: z.string(), title: z.string() })) });
export const getCodexSetup = () => apiCall(CodexSetupSchema, '/codex/connection');
export const setCodexSetup = (enabled: boolean) => apiCall(CodexSetupSchema, '/codex/connection', { method: 'PUT', body: { enabled } });
export const getCodexChats = () => apiCall(CodexChatsSchema, '/codex/chats');
export const linkCodexChat = (key: string, threadId: string) => apiCall(z.object({ ok: z.literal(true) }), '/codex/link', { method: 'POST', body: { key, threadId } });
