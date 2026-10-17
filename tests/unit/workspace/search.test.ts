import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixtures = vi.hoisted(() => ({
  files: [] as any[],
  annotations: [] as any[],
  comments: [] as any[],
  content: {} as Record<string, string>,
}));
vi.mock('../../../src/db/queries.js', () => ({
  getReview: vi.fn(async () => ({ mode: 'range:base..head', repo_path: '/review' })),
  getReviewFiles: async () => fixtures.files,
  getAnnotationsForReview: async () => fixtures.annotations,
}));
vi.mock('../../../src/git/diff.js', () => ({
  parseModeString: vi.fn(() => ({})),
  getModeFileContent: (_mode: unknown, path: string) => fixtures.content[path] ?? '',
}));
vi.mock('../../../src/workspace/service.js', () => ({
  tabForReview: () => ({ comments: fixtures.comments }),
}));
import { occurrences, searchAllFiles } from '../../../src/workspace/search.js';
import { noteMarkdownText } from '../../../src/utils/noteMarkdown.js';
import { reviewerStates, PullInfoSchema } from '../../../src/api/workspace.js';
beforeEach(() => {
  fixtures.files = [];
  fixtures.annotations = [];
  fixtures.comments = [];
  fixtures.content = {};
});
it('searches every file including full context and comments, without duplicating synced local annotations', async () => {
  fixtures.files = [
    { id: 'a', file_path: 'a.ts', diff_data: '{}' },
    { id: 'b', file_path: 'b.ts', diff_data: '{}' },
  ];
  fixtures.content = { 'a.ts': 'Target\nunchanged', 'b.ts': 'target target' };
  fixtures.annotations = [
    { id: 'local', review_file_id: 'a', content: 'target note', line_number: 2, side: 'new' },
  ];
  fixtures.comments = [
    { id: 'synced', annotationId: 'local', kind: 'review', body: 'target note' },
    {
      id: 'remote',
      kind: 'review',
      path: 'b.ts',
      line: 1,
      body: '**target** [target](https://target.invalid)',
    },
    { id: 'issue', kind: 'issue', body: 'target discussion' },
    { id: 'deleted', deleted: true, body: 'target' },
  ];
  const hits = await searchAllFiles('review', 'target');
  expect(hits.filter((h) => h.fileId === 'a')).toHaveLength(2);
  expect(hits.filter((h) => h.fileId === 'b')).toHaveLength(4);
  expect(hits.filter((h) => h.fileId === null).map((h) => h.commentId)).toEqual(['issue']);
  expect(hits.filter((h) => h.commentId === 'remote').map((h) => h.occurrence)).toEqual([0, 1]);
});
it('handles zero files, empty queries and non-overlapping repeated matches', async () => {
  expect(await searchAllFiles('review', 'target')).toEqual([]);
  expect(await searchAllFiles('review', '')).toEqual([]);
  expect(occurrences('aaa AAA', 'aa')).toEqual([0, 4]);
  expect(occurrences('aaa', '')).toEqual([]);
});
it('indexes the same markdown text the client renders, including literal angle brackets', () => {
  expect(noteMarkdownText('**bold** [label](https://example.test) & <literal>')).toBe(
    'bold label & <literal>',
  );
});
describe('review state', () => {
  it('uses the latest submitted decision and outstanding re-review requests', () => {
    const info = PullInfoSchema.parse({
      id: 'pr',
      number: 1,
      url: '',
      title: '',
      body: '',
      author: { login: 'owner' },
      state: 'OPEN',
      isDraft: false,
      baseRefName: 'main',
      headRefName: 'topic',
      baseRefOid: 'a',
      headRefOid: 'b',
      mergeable: 'UNKNOWN',
      mergedAt: null,
      reviews: [
        { author: { login: 'bob' }, state: 'APPROVED', submittedAt: '2026-02-01' },
        { author: { login: 'bob' }, state: 'CHANGES_REQUESTED', submittedAt: '2026-01-01' },
        { author: { login: 'bob' }, state: 'COMMENTED', submittedAt: '2026-03-01' },
      ],
    });
    expect(reviewerStates(info).get('bob')).toBe('APPROVED');
    info.reviewRequests = [{ login: 'bob' }];
    expect(reviewerStates(info).get('bob')).toBe('PENDING');
  });
});
