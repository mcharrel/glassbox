import { z } from 'zod';

import { apiCall } from '../../api/_runner.js';
import { resumePolling, stopPolling } from '../analysisEngine.js';
import { loadGuidedResults } from '../guided.js';
import { loadAnalysisResults } from '../sidebar/sortMode.js';
import { defaultAnalysisModeState } from '../state.js';
import { aiStore, reviewStore } from '../stores/index.js';
import { showToast } from '../toast.js';

export async function startFreshReview(): Promise<void> {
  const reviewId = reviewStore.state.value.reviewId;
  try {
    const { types } = await apiCall(z.object({ types: z.array(z.enum(['narrative', 'guided'])) }),
      '/ai/fresh-review', { method: 'POST', reviewId });
    document.dispatchEvent(new CustomEvent('glassbox-analysis-reset', { detail: { reviewId, types } }));
    if (reviewStore.state.value.reviewId !== reviewId) return;
    for (const mode of ['risk', 'narrative', 'guided'] as const) stopPolling(mode);
    aiStore.actions.update({ fileNotes: {}, guidedNotes: {}, narrativeOrder: null, riskScores: null,
      riskAnalysis: defaultAnalysisModeState(), narrativeAnalysis: defaultAnalysisModeState(), guidedAnalysis: defaultAnalysisModeState() });
    for (const mode of types) {
      aiStore.actions.setAnalysisState(mode, { status: 'running', error: null, progressCompleted: 0, progressTotal: 0 });
      resumePolling(mode, { loadResults: mode === 'guided' ? loadGuidedResults : partial => loadAnalysisResults(mode, partial) });
    }
    showToast('Fresh AI review started');
  } catch (error) { showToast(error instanceof Error ? error.message : 'Unable to start AI review'); }
}
