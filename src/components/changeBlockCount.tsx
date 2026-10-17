import { changeBlocks } from '../git/changeBlocks.js';
import { parseDiffData } from '../git/parseDiffData.js';
import { IconDiff } from '../icons.js';

export function ChangeBlockCount({ diffData }: { diffData: string | null | undefined }) {
  const count = changeBlocks(parseDiffData(diffData)).length;
  if (count === 0) return null;
  const label = `${String(count)} change block${count === 1 ? '' : 's'}`;
  return <span className="change-block-count" title={label} aria-label={label}>
    <span aria-hidden="true"><IconDiff /></span>{count}
  </span>;
}
