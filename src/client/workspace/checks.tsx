import type { DeploymentTarget, PullTab } from '../../api/workspace.js';

export function checks(tab: PullTab) {
  if (tab.info?.state === 'MERGED') return deployments(tab);
  const rank = (check: NonNullable<NonNullable<PullTab['info']>['statusCheckRollup']>[number]) => {
    const state = check.conclusion ?? check.state ?? check.status;
    return ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED'].includes(state ?? '')
      ? 0
      : ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(state ?? '')
        ? 2
        : 1;
  };
  return (
    <>
      {[...(tab.info?.statusCheckRollup ?? [])]
        .sort((a, b) => rank(a) - rank(b))
        .map((check) => (
          <div className={`pr-check check-${rank(check)}`} data-key={check.name ?? check.context}>
            <span>{['×', '●', '✓'][rank(check)]}</span>
            <a href={check.detailsUrl ?? check.targetUrl} target="_blank" rel="noreferrer">
              {check.name ?? check.context}
            </a>
          </div>
        ))}
    </>
  );
}

function datacenterTier(datacenter: string, rows: DeploymentTarget[]): number {
  const parts = [datacenter, ...rows.map(row => row.environment)].join('.').toLowerCase().split(/[._-]/);
  // Federal datacenters stay last among known tiers, including federal staging.
  if (parts.some(part => ['fed', 'federal', 'gov', 'govcloud'].includes(part))) return 2;
  if (parts.some(part => ['staging', 'stage'].includes(part))) return 0;
  if (parts.some(part => ['prod', 'production'].includes(part))) return 1;
  return 3;
}
function datacenterStatus(targets: DeploymentTarget[]) {
  const grouped = new Map<string, DeploymentTarget[]>();
  for (const target of targets) {
    const group = grouped.get(target.datacenter) ?? [];
    group.push(target);
    grouped.set(target.datacenter, group);
  }
  return [...grouped].map(([datacenter, rows]) => {
    const reached = rows.filter(row => row.status === 'reached').length;
    const status = reached === rows.length ? 'reached' : reached ? 'partial'
      : rows.some(row => row.status === 'unknown') ? 'unknown'
      : rows.some(row => row.status === 'deploying') ? 'deploying' : 'missing';
    return { datacenter, rows, reached, status };
  }).sort((a, b) => datacenterTier(a.datacenter, a.rows) - datacenterTier(b.datacenter, b.rows)
    || Number(b.status === 'reached') - Number(a.status === 'reached')
    || a.datacenter.localeCompare(b.datacenter));
}
export function deploymentServices(targets: DeploymentTarget[]) {
  const services = new Map<string, DeploymentTarget[]>();
  for (const target of targets) {
    const rows = services.get(target.service) ?? [];
    rows.push(target);
    services.set(target.service, rows);
  }
  return [...services].sort(([a], [b]) => a.localeCompare(b))
    .map(([service, rows]) => ({ service, datacenters: datacenterStatus(rows) }));
}
function deployments(tab: PullTab) {
  const snapshot = tab.deployment;
  const groups = deploymentServices(snapshot?.targets ?? []);
  const labels: Record<string, string> = { reached: 'Reached', partial: 'Partially reached',
    deploying: 'Deploying', missing: 'Not reached', unknown: 'Unknown' };
  const icons: Record<string, string> = { reached: '✓', partial: '◐', deploying: '●', missing: '×', unknown: '?' };
  return <>
    {groups.map(({ service, datacenters }) => <div className="deployment-service" data-key={service} role="group" aria-label={service}>
      <h3 className="deployment-service-name">{service}</h3>
      {datacenters.map(group => <div className={`pr-check deployment-${group.status}`} data-key={group.datacenter}
        title={group.rows.map(row => `${row.environment} · ${row.namespace}: ${labels[row.status]}`).join('\n')}>
        <span aria-label={labels[group.status]}>{icons[group.status]}</span>
        <span className="deployment-name">{group.datacenter}</span>
      </div>)}
    </div>)}
    {(!snapshot || snapshot.status === 'loading') && <p className="deployment-notice" role="status">
      <span className="analysis-spinner"></span> {groups.length ? 'Refreshing deployments…' : 'Loading deployments…'}
    </p>}
    {snapshot?.message !== undefined && <p className="deployment-notice" role="status">
      {snapshot.updatedAt > 0 ? 'Showing last known status. ' : ''}{snapshot.message}
    </p>}
    {snapshot?.status === 'ready' && !groups.length && <p className="deployment-notice">No datacenters reported by Devflow.</p>}
  </>;
}
