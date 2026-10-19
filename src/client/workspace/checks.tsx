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

export function datacenterStatus(targets: DeploymentTarget[]) {
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
  }).sort((a, b) => Number(b.status === 'reached') - Number(a.status === 'reached')
    || a.datacenter.localeCompare(b.datacenter));
}
function deployments(tab: PullTab) {
  const snapshot = tab.deployment;
  const groups = datacenterStatus(snapshot?.targets ?? []);
  const labels: Record<string, string> = { reached: 'Reached', partial: 'Partially reached',
    deploying: 'Deploying', missing: 'Not reached', unknown: 'Unknown' };
  const icons: Record<string, string> = { reached: '✓', partial: '◐', deploying: '●', missing: '×', unknown: '?' };
  return <>
    {groups.map(group => <div className={`pr-check deployment-${group.status}`} data-key={group.datacenter}
      title={group.rows.map(row => `${row.service} · ${row.environment} · ${row.namespace}: ${labels[row.status]}`).join('\n')}>
      <span aria-label={labels[group.status]}>{icons[group.status]}</span>
      <span className="deployment-name">{group.datacenter}</span>
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
