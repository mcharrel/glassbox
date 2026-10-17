import type { DiffLine, FileDiff } from './types.js';

/** Context rows and hunk boundaries separate changes; replacements stay together. */
export function changeBlocks(diff: FileDiff | null): DiffLine[][] {
  const blocks: DiffLine[][] = [];
  if (!diff || diff.isBinary) return blocks;
  for (const hunk of diff.hunks) {
    let block: DiffLine[] | null = null;
    for (const line of hunk.lines) {
      if (line.type === 'context') {
        block = null;
      } else {
        if (!block) { block = []; blocks.push(block); }
        block.push(line);
      }
    }
  }
  return blocks;
}
