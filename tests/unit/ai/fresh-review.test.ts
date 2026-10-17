import { beforeEach, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ latest: vi.fn(), create: vi.fn(), status: vi.fn(), cancel: vi.fn(), run: vi.fn(), query: vi.fn(), files: vi.fn() }));
vi.mock('../../../src/db/ai-queries.js', () => ({ getLatestAnalysis: m.latest, createAnalysis: m.create, updateAnalysisStatus: m.status }));
vi.mock('../../../src/db/connection.js', () => ({ getDb: async () => ({ query: m.query }) }));
vi.mock('../../../src/db/queries.js', () => ({ getReviewFiles: m.files }));
vi.mock('../../../src/ai/config.js', () => ({ loadAIConfig: () => ({ platform: 'openai', model: 'gpt-5.5-pro', apiKey: 'test' }), loadGuidedReviewConfig: () => ({ enabled: true, topics: [] }) }));
vi.mock('../../../src/ai/analysis-pipeline.js', () => ({ executeAnalysis: m.run, markAnalysisCanceled: m.cancel }));
import { freshReview } from '../../../src/ai/fresh-review.js';
beforeEach(() => {
  vi.clearAllMocks(); m.latest.mockResolvedValue(undefined); m.files.mockResolvedValue([{ id: 'file' }]); m.run.mockResolvedValue(undefined);
  m.create.mockImplementation(async (_id, type) => ({ id: type }));
});
it('cancels old runs, discards old scores and starts GUIDE and LEARN together without cache reuse', async () => {
  m.latest.mockImplementation(async (_id, type) => ({ id: type+'-old', status: 'running', created_at: new Date(Date.now()-400000).toISOString() }));
  expect(await freshReview('r', '/repo')).toEqual({ types: ['narrative', 'guided'] });
  expect(m.cancel).toHaveBeenCalledTimes(3); expect(m.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM ai_file_scores'), ['r']);
  expect(m.run).toHaveBeenCalledTimes(2);
  expect(m.run).toHaveBeenCalledWith(expect.objectContaining({ analysisType: 'narrative', invalidateCache: true }));
  expect(m.run).toHaveBeenCalledWith(expect.objectContaining({ analysisType: 'guided', invalidateCache: true }));
});
it('enforces five minutes before clearing or dispatching anything, including after a restart', async () => {
  m.latest.mockResolvedValue({ created_at: new Date(Date.now()-60000).toISOString() });
  await expect(freshReview('r', '/repo')).rejects.toThrow('five minutes');
  expect(m.query).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled(); expect(m.run).not.toHaveBeenCalled();
});
it('rejects concurrent starts and empty reviews without discarding existing results', async () => {
  let resolve!: (value: unknown) => void;
  m.latest.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const first = freshReview('r', '/repo');
  await expect(freshReview('r', '/repo')).rejects.toThrow('already starting');
  resolve(undefined); await first;
  vi.clearAllMocks(); m.files.mockResolvedValue([]);
  await expect(freshReview('empty', '/repo')).rejects.toThrow('files to load');
  expect(m.query).not.toHaveBeenCalled();
});
