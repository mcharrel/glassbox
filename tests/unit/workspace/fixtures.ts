import { PullInfoSchema } from '../../../src/api/workspace.js';

export const pullInfo = (author = 'alice') => PullInfoSchema.parse({
  id: 'pr', number: 1, url: 'https://github.com/example/project/pull/1',
  title: 'Example change', body: '', author: { login: author }, state: 'OPEN', isDraft: true,
  baseRefName: 'main', headRefName: 'topic', baseRefOid: 'base', headRefOid: 'head',
  mergeable: 'UNKNOWN', mergedAt: null,
});
