import { batch, effect } from 'kerfjs';
import { z } from 'zod';

import { apiCall } from '../../api/_runner.js';
import { GetAnalysisRespSchema, ListFilesRespSchema } from '../../api/index.js';
import type { PullTab } from '../../api/workspace.js';
import { resumePolling, stopPolling } from '../analysisEngine.js';
import { forgetReviewDiff, invalidateDiffCache } from '../diff/index.js';
import { loadGuidedResults } from '../guided.js';
import { loadAnalysisResults } from '../sidebar/sortMode.js';
import { defaultAnalysisModeState } from '../state.js';
import { aiStore, diffViewStore, editFormSignal, reviewStore, visibleFileOrder } from '../stores/index.js';
import { showToast } from '../toast.js';
import { activeTab, reviewLoadState, reviewRetry, reviewSessionKey, workspace, workspaceLoaded } from './state.js';

interface Session {
  status: 'loading' | 'ready' | 'error';
  error: string | null;
  review: typeof reviewStore.state.value;
  ai: typeof aiStore.state.value;
  diff: typeof diffViewStore.state.value;
  edit: typeof editFormSignal.value;
  scroll: number[];
  comment: string;
}
const scrollSelectors = ['.file-list', '.pr-description', '.pr-reviewers', '.pr-checks', '.pr-conversation'];
const sessionKey = reviewSessionKey;

