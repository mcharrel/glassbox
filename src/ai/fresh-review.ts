import { createAnalysis, getLatestAnalysis, updateAnalysisStatus } from '../db/ai-queries.js';
import { getDb } from '../db/connection.js';
import { getReviewFiles } from '../db/queries.js';
import { executeAnalysis, markAnalysisCanceled } from './analysis-pipeline.js';
import { loadAIConfig, loadGuidedReviewConfig } from './config.js';
import { KEYLESS_PLATFORMS } from './models.js';

export const FRESH_REVIEW_INTERVAL = 300000;
const starting = new Set<string>();
export async function freshReview(reviewId: string, repoRoot: string) {
  if (starting.has(reviewId)) throw new Error('A fresh review is already starting');
  starting.add(reviewId);
  try {
    const modes = ['risk', 'narrative', 'guided'] as const;
    const previous = await Promise.all(modes.map(mode => getLatestAnalysis(reviewId, mode)));
    const latest = Math.max(0, ...previous.map(run => run ? Date.parse(run.created_at) : 0));
    const remaining = FRESH_REVIEW_INTERVAL - (Date.now() - latest);
    if (remaining > 0) throw new Error(`A fresh AI review is limited to once every five minutes. Try again in ${Math.ceil(remaining / 1000)} seconds.`);
    const config = loadAIConfig();
    if (config.apiKey === null && !KEYLESS_PLATFORMS.has(config.platform)) throw new Error('Configure the guidance model first');
    const files = await getReviewFiles(reviewId);
    if (!files.length) throw new Error('Wait for the PR files to load');
    const guidedReview = loadGuidedReviewConfig();
    for (const run of previous) if (run?.status === 'running') {
      markAnalysisCanceled(run.id);
      await updateAnalysisStatus(run.id, 'failed', 'Canceled');
    }
    const db = await getDb();
    await db.query('DELETE FROM ai_file_scores WHERE analysis_id IN (SELECT id FROM ai_analyses WHERE review_id = $1)', [reviewId]);
    const types: Array<'narrative' | 'guided'> = guidedReview.enabled ? ['narrative', 'guided'] : ['narrative'];
    const runs = await Promise.all(types.map(type => createAnalysis(reviewId, type)));
    for (const [index, run] of runs.entries()) {
      void executeAnalysis({ analysisId: run.id, analysisType: types[index], reviewId, repoRoot, files,
        config, guidedReview, invalidateCache: true }).catch(() => {});
    }
    return { types };
  } finally { starting.delete(reviewId); }
}
