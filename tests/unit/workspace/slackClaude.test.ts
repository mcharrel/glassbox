import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(), status: vi.fn(), close: vi.fn(), mode: 'success', name: 'slack_add_reaction', input: { channel_id: 'C12345', timestamp: '1790000000.123456', reaction: 'approved' } as Record<string, unknown> }));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }));
vi.mock('node:fs', async original => ({ ...await original<any>(), accessSync: vi.fn() }));
import { checkClaudeSlack, claudeSlackCall, exactSlackCall } from '../../../src/workspace/slack-claude.js';
const prefix = 'mcp__plugin_slack_slack__';
beforeEach(() => {
  vi.clearAllMocks(); mocks.mode = 'success';
  mocks.status.mockResolvedValue([{ name: 'plugin:slack:slack', status: 'connected', tools: [{ name: 'slack_add_reaction' }, { name: 'slack_search_public_and_private' }] }]);
  mocks.query.mockImplementation(({ options, prompt }) => ({
    mcpServerStatus: mocks.status, close: mocks.close,
    async *[Symbol.asyncIterator]() {
      for await (const p of prompt) {
        expect(p.message.content).toContain(mocks.name);
        const hook = options.hooks.PreToolUse[0].hooks[0];
        const name = `${prefix}${mocks.name}`;
        expect(await hook({ hook_event_name: 'PreToolUse', tool_name: 'ToolSearch', tool_input: { query: `select:${name}`, max_results: 1 } })).toEqual({});
        expect((await hook({ hook_event_name: 'PreToolUse', tool_name: 'ToolSearch', tool_input: { query: 'send messages' } })).hookSpecificOutput.permissionDecision).toBe('deny');
        const pre = await hook({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: mocks.input });
        expect(pre).toEqual({});
        expect((await hook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'echo nope' } })).hookSpecificOutput.permissionDecision).toBe('deny');
        expect((await hook({ hook_event_name: 'PreToolUse', tool_name: name, tool_input: mocks.input })).hookSpecificOutput.permissionDecision).toBe('deny');
        if (mocks.mode === 'success') await options.hooks.PostToolUse[0].hooks[0]({ hook_event_name: 'PostToolUse', tool_name: name, tool_input: mocks.input, tool_response: { ok: true } });
        yield { type: 'result', result: 'I added the reaction' }; break;
      }
    },
  }));
});
it('checks the live tool inventory without sending a model prompt', async () => {
  expect(await checkClaudeSlack()).toBe(true); expect(mocks.close).toHaveBeenCalledOnce();
  mocks.status.mockResolvedValue([{ name: 'plugin:slack:slack', status: 'needs-auth' }]);
  expect(await checkClaudeSlack()).toBe(false); expect(mocks.close).toHaveBeenCalledTimes(2);
});
it('gates exact targets and denies extra arguments, unrelated tools and wrong emoji', () => {
  expect(exactSlackCall(`${prefix}${mocks.name}`, mocks.input, mocks.name, mocks.input)).toBe(true);
  expect(exactSlackCall(`${prefix}${mocks.name}`, { channel: mocks.input.channel_id, timestamp: mocks.input.timestamp, name: mocks.input.reaction }, mocks.name, mocks.input)).toBe(true);
  for (const input of [{ ...mocks.input, reaction: 'other' }, { ...mocks.input, text: 'send something' }, { ...mocks.input, channel_id: 'COTHER' }, null]) expect(exactSlackCall(`${prefix}${mocks.name}`, input, mocks.name, mocks.input)).toBe(false);
  expect(exactSlackCall('mcp__other__slack_add_reaction', mocks.input, mocks.name, mocks.input)).toBe(false);
});
it('uses actual tool receipts, no chat persistence or file/shell tools, and closes the process', async () => {
  await expect(claudeSlackCall(mocks.name, mocks.input, new AbortController().signal)).resolves.toEqual({ ok: true });
  const options = mocks.query.mock.calls[0][0].options;
  expect(options).toMatchObject({ tools: ['ToolSearch'], persistSession: false, permissionMode: 'dontAsk', settingSources: ['user'] });
  expect(options).not.toHaveProperty('resume'); expect(options).not.toHaveProperty('allowDangerouslySkipPermissions');
  expect(mocks.close).toHaveBeenCalledOnce();
  mocks.mode = 'prose';
  await expect(claudeSlackCall(mocks.name, mocks.input, new AbortController().signal)).rejects.toThrow('Check the Slack plugin');
  expect(mocks.close).toHaveBeenCalledTimes(2);
});
it('does not start a canceled request or leak subprocess error details', async () => {
  const c = new AbortController(); c.abort();
  await expect(claudeSlackCall(mocks.name, mocks.input, c.signal)).rejects.toThrow(); expect(mocks.query).not.toHaveBeenCalled();
  mocks.status.mockRejectedValue(new Error('private connection details'));
  await expect(claudeSlackCall(mocks.name, mocks.input, new AbortController().signal)).rejects.toThrow('Check the Slack plugin');
  expect(mocks.close).toHaveBeenCalledOnce();
});
