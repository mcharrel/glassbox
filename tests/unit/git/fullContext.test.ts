import { describe, expect, it } from 'vitest';
import { withFullContext } from '../../../src/git/fullContext.js';
import type { DiffLine, FileDiff } from '../../../src/git/types.js';

const file = (hunks: FileDiff['hunks'] = []): FileDiff => ({
  filePath: 'sample.ts', oldPath: null, status: 'modified', isBinary: false, hunks,
});
const line = (type: DiffLine['type'], oldNum: number | null, newNum: number | null, content: string): DiffLine =>
  ({ type, oldNum, newNum, content });

describe('withFullContext', () => {
  it('fills the prefix, between changes and suffix while preserving old/new anchors', () => {
    const diff = file([
      { oldStart: 3, oldCount: 2, newStart: 3, newCount: 3, lines: [
        line('context', 3, 3, 'three'), line('remove', 4, null, 'old'),
        line('add', null, 4, 'new'), line('add', null, 5, 'inserted'),
      ] },
      { oldStart: 8, oldCount: 2, newStart: 9, newCount: 1, lines: [
        line('remove', 8, null, 'deleted'), line('context', 9, 9, 'nine'),
      ] },
    ]);
    const original = structuredClone(diff);
    const content = 'one\ntwo\nthree\nnew\ninserted\nsix\nseven\neight\nnine\nten\n';
    const expanded = withFullContext(diff, content)!;
    const lines = expanded.hunks[0].lines;
    expect(lines.filter(l => l.newNum !== null).map(l => l.content).join('\n') + '\n').toBe(content);
    expect(lines.filter(l => l.oldNum !== null).map(l => l.oldNum)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(lines.filter(l => l.newNum !== null).map(l => l.newNum)).toEqual([1,2,3,4,5,6,7,8,9,10]);
    expect(lines.filter(l => l.type !== 'context')).toEqual(diff.hunks.flatMap(h => h.lines).filter(l => l.type !== 'context'));
    expect(expanded.hunks[0]).toMatchObject({ oldStart: 1, newStart: 1, oldCount: 10, newCount: 10 });
    expect(diff).toEqual(original);
  });

  it.each(['last', 'last\n'])('does not invent a final empty line for %j', content => {
    expect(withFullContext(file(), content)?.hunks[0].lines).toEqual([line('context', 1, 1, 'last')]);
  });

  it('shows an unchanged or renamed file and handles empty content', () => {
    expect(withFullContext({ ...file(), status: 'renamed', oldPath: 'old.ts' }, 'same\n')?.hunks[0].lines)
      .toEqual([line('context', 1, 1, 'same')]);
    expect(withFullContext(file(), '')?.hunks).toEqual([]);
  });

  it('handles a deletion-only hunk with zero new lines', () => {
    const diff = file([{ oldStart: 2, oldCount: 1, newStart: 1, newCount: 0, lines: [line('remove', 2, null, 'gone')] }]);
    expect(withFullContext(diff, 'kept\ntail')?.hunks[0].lines).toEqual([
      line('context', 1, 1, 'kept'), line('remove', 2, null, 'gone'), line('context', 3, 2, 'tail'),
    ]);
  });

  it('handles insertions into an empty existing file', () => {
    const diff = file([{ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1, lines: [line('add', null, 1, 'new')] }]);
    expect(withFullContext(diff, 'new')?.hunks[0]).toMatchObject({ oldStart: 0, oldCount: 0, newStart: 1, newCount: 1 });
  });

  it('rejects unavailable or inconsistent context instead of fabricating missing lines', () => {
    const diff = file([{ oldStart: 4, oldCount: 1, newStart: 4, newCount: 1, lines: [line('context', 4, 4, 'four')] }]);
    expect(withFullContext(diff, '')).toBeNull();
    expect(withFullContext(file([diff.hunks[0], diff.hunks[0]]), 'one\ntwo\nthree\nfour')).toBeNull();
  });

  it.each(['added', 'deleted'] as const)('keeps complete %s-file changes without reading missing counterparts', status => {
    const diff = { ...file(), status };
    expect(withFullContext(diff, '')).toBe(diff);
  });
});
