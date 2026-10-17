import { ChangeBlockCount } from '../../../src/components/changeBlockCount.js';
import { DiffView } from '../../../src/components/diffView.js';
import { FileList } from '../../../src/components/fileList.js';
import { changeBlocks } from '../../../src/git/changeBlocks.js';
import { parseDiff } from '../../../src/git/parseDiff.js';
import { emptyFileDiff } from '../../../src/git/parseDiffData.js';

const diff = parseDiff(`diff --git a/app.ts b/app.ts
--- a/app.ts
+++ b/app.ts
@@ -1,5 +1,5 @@
-old
+new
 context
-removed
 context
+added
 context
@@ -30 +30 @@
-old tail
+new tail
\\ No newline at end of file
`)[0];
const file = { id: 'f', review_id: 'r', file_path: 'app.ts', status: 'pending', diff_data: JSON.stringify(diff) };

describe('file change-block counts', () => {
  it('counts replacements once, separates on context and hunk boundaries, and ignores newline metadata', () => {
    expect(changeBlocks(diff).map(lines => lines.map(line => line.content))).toEqual([
      ['old', 'new'], ['removed'], ['added'], ['old tail', 'new tail'],
    ]);
    expect(diff.hunks).toHaveLength(2);
  });

  it.each(['split', 'unified'] as const)('matches navigation blocks and stays separate from comment totals in %s', mode => {
    const html = DiffView({ file, diff, mode, annotations: [], fullContext: true }).toString();
    const anchors = new Set([...html.matchAll(/data-change-block="(\d+)"/g)].map(match => match[1]));
    expect(anchors.size).toBe(4);
    const list = FileList({ files: [file], annotationCounts: { f: 3 }, staleCounts: {} }).toString();
    expect(list).toContain('class="change-block-count" title="4 change blocks" aria-label="4 change blocks"');
    expect(list).toContain('aria-label="4 change blocks">4</span>');
    expect(list).toContain('class="annotation-count">3</span>');
  });

  it.each(['add', 'remove'] as const)('counts an entire %s-only file as one block', type => {
    const wholeFile = { ...diff, status: type === 'add' ? 'added' as const : 'deleted' as const,
      hunks: [{ ...diff.hunks[0], lines: diff.hunks[0].lines.filter(line => line.type === type) }] };
    expect(changeBlocks(wholeFile)).toHaveLength(1);
    expect(ChangeBlockCount({ diffData: JSON.stringify(wholeFile) })?.toString()).toContain('title="1 change block"');
  });

  it.each([
    null, undefined, '', '{broken', '{"hunks":null}',
    JSON.stringify(emptyFileDiff()),
    JSON.stringify({ ...diff, isBinary: true }),
    JSON.stringify({ ...diff, status: 'unchanged', hunks: diff.hunks.map(hunk => ({ ...hunk, lines: hunk.lines.filter(line => line.type === 'context') })) }),
  ])('omits the badge when there are no known text changes (%s)', diffData => {
    expect(ChangeBlockCount({ diffData })).toBeNull();
  });
});
