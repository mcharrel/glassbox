import { batch, effect } from 'kerfjs';

import { apiCall } from '../../api/_runner.js';
import { GetAnalysisRespSchema, ListFilesRespSchema } from '../../api/index.js';
import type { PullTab } from '../../api/workspace.js';
import { resumePolling, stopPolling } from '../analysisEngine.js';
import { invalidateDiffCache } from '../diff/index.js';
import { loadGuidedResults } from '../guided.js';
import { loadAnalysisResults } from '../sidebar/sortMode.js';
import { defaultAnalysisModeState } from '../state.js';
import { aiStore, diffViewStore, editFormSignal, reviewStore, visibleFileOrder } from '../stores/index.js';
import { showToast } from '../toast.js';
import { activeTab, workspace } from './state.js';

interface Session {
  review: typeof reviewStore.state.value;
  ai: typeof aiStore.state.value;
  diff: typeof diffViewStore.state.value;
  edit: typeof editFormSignal.value;
  scroll: number[];
  comment: string;
}
const scrollSelectors = ['.file-list', '.pr-description', '.pr-reviewers', '.pr-checks', '.pr-conversation'];
const sessionKey = (tab: PullTab) => `${tab.reviewId ?? ''}:${tab.reviewedBase}:${tab.reviewedHead}`;