/** Keep each PR's loaded review in memory; tab selection never navigates the page. */
export function initReviewSessions(): () => void {
  let live = true;
  const sessions = new Map<string, Session>();
  const requests = new Map<string, AbortController>();
  const analysisVersions = new Map<string, number>();
  const resetAnalysis = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const parsed = z.object({ reviewId: z.string(), types: z.array(z.enum(['narrative', 'guided'])) }).safeParse(event.detail);
    if (!parsed.success || ![...sessions.values()].some(session => session.review.reviewId === parsed.data.reviewId)) return;
    analysisVersions.set(parsed.data.reviewId, (analysisVersions.get(parsed.data.reviewId) ?? 0) + 1);
    for (const session of sessions.values()) if (session.review.reviewId === parsed.data.reviewId) {
      session.ai = { ...session.ai, fileNotes: {}, guidedNotes: {}, narrativeOrder: null, riskScores: null,
        riskAnalysis: defaultAnalysisModeState(), narrativeAnalysis: defaultAnalysisModeState(), guidedAnalysis: defaultAnalysisModeState() };
      for (const mode of parsed.data.types) session.ai[mode === 'guided' ? 'guidedAnalysis' : 'narrativeAnalysis'].status = 'running';
    }
  };
  document.addEventListener('glassbox-analysis-reset', resetAnalysis);
  let current = '';
  let clearedEmpty = false;
  let usedInitial = false;
  let lastRetry = reviewRetry.peek();
  const capture = (): Session => ({
    status: reviewLoadState.value.status, error: reviewLoadState.value.error,
    review: reviewStore.state.value, ai: aiStore.state.value, diff: diffViewStore.state.value,
    edit: editFormSignal.value,
    scroll: scrollSelectors.map(selector => document.querySelector(selector)?.scrollTop ?? 0),
    comment: document.querySelector<HTMLTextAreaElement>('.pr-comment-input')?.value ?? '',
  });
  let initial: Session | null = capture();
  initial.status = 'ready';
  initial.error = null;
  const empty: Session = {
    status: 'ready', error: null,
    review: { ...initial.review, reviewId: '', currentFileId: null, files: [], annotationCounts: {}, staleCounts: {},
      filterText: '', hiddenFileIds: new Set(), groundTruth: {}, pluginRendered: new Set(), notedFileIds: new Set() },
    ai: { ...initial.ai, fileNotes: {}, guidedNotes: {}, riskScores: null, narrativeOrder: null,
      riskAnalysis: defaultAnalysisModeState(), narrativeAnalysis: defaultAnalysisModeState(), guidedAnalysis: defaultAnalysisModeState() },
    diff: { ...initial.diff, collapsedFolders: new Set() }, edit: null, scroll: [], comment: '',
  };
  const restore = (session: Session) => {
    document.body.dataset.reviewId = session.review.reviewId;
    batch(() => {
      reviewStore.actions.update(session.review);
      aiStore.actions.update(session.ai);
      diffViewStore.actions.update(session.diff);
      editFormSignal.value = session.edit;
      reviewLoadState.value = { key: current, status: session.status, error: session.error };
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
    if (!tab.checkoutEvicted && reviewId !== '' && reviewId === initial?.review.reviewId && !usedInitial) {
      usedInitial = true;
      const captured = initial; initial = null;
      sessions.set(key, captured);
      return captured;
    }
    const session: Session = {
      status: 'loading', error: null,
      review: { ...empty.review, reviewId, currentFileId: null, files: [], annotationCounts: {}, staleCounts: {},
        filterText: '', hiddenFileIds: new Set(), groundTruth: {}, pluginRendered: new Set(), notedFileIds: new Set() },
      ai: { ...empty.ai, fileNotes: {}, guidedNotes: {}, riskScores: null, narrativeOrder: null,
        riskAnalysis: defaultAnalysisModeState(), narrativeAnalysis: defaultAnalysisModeState(), guidedAnalysis: defaultAnalysisModeState() },
      diff: { ...empty.diff, collapsedFolders: new Set() }, edit: null, scroll: [], comment: '',
    };
    try {
      const hidden: unknown = JSON.parse(localStorage.getItem(`glassbox.hidden.${reviewId}`) ?? '[]');
      if (Array.isArray(hidden) && hidden.every(id => typeof id === 'string')) session.review.hiddenFileIds = new Set(hidden);
    } catch { /* optional persistence */ }
    sessions.set(key, session);
    // Importing tabs have no review yet. Never fetch against the prior/default review.
    if (tab.reviewId === null || tab.checkoutEvicted) return session;
    const controller = new AbortController();
    requests.set(key, controller);
    const isCurrent = () => live && current === key && sessions.get(key) === session;
    const publish = (kind: 'files' | 'ai') => {
      if (!isCurrent()) return;
      if (kind === 'files') {
        const selected = session.review.files.find(file => file.id === reviewStore.state.value.currentFileId)?.id ?? null;
        reviewStore.actions.update({ ...session.review, currentFileId: selected });
        if (selected === null) reviewStore.actions.update({ currentFileId: visibleFileOrder.value.at(0) ?? session.review.files.at(-1)?.id ?? null });
        reviewLoadState.value = { key, status: session.status, error: session.error };
      } else aiStore.actions.update({ fileNotes: session.ai.fileNotes, guidedNotes: session.ai.guidedNotes, narrativeOrder: session.ai.narrativeOrder, narrativeAnalysis: session.ai.narrativeAnalysis, guidedAnalysis: session.ai.guidedAnalysis });
    };
    void apiCall(ListFilesRespSchema, '/files', { reviewId, signal: controller.signal }).then(data => {
      if (sessions.get(key) !== session) return;
      Object.assign(session.review, data, {
        pluginRendered: new Set(data.pluginRendered ?? []), notedFileIds: new Set(data.notedFileIds ?? []),
      });
      session.status = 'ready';
      publish('files');
    }).catch((error: unknown) => {
      if (sessions.get(key) !== session) return;
      session.status = 'error'; session.error = String(error);
      if (isCurrent()) {
        reviewLoadState.value = { key, status: 'error', error: session.error };
        showToast(session.error);
      }
    });
    const analysisVersion = analysisVersions.get(reviewId) ?? 0;
    for (const mode of ['narrative', 'guided'] as const) {
      void apiCall(GetAnalysisRespSchema, `/ai/analysis/${mode}`, { reviewId, signal: controller.signal }).then(data => {
        if (!live || sessions.get(key) !== session || analysisVersion !== (analysisVersions.get(reviewId) ?? 0)) return;
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
        if (isCurrent() && status === 'running') resumePolling(mode, {
          loadResults: mode === 'guided' ? loadGuidedResults : partial => loadAnalysisResults('narrative', partial),
        });
      }).catch(() => { /* Guidance can be absent while the review is first imported. */ });
    }
    return session;
  };
  const stop = effect(() => {
    void workspace.value;
    void workspaceLoaded.value;
    const retry = reviewRetry.value;
    queueMicrotask(() => {
      if (!live) return;
      const tabs = workspace.value.tabs;
      const keys = new Set(tabs.map(sessionKey));
      const ids = new Set(tabs.map(tab => tab.reviewId));
      for (const [key, session] of sessions) if (!keys.has(key)) {
        requests.get(key)?.abort(); requests.delete(key); sessions.delete(key);
        if (ids.has(session.review.reviewId)) {
          // The same PR now has a different source snapshot, including automatic refreshes.
          invalidateDiffCache(session.review.reviewId);
        } else {
          forgetReviewDiff(session.review.reviewId);
          analysisVersions.delete(session.review.reviewId);
        }
      }
      if (workspaceLoaded.value) {
        // Also remove persisted reading state left by tabs closed before this app version.
        try {
          for (const key of Object.keys(localStorage)) {
            const prefix = ['glassbox.hidden.', 'glassbox.lastFile.', 'glassbox-collapsed-'].find(prefix => key.startsWith(prefix));
            if (prefix !== undefined && !ids.has(key.slice(prefix.length))) localStorage.removeItem(key);
          }
        } catch { /* optional persistence */ }
      }
      const tab = activeTab();
      if (tab === undefined) {
        if (!clearedEmpty && (current !== '' || workspaceLoaded.value)) {
          clearedEmpty = true;
          for (const mode of ['risk', 'narrative', 'guided'] as const) stopPolling(mode);
          initial = null; current = ''; restore(empty);
          window.history.replaceState(null, '', '/');
          document.dispatchEvent(new Event('glassbox-review-selected'));
        }
        return;
      }
      clearedEmpty = false;
      const key = sessionKey(tab);
      if (retry !== lastRetry) {
        lastRetry = retry;
        if (sessions.get(key)?.status === 'error') {
          sessions.delete(key);
          if (current === key) current = '';
        }
      }
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
        window.history.replaceState(null, '', tab.reviewId === null ? '/' : `/?reviewId=${encodeURIComponent(tab.reviewId)}`);
        document.dispatchEvent(new Event('glassbox-review-selected'));
      }
      for (const other of workspace.value.tabs) if (other.reviewId !== null && !other.checkoutEvicted) prepare(other);
      if (workspaceLoaded.value) initial = null;
    });
  });
  return () => { live = false; stop(); for (const request of requests.values()) request.abort(); requests.clear(); sessions.clear(); initial = null; document.removeEventListener('glassbox-analysis-reset', resetAnalysis); };
}
