import type { DeploymentTarget } from '../api/workspace.js';

export function parseDeploymentOutput(output: string): { targets: DeploymentTarget[]; services: string[] } {
  // DDR renders Markdown as plain text; accept both representations, plus terminal colours.
  // eslint-disable-next-line no-control-regex -- strip terminal escape sequences from CLI output.
  const lines = output.replace(/\x1b\[[0-9;]*m/g, '').replaceAll('\r', '').split('\n').map(line => line.trim());
  const targets = new Map<string, DeploymentTarget>();
  const services = new Set<string>();
  let service = '';
  let table = false;
  let suggestions = false;
  let recognized = false;
  let notFound = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (/Error running whereismycode|Failed to|^Error:/i.test(line))
      throw new Error('Devflow could not determine deployment status. Try again with Cmd/Ctrl+R.');
    if (/^(?:Here is the list of all impacted services detected:|.*(?:Changed|Impacted) services found:)/i.test(line)) {
      suggestions = true;
      recognized = true;
      for (const match of line.matchAll(/`([\w.-]+)`/g)) services.add(match[1]);
      continue;
    }
    if (suggestions && /^- [\w.-]+$/.test(line)) { services.add(line.slice(2)); continue; }
    if (line && suggestions) suggestions = false;
    const heading = /^\*\*([\w.-]+)\*\*$/.exec(line)?.[1]
      ?? (/^[\w.-]+$/.test(line) && lines[index + 1] === '---' ? line : undefined);
    if (heading !== undefined) { service = heading; table = false; continue; }
    if (line === 'Not found' && service) { recognized = true; notFound = true; continue; }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.join(',').toLowerCase() === 'datacenter,env,namespace,deployed') {
      table = true;
      recognized = true;
      continue;
    }
    if (!table || !service || cells.length !== 4 || cells.slice(0, 3).some(cell => !cell))
      throw new Error('Devflow returned an unrecognized deployment table.');
    const status: DeploymentTarget['status'] = /\(deployed\)/i.test(cells[3]) ? 'reached'
      : /\(ongoing\)/i.test(cells[3]) ? 'deploying' : /\(missing\)/i.test(cells[3]) ? 'missing' : 'unknown';
    const target = { datacenter: cells[0], environment: cells[1], namespace: cells[2], service, status };
    const key = JSON.stringify(cells.slice(0, 3).concat(service));
    const prior = targets.get(key);
    targets.set(key, prior && prior.status !== status ? { ...target, status: 'unknown' } : target);
  }
  if (!recognized || (!targets.size && !services.size && !notFound)) throw new Error('Devflow returned no recognizable deployment status.');
  if (notFound && targets.size) throw new Error('Devflow did not report every service. Deployment status is incomplete.');
  return { targets: [...targets.values()], services: [...services].sort() };
}