/** Keep each PR's loaded review in memory; tab selection never navigates the page. */
export function initReviewSessions(): () => void {
  let live = true;
  const sessions = new Map<string, Session>();
  let current = '';
  let usedInitial = false;
  const capture = (): Session => ({
    review: reviewStore.state.value, ai: aiStore.state.value, diff: diffViewStore.state.value,
    edit: editFormSignal.value,
    scroll: scrollSelectors.map(selector => document.querySelector(selector)?.scrollTop ?? 0),
    comment: document.querySelector<HTMLTextAreaElement>('.pr-comment-input')?.value ?? '',
  });
  const initial = capture();
  const restore = (session: Session) => {
    document.body.dataset.reviewId = session.review.reviewId;
    batch(() => {
      reviewStore.actions.update(session.review);
      aiStore.actions.update(session.ai);
      diffViewStore.actions.update(session.diff);
      editFormSignal.value = session.edit;
    });
    if (session.review.currentFileId === null && session.review.files.length > 0) {
      let last: string | null = null;
      try { last = localStorage.getItem(`glassbox.lastFile.${session.review.reviewId}`); } catch { /* optional */ }
      reviewStore.actions.update({ currentFileId: session.review.files.find(file => file.id === last)?.id
        ?? visibleFileOrder.value.at(0) ?? session.review.files.at(-1)?.id ?? null });
    }
    scrollSelectors.forEach((selector, index) => {
      const element = document.querySelector(selector);
      if (element) element.scrollTop = session.scroll.at(index) ?? 0;
    });
    const input = document.querySelector<HTMLTextAreaElement>('.pr-comment-input');
    if (input) input.value = session.comment;
  };
  const prepare = (tab: PullTab): Session => {
    const key = sessionKey(tab);
    const existing = sessions.get(key);
    if (existing) return existing;
    const reviewId = tab.reviewId ?? '';
    if ([...sessions.values()].some(value => value.review.reviewId === reviewId)) invalidateDiffCache(reviewId);
    if (reviewId === initial.review.reviewId && !usedInitial) {
      usedInitial = true;
      sessions.set(key, initial);
      return initial;
    }
    const session: Session = {
      review: { ...initial.review, reviewId, currentFileId: null, files: [], annotationCounts: {}, staleCounts: {},
        filterText: '', hiddenFileIds: new Set(), groundTruth: {}, pluginRendered: new Set(), notedFileIds: new Set() },
      ai: { ...initial.ai, fileNotes: {}, guidedNotes: {}, riskScores: null, narrativeOrder: null,
        riskAnalysis: defaultAnalysisModeState(), narrativeAnalysis: defaultAnalysisModeState(), guidedAnalysis: defaultAnalysisModeState() },
      diff: { ...initial.diff, collapsedFolders: new Set() }, edit: null, scroll: [], comment: '',
    };
    try {
      const hidden: unknown = JSON.parse(localStorage.getItem(`glassbox.hidden.${reviewId}`) ?? '[]');
      if (Array.isArray(hidden) && hidden.every(id => typeof id === 'string')) session.review.hiddenFileIds = new Set(hidden);
    } catch { /* optional persistence */ }
    sessions.set(key, session);
    const publish = (kind: 'files' | 'ai') => {
      if (!live || current !== key) return;
      if (kind === 'files') {
        const selected = reviewStore.state.value.currentFileId;
        reviewStore.actions.update({ ...session.review, currentFileId: selected });
        if (selected === null) reviewStore.actions.update({ currentFileId: visibleFileOrder.value.at(0) ?? session.review.files.at(-1)?.id ?? null });
      } else aiStore.actions.update({ fileNotes: session.ai.fileNotes, guidedNotes: session.ai.guidedNotes, narrativeOrder: session.ai.narrativeOrder, narrativeAnalysis: session.ai.narrativeAnalysis, guidedAnalysis: session.ai.guidedAnalysis });
    };
    void apiCall(ListFilesRespSchema, '/files', { reviewId }).then(data => {
      Object.assign(session.review, data, {
        pluginRendered: new Set(data.pluginRendered ?? []), notedFileIds: new Set(data.notedFileIds ?? []),
      });
      publish('files');
    }).catch((error: unknown) => { sessions.delete(key); if (current === key) showToast(String(error)); });
    for (const mode of ['narrative', 'guided'] as const) {
      void apiCall(GetAnalysisRespSchema, `/ai/analysis/${mode}`, { reviewId }).then(data => {
        const status = data.status === 'running' || data.status === 'completed' || data.status === 'failed' ? data.status : 'idle';
        session.ai[mode === 'guided' ? 'guidedAnalysis' : 'narrativeAnalysis'] = { ...defaultAnalysisModeState(), status };
        const notes = Object.fromEntries(data.scores.flatMap(score => score.notes === null ? [] : [[score.reviewFileId, score.notes]]));
        if (mode === 'guided') session.ai.guidedNotes = notes;
        else {
          session.ai.fileNotes = notes;
          session.ai.narrativeOrder = data.scores.map(score => ({ reviewFileId: score.reviewFileId,
            filePath: score.filePath, position: score.sortOrder, rationale: score.rationale ?? '' }));
        }
        publish('ai');
        if (live && current === key && status === 'running') resumePolling(mode, {
          loadResults: mode === 'guided' ? loadGuidedResults : partial => loadAnalysisResults('narrative', partial),
        });
      }).catch(() => { /* Guidance can be absent while the review is first imported. */ });
    }
    return session;
  };
  const stop = effect(() => {
    void workspace.value;
    queueMicrotask(() => {
      if (!live) return;
      const tab = activeTab();
      if (tab?.reviewId === null || tab === undefined) return;
      const key = sessionKey(tab);
      if (key !== current) {
        if (current) {
          const previous = sessions.get(current);
          if (previous) Object.assign(previous, capture());
        }
        const switching = current !== '';
        if (switching) for (const mode of ['risk', 'narrative', 'guided'] as const) stopPolling(mode);
        const session = prepare(tab);
        current = key;
        restore(session);
        if (switching) {
          for (const mode of ['risk', 'narrative'] as const) {
            if (session.ai[mode === 'risk' ? 'riskAnalysis' : 'narrativeAnalysis'].status === 'running')
              resumePolling(mode, { loadResults: partial => loadAnalysisResults(mode, partial) });
          }
          if (session.ai.guidedAnalysis.status === 'running') resumePolling('guided', { loadResults: loadGuidedResults });
        }
        window.history.replaceState(null, '', `/?reviewId=${encodeURIComponent(tab.reviewId)}`);
        document.dispatchEvent(new Event('glassbox-review-selected'));
      }
      for (const other of workspace.value.tabs) if (other.reviewId !== null) prepare(other);
    });
  });
  return () => { live = false; stop(); };
}
