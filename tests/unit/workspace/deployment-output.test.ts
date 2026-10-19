import { describe, expect, it } from 'vitest';
import { parseDeploymentOutput } from '../../../src/workspace/deployment-output.js';

export const table = (service: string, rows: string[]) => `**${service}**\n\`\`\`\n+---+\n| DATACENTER | ENV | NAMESPACE | DEPLOYED |\n+---+\n${rows.join('\n')}\n+---+\n\`\`\``;
const row = (status: string) => `| east.example | prod | app | ${status} |`;
describe('Deployment output', () => {
  it('reads multiple services, colours, carriage returns, and all known statuses', () => {
    const result = parseDeploymentOutput('\x1b[32mConnecting…\x1b[0m\r\n' + table('api', [row('✅ (deployed)'), '| west.example | prod | app | 🐢 (ongoing) |'])
      + '\n' + table('worker', [row('❌ (missing)'), '| north.example | stage | app | ❓ (unknown commit) |']));
    expect(result.targets.map(t => [t.service, t.datacenter, t.status])).toEqual([
      ['api', 'east.example', 'reached'], ['api', 'west.example', 'deploying'],
      ['worker', 'east.example', 'missing'], ['worker', 'north.example', 'unknown'],
    ]);
  });
  it('accepts the plain terminal service heading', () => {
    expect(parseDeploymentOutput(table('api', [row('✅ (deployed)')]).replace('**api**', 'api\n---')).targets[0].status).toBe('reached');
  });
  it('ignores Markdown table separator rows', () => {
    expect(parseDeploymentOutput('**api**\n| Datacenter | Env | Namespace | Deployed |\n| :--- | --- | ---: | --- |\n' + row('(deployed)')).targets).toHaveLength(1);
  });
  it('keeps unknown future statuses unknown and does not count duplicate targets', () => {
    const rows = [row('✅ (deployed)'), row('✅ (deployed)'), row('new status')];
    expect(parseDeploymentOutput(table('api', rows)).targets).toEqual([
      { datacenter: 'east.example', environment: 'prod', namespace: 'app', service: 'api', status: 'unknown' },
    ]);
  });
  it.each([
    'Here is the list of all impacted services detected:\n- api\n- worker',
    'Changed services found: `worker` `api`',
  ])('finds suggested services without guessing from arbitrary output', output => {
    expect(parseDeploymentOutput(output).services).toEqual(['api', 'worker']);
  });
  it('distinguishes a valid empty result from an error or an incomplete result', () => {
    expect(parseDeploymentOutput('**api**\nNot found').targets).toEqual([]);
    for (const output of ['', 'Connecting…', table('api', []), 'Error running lookup\nsecret', table('api', [row('✅ (deployed)')]) + '\n**worker**\nNot found'])
      expect(() => parseDeploymentOutput(output)).toThrow();
    expect(() => parseDeploymentOutput(table('api', ['| east | prod |']))).toThrow('unrecognized');
  });
});
