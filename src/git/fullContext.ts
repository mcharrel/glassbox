import type { DiffLine, FileDiff } from './types.js';

/** Fill unchanged gaps without altering the saved changes or their line numbers. */
export function withFullContext(diff: FileDiff, content: string): FileDiff | null {
  if (diff.isBinary || diff.status === 'added' || diff.status === 'deleted') return diff;
  const source = content === '' ? [] : content.split('\n');
  if (content.endsWith('\n')) source.pop();
  const lines: DiffLine[] = [];
  let oldNum = 1, newNum = 1;
  const fillUntil = (end: number) => {
    while (newNum < end) {
      lines.push({ type: 'context', oldNum: oldNum++, newNum, content: source[newNum - 1] });
      newNum++;
    }
  };

  for (const hunk of diff.hunks) {
    const start = hunk.newStart + (hunk.newCount === 0 ? 1 : 0);
    if (start < newNum || start > source.length + 1) return null;
    fillUntil(start);
    for (const line of hunk.lines) {
      if (line.oldNum !== null && line.oldNum !== oldNum) return null;
      if (line.newNum !== null && (line.newNum !== newNum || newNum > source.length)) return null;
      lines.push(line);
      if (line.oldNum !== null) oldNum++;
      if (line.newNum !== null) newNum++;
    }
  }
  fillUntil(source.length + 1);
  return {
    ...diff,
    hunks: lines.length === 0 ? [] : [{
      oldStart: oldNum === 1 ? 0 : 1, oldCount: oldNum - 1,
      newStart: newNum === 1 ? 0 : 1, newCount: newNum - 1,
      lines,
    }],
  };
}
