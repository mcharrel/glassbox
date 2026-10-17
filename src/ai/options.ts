import { z } from 'zod';

export const ReasoningEffortSchema = z.enum(['default', 'none', 'low', 'medium', 'high', 'xhigh']);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;
export const AgentAccessSchema = z.enum(['read-only', 'local', 'push']);
export type AgentAccess = z.infer<typeof AgentAccessSchema>;

/** GPT-5.5 Pro supports medium/high/xhigh; the standard model also supports none/low. */
export function reasoningOptions(platform: string, model: string): ReasoningEffort[] {
  if (platform !== 'openai') return ['default'];
  if (/^gpt-5\.5-pro(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return ['default', 'medium', 'high', 'xhigh'];
  if (/^gpt-5\.5(?:-\d{4}-\d{2}-\d{2})?$/.test(model)) return ['default', 'none', 'low', 'medium', 'high', 'xhigh'];
  return ['default'];
}
export function selectedReasoning(platform: string, model: string, effort: ReasoningEffort = 'default'): ReasoningEffort {
  return reasoningOptions(platform, model).includes(effort) ? effort : 'default';
}
