import type { SafeHtml, Signal } from 'kerfjs';
import { delegate, signal } from 'kerfjs';
import { overlay } from 'kerfjs/overlay';
import { debounce } from 'kerfjs/timing';

import { AgentAccessSchema, ReasoningEffortSchema, selectedReasoning } from '../../ai/options.js';
import {
  deleteAIKey as rawDeleteAIKey,
  disableChannel as rawDisableChannel,
  enableChannel as rawEnableChannel,
  getAIConfig,
  getAIKeyStatus,
  getChannelStatus,
  getClaudeCheck,
  listAIModels,
  listThemes,
  saveAIConfig as rawSaveAIConfig,
  saveAIKey as rawSaveAIKey,
} from '../../api/index.js';
import { IconX } from '../../icons.js';
import { asEl, asInput, asSelect } from '../dom.js';
import { invalidateGuidedAnalysis } from '../guided.js';
import { asKeyStorage, asPlatform } from '../narrow.js';
import { triggerShare } from '../share.js';
import { invalidateAnalysisCache } from '../sidebar/sortMode.js';
import { aiStore } from '../stores/index.js';
import { getTauriGlobal } from '../tauri.js';
import { switchTheme as rawSwitchTheme } from '../themes.js';
import { CHANNEL_STATUS_POLL_MS, SETTINGS_CONFIG_DEBOUNCE_MS, TOAST_DURATION_MS } from '../timing.js';
import { showToast } from '../toast.js';
import { bindCompanyTab, companyTab, loadCompanyTab, resetCompanyTab } from './companyTab.js';
import { experimentalTab } from './experimentalTab.js';
import { generalTab } from './generalTab.js';
import { bindProfileTab, loadProfileTab, profileTab, resetProfileTab } from './profileTab.js';
import type { ChannelState, ConfigResponse, KeyStatusResponse, ModelsResponse, Tab, TabContext, ThemesResponse } from './tabContext.js';
import { showThemeManager } from './themeManager.js';

const TABS: Tab[] = [generalTab, profileTab, experimentalTab, companyTab];

interface SettingsUIState {
  activeTab: string;
  currentPlatform: string;
  currentModel: string;
  reasoningEffort: TabContext['reasoningEffort'];
  agentAccess: TabContext['agentAccess'];
  // Apple-FM fallback selection (empty string = none).
  fallbackPlatform: string;
  fallbackModel: string;
  localEndpoint: string;
  guidedEnabled: boolean;
  guidedTopics: Set<string>;
  activeThemeId: string;
}

/** The dialog's server data (6 endpoints). Cached across opens so a repeat open
 *  renders instantly without a spinner (GB-1131). */
async function fetchSettingsData() {
  return Promise.all([
    getAIKeyStatus(),
    listAIModels(),
    getAIConfig(),
    listThemes(),
    getClaudeCheck(),
    getChannelStatus(),
  ]);
}
type SettingsData = Awaited<ReturnType<typeof fetchSettingsData>>;

// Module-level cache of the last-fetched data. Present ⇒ a repeat open renders
// immediately (no spinner, no network). Any action that mutates server settings
// calls `invalidateSettingsData()`, so the next open after a change re-fetches
// and shows it; a plain view-and-close leaves the cache intact (instant reopen).
let settingsCache: SettingsData | null = null;

/** Drop the cached settings data so the next open re-fetches. Called after any
 *  action that changes server-side settings (config, key, theme, channel) — see the wrapped mutators below. */
function invalidateSettingsData(): void {
  settingsCache = null;
}

/** Wrap a mutating API call so it drops the settings cache on success — the
 *  wrapped names below are used at every dialog call site, so a change is always
 *  reflected on the next open without threading invalidation through each
 *  handler. */
function withInvalidate<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const result = await fn(...args);
    invalidateSettingsData();
    return result;
  };
}

const saveAIConfig = withInvalidate(rawSaveAIConfig);
const saveAIKey = withInvalidate(rawSaveAIKey);
const deleteAIKey = withInvalidate(rawDeleteAIKey);
const enableChannel = withInvalidate(rawEnableChannel);
const disableChannel = withInvalidate(rawDisableChannel);
const switchTheme = withInvalidate(rawSwitchTheme);

export function showSettingsDialog(onClose?: () => void): void {
  resetCompanyTab();
  resetProfileTab();

  // The whole modal — `.modal-overlay` backdrop, the `.modal` content mount,
  // Escape/backdrop dismissal, focus trap, and focus restore — is owned by
  // kerfjs/overlay (GB-1132; matches themeEditor/completion-modal). The content
  // is driven by a swappable render fn: it starts as the loading spinner and,
  // when data arrives, `renderSettingsModal` swaps in the real shell render fn
  // (which closes over the freshly-created non-null `ui` signal). Showing the
  // modal never blocks on the six-endpoint fetch — with cached data the spinner
  // is never seen; on a cold open it shows while we load (GB-1129).
  const content = signal<() => SafeHtml>(() => (
    <div className="modal settings-dialog">
      <div className="settings-loading"><span className="analysis-spinner"></span></div>
    </div>
  ));

  // Escape + backdrop are handled by overlay() itself (GB-1147) now that the modal
  // is a native `<dialog>` — Escape routes through `handle.close()` (proper
  // teardown + focus restore). This replaced a div-overlay-era bubble-phase
  // document listener. Because kerf's native path dismisses on the dialog's own
  // `cancel` event (which the UA fires only on the TOPMOST modal dialog), a
  // single Escape dismisses only the topmost surface — a stacked child overlay
  // (theme manager / editor) closes alone, the settings dialog underneath stays
  // (GB-1148).
  const handle = overlay(() => content.value(), {
    className: 'modal-overlay', dismiss: ['escape', 'backdrop'], trap: true, native: true,
  });
  const close = (): void => { handle.close(); };

  // Cleanup registry — `renderSettingsModal` appends its mount-adjacent teardowns
  // (actions dispose, channel poll) once it takes over. overlay() owns the mount
  // + node removal + focus restore; on any dismissal (Escape / backdrop / a
  // programmatic close) `handle.result` resolves, and we run our teardowns (LIFO)
  // then notify. Safe whether the user dismisses during loading or after build.
  const teardowns: Array<() => void> = [];
  void handle.result.then(() => {
    resetCompanyTab();
    resetProfileTab();
    while (teardowns.length > 0) teardowns.pop()?.();
    if (onClose !== undefined) onClose();
  });

  function build(data: SettingsData): void {
    // Dismissed before the data arrived? overlay() detached the wrapper.
    if (!handle.el.isConnected) return;
    const [keyStatus, modelsData, configData, themesData, channelCheck, channelStatus] = data;
    const channelState: ChannelState = {
      enabled: channelStatus.enabled,
      connected: channelStatus.connected,
      claudeInstalled: channelCheck.installed,
      claudeVersion: channelCheck.version,
      meetsMinimum: channelCheck.meetsMinimum,
    };
    renderSettingsModal(
      { overlay: handle.el, setContent: (fn) => { content.value = fn; }, close, registerTeardown: (fn) => { teardowns.push(fn); } },
      keyStatus, modelsData, configData, themesData, channelState,
    );
  }

  if (settingsCache !== null) {
    // Repeat open: render instantly from cache. `build()` swaps the real render
    // fn over the spinner synchronously, so the spinner is never seen.
    build(settingsCache);
  } else {
    // Cold open: the spinner (already mounted) shows while we fetch.
    void (async () => {
      let data: SettingsData;
      try {
        data = await fetchSettingsData();
      } catch {
        showToast('Couldn’t load settings — please try again.');
        close();
        return;
      }
      settingsCache = data;
      build(data);
    })();
  }
}

/** The already-shown overlay wrapper + lifecycle hooks, handed to
 *  `renderSettingsModal` so it populates the existing overlay (rather than
 *  creating its own) and registers its teardown into the shared dismissal. */
interface ModalShell {
  /** The kerfjs/overlay wrapper (`.modal-overlay`); the mount root, stable
   *  across re-renders — delegates and error toasts bind here. */
  overlay: HTMLElement;
  /** Swap the overlay's content render fn — used to replace the spinner with
   *  the real settings shell once data has loaded. */
  setContent: (fn: () => SafeHtml) => void;
  close: () => void;
  registerTeardown: (fn: () => void) => void;
}

function renderSettingsModal(
  shell: ModalShell,
  keyStatus: KeyStatusResponse,
  modelsData: ModelsResponse,
  configData: ConfigResponse,
  themesData: ThemesResponse,
  channelState: ChannelState,
): void {
  const { overlay, setContent, close: closeDialog, registerTeardown } = shell;
  const isTauri = getTauriGlobal() !== undefined;

  // GB-1130 height pin, GB-1132: under overlay() the `.modal` div is part of the
  // mounted template, so an imperative `style.minHeight` would be clobbered on
  // the next child morph. Instead min-height is a signal read in the template
  // below, so morph preserves it. `null` = unmeasured/natural height.
  const minHeight = signal<number | null>(null);

  // Per-dialog reactive state. Bumps to this signal drive the mount()
  // re-render. The signal lives in this closure (not in the global
  // `stores/index.ts`) because it represents a transient modal — opening the
  // dialog a second time should fetch fresh server data and reset live UI.
  const ui = signal<SettingsUIState>({
    activeTab: 'general',
    currentPlatform: configData.platform,
    currentModel: configData.model,
    reasoningEffort: configData.reasoningEffort,
    agentAccess: configData.agentAccess,
    fallbackPlatform: configData.fallbackPlatform ?? '',
    fallbackModel: configData.fallbackModel ?? '',
    localEndpoint: configData.localEndpoint,
    guidedEnabled: configData.guidedReview.enabled,
    guidedTopics: new Set(configData.guidedReview.topics),
    activeThemeId: themesData.activeId,
  });

  function setUi(partial: Partial<SettingsUIState>): void {
    ui.value = { ...ui.value, ...partial };
  }
  function forceRerender(): void {
    ui.value = { ...ui.value };
  }

  const actions = createActions({ ui, setUi, forceRerender, keyStatus, configData, channelState, overlay, modelsData, themesData });
  registerTeardown(() => { actions.dispose(); });

  // Periodic Claude-channel health poll (doc 17.3). While the dialog is open we
  // re-read `/api/channel/status` so the connected/disconnected indicator stays
  // live as a Claude Code session attaches or drops. Mutating the shared
  // `channelState` object + bumping the render signal is enough — the mount
  // re-reads it. Transient fetch failures keep the last known state.
  const channelPoll = setInterval(() => {
    void (async () => {
      try {
        const s = await getChannelStatus();
        if (s.enabled !== channelState.enabled || s.connected !== channelState.connected) {
          channelState.enabled = s.enabled;
          channelState.connected = s.connected;
          forceRerender();
        }
      } catch { /* transient — keep last known state */ }
    })();
  }, CHANNEL_STATUS_POLL_MS);
  registerTeardown(() => { clearInterval(channelPoll); });

  // Swap the reactive shell in over the loading spinner. overlay() owns the
  // mount() (rooted at the wrapper), so we hand it a new content render fn
  // rather than mounting ourselves. The fn reads `ui` + `minHeight`, so both a
  // tab switch and the height pin below re-run it. The `.modal` div lives in the
  // template now (the wrapper is the mount root), so its `min-height` is a
  // signal read, not an imperative style.
  const renderShellContent = (): SafeHtml => {
    const ctx = buildContext({ ui, isTauri, keyStatus, modelsData, themesData, channelState, actions });
    const visible = TABS.filter(t => t.enabled === undefined || t.enabled(ctx));
    const cur = ui.value;
    let activeId = cur.activeTab;
    if (!visible.some(t => t.id === activeId)) {
      activeId = visible[0]?.id ?? 'general';
      // Defer the state correction so we don't write during a render.
      queueMicrotask(() => { setUi({ activeTab: activeId }); });
    }
    const mh = minHeight.value;
    return (
      <div className="modal settings-dialog" style={mh !== null ? `min-height:${String(mh)}px` : undefined}>
        {renderShell(visible, activeId, ctx)}
      </div>
    );
  };
  setContent(renderShellContent);

  // The `.modal` element inside the wrapper — now rendered by the swap above.
  const modalEl = overlay.querySelector<HTMLElement>('.modal');

  // GB-1130: pin the dialog to the TALLEST tab's height so switching tabs never
  // resizes it. Measure each tab once, synchronously — the mount re-renders on
  // the `setUi` write before the browser paints, so the intermediate tabs are
  // never seen — take the max height, and set it as `min-height` via the signal
  // read in the template above (which morph preserves across the child morphs).
  // Shorter tabs then get empty space at the bottom instead of shrinking.
  if (modalEl !== null) {
    const ctx = buildContext({ ui, isTauri, keyStatus, modelsData, themesData, channelState, actions });
    const visibleTabs = TABS.filter(t => t.enabled === undefined || t.enabled(ctx));
    if (visibleTabs.length > 1) {
      const original = ui.value.activeTab;
      let maxHeight = 0;
      for (const t of visibleTabs) {
        setUi({ activeTab: t.id });
        maxHeight = Math.max(maxHeight, modalEl.getBoundingClientRect().height);
      }
      setUi({ activeTab: original });
      if (maxHeight > 0) minHeight.value = Math.ceil(maxHeight);
    }
  }

  setupDelegates({ overlay, setUi, forceRerender, actions, modelsData, themesData, channelState, closeDialog });
}

// --- Action handlers (closure-bound, returned as an object so they can be
//     passed to TabContext + the delegate setup without duplicating closure
//     wiring).

interface ActionDeps {
  ui: Signal<SettingsUIState>;
  setUi: (p: Partial<SettingsUIState>) => void;
  forceRerender: () => void;
  keyStatus: KeyStatusResponse;
  configData: ConfigResponse;
  channelState: ChannelState;
  overlay: HTMLElement;
  modelsData: ModelsResponse;
  themesData: ThemesResponse;
}

interface Actions {
  saveConfig: () => void;
  saveConfigDebounced: () => void;
  saveLocalEndpoint: (endpoint: string) => void;
  saveKey: () => void;
  removeKey: () => void;
  saveFallbackKey: () => void;
  removeFallbackKey: () => void;
  dispose: () => void;
}

function createActions(deps: ActionDeps): Actions {
  const { ui, setUi, forceRerender, keyStatus, configData, overlay } = deps;
  let lastSavedGuidedEnabled = configData.guidedReview.enabled;
  let lastSavedGuidedTopics = new Set(configData.guidedReview.topics);

  /** Surface a transient error when a settings save/remove request fails, so a
   *  failure isn't silent. Appended to `overlay` (not the mounted modal body)
   *  so a re-render can't clobber it; auto-dismisses. */
  function flashSettingsError(message: string): void {
    showToast(message, { container: overlay, className: 'settings-error-toast' });
  }

  function saveConfig(): void {
    const cur = ui.value;
    const newTopics = Array.from(cur.guidedTopics);
    const guidedChanged = cur.guidedEnabled !== lastSavedGuidedEnabled
      || newTopics.length !== lastSavedGuidedTopics.size
      || newTopics.some(t => !lastSavedGuidedTopics.has(t));

    void (async () => {
      try {
        await saveAIConfig({
          platform: asPlatform(cur.currentPlatform),
          model: cur.currentModel,
          reasoningEffort: selectedReasoning(cur.currentPlatform, cur.currentModel, cur.reasoningEffort),
          agentAccess: cur.agentAccess,
          localEndpoint: cur.localEndpoint,
          guidedReview: { enabled: cur.guidedEnabled, topics: newTopics },
          // Only send the fallback while Apple is the primary — otherwise omit
          // it so an unrelated save doesn't clear the stored selection.
          ...(cur.currentPlatform === 'apple'
            ? { fallbackPlatform: cur.fallbackPlatform, fallbackModel: cur.fallbackModel }
            : {}),
        });

        const newConfig = await getAIConfig();
        aiStore.actions.update({
          aiConfigured: newConfig.keyConfigured,
          guidedReviewEnabled: cur.guidedEnabled,
        });
        configData.guidedReview = { enabled: cur.guidedEnabled, topics: newTopics };

        if (guidedChanged && aiStore.state.value.aiConfigured) {
          invalidateAnalysisCache();
          invalidateGuidedAnalysis();
        }

        lastSavedGuidedEnabled = cur.guidedEnabled;
        lastSavedGuidedTopics = new Set(cur.guidedTopics);
      } catch {
        flashSettingsError('Couldn’t save settings — please try again.');
      }
    })();
  }

  // Save the local base URL, then re-discover models against it so the model
  // dropdown reflects what the (possibly just-changed) server offers.
  function saveLocalEndpoint(endpoint: string): void {
    setUi({ localEndpoint: endpoint });
    void (async () => {
      try {
        const cur = ui.value;
        await saveAIConfig({ platform: asPlatform(cur.currentPlatform), model: cur.currentModel, localEndpoint: endpoint });
        const fresh = await listAIModels();
        deps.modelsData.models.local = fresh.models.local;
        forceRerender();
      } catch {
        flashSettingsError('Couldn’t reach the local model server at that URL.');
      }
    })();
  }

  // Auto-save debouncers (kerfjs/timing) — replace the hand-rolled
  // configTimer/appNameTimer; canceled on dispose so a pending save can't fire
  // after the dialog closes.
  const saveConfigDebounced = debounce(saveConfig, SETTINGS_CONFIG_DEBOUNCE_MS);

  // Save/remove are parameterized by platform + element ids so the same logic
  // serves the primary platform's key block and the Apple-FM fallback's.
  function saveKeyFor(platform: string, inputId: string, storageName: string): void {
    if (platform === '') return;
    const keyInput = overlay.querySelector<HTMLInputElement>(`#${inputId}`);
    if (keyInput === null || keyInput.value.trim() === '') return;
    const storageRadio = overlay.querySelector<HTMLInputElement>(`input[name="${storageName}"]:checked`);
    const storage = storageRadio?.value ?? 'config';
    void (async () => {
      try {
        await saveAIKey({ platform: asPlatform(platform), key: keyInput.value.trim(), storage: asKeyStorage(storage) });
        const newStatus = await getAIKeyStatus();
        keyStatus.status = newStatus.status;
        const newConfig = await getAIConfig();
        aiStore.actions.update({ aiConfigured: newConfig.keyConfigured });
        forceRerender();
      } catch {
        flashSettingsError('Couldn’t save the API key — please try again.');
      }
    })();
  }

  function removeKeyFor(platform: string): void {
    if (platform === '') return;
    void (async () => {
      try {
        await deleteAIKey({ platform: asPlatform(platform) });
        const newStatus = await getAIKeyStatus();
        keyStatus.status = newStatus.status;
        const newConfig = await getAIConfig();
        aiStore.actions.update({ aiConfigured: newConfig.keyConfigured });
        forceRerender();
      } catch {
        flashSettingsError('Couldn’t remove the API key — please try again.');
      }
    })();
  }

  const saveKey = (): void => { saveKeyFor(ui.value.currentPlatform, 'settings-key', 'key-storage'); };
  const removeKey = (): void => { removeKeyFor(ui.value.currentPlatform); };
  const saveFallbackKey = (): void => { saveKeyFor(ui.value.fallbackPlatform, 'settings-fallback-key', 'fallback-key-storage'); };
  const removeFallbackKey = (): void => { removeKeyFor(ui.value.fallbackPlatform); };

  function dispose(): void {
    saveConfigDebounced.cancel();
  }

  return { saveConfig, saveConfigDebounced, saveLocalEndpoint, saveKey, removeKey, saveFallbackKey, removeFallbackKey, dispose };
}

// --- TabContext construction ---

function buildContext(args: {
  ui: Signal<SettingsUIState>;
  isTauri: boolean;
  keyStatus: KeyStatusResponse;
  modelsData: ModelsResponse;
  themesData: ThemesResponse;
  channelState: ChannelState;
  actions: Actions;
}): TabContext {
  const cur = args.ui.value;
  return {
    keyStatus: args.keyStatus, modelsData: args.modelsData, themesData: args.themesData,
    channelState: args.channelState,
    isTauri: args.isTauri,
    currentPlatform: cur.currentPlatform,
    currentModel: cur.currentModel,
    reasoningEffort: cur.reasoningEffort,
    agentAccess: cur.agentAccess,
    fallbackPlatform: cur.fallbackPlatform,
    fallbackModel: cur.fallbackModel,
    localEndpoint: cur.localEndpoint,
    guidedEnabled: cur.guidedEnabled,
    guidedTopics: cur.guidedTopics,
    activeThemeId: cur.activeThemeId,
    saveConfig: args.actions.saveConfig,
    saveKey: args.actions.saveKey,
    removeKey: args.actions.removeKey,
    switchTheme: (id: string) => void switchTheme(id),
    showThemeManager,
    refreshThemes: () => listThemes().then(updated => {
      args.themesData.themes = updated.themes;
      args.themesData.activeId = updated.activeId;
      return updated;
    }),
  };
}

// --- Delegated event handlers ---
// One `delegate(overlay, …)` per concern; fires for every re-render
// automatically. Grouped by tab for readability.

function setupDelegates(args: {
  overlay: HTMLElement;
  setUi: (p: Partial<SettingsUIState>) => void;
  forceRerender: () => void;
  actions: Actions;
  modelsData: ModelsResponse;
  themesData: ThemesResponse;
  channelState: ChannelState;
  closeDialog: () => void;
}): void {
  const { overlay, setUi, forceRerender, actions, modelsData, themesData, channelState, closeDialog } = args;
  bindCompanyTab(overlay);
  bindProfileTab(overlay);

  void delegate(overlay, 'click', '#settings-close', closeDialog);
  void delegate(overlay, 'click', '[data-tab]', (_e, btn) => {
    const t = asEl(btn).dataset.tab;
    if (t === undefined) return;
    setUi({ activeTab: t });
    if (t === 'profile') loadProfileTab();
    if (t === 'company') loadCompanyTab();
  });

  // General tab
  void delegate(overlay, 'change', '#settings-theme', (_e, sel) => {
    const id = asSelect(sel).value;
    setUi({ activeThemeId: id });
    void switchTheme(id);
  });
  void delegate(overlay, 'click', '#manage-themes-btn', () => {
    showThemeManager(() => {
      void (async () => {
        const updated = await listThemes();
        themesData.themes = updated.themes;
        themesData.activeId = updated.activeId;
        setUi({ activeThemeId: updated.activeId });
      })();
    });
  });
  void delegate(overlay, 'click', '#settings-share-link', (e) => {
    e.preventDefault();
    void triggerShare();
  });
  // Experimental tab
  void delegate(overlay, 'click', '.settings-platform-control [data-platform]', (_e, btn) => {
    const platform = asEl(btn).dataset.platform;
    if (platform === undefined) return;
    const models = modelsData.models[asPlatform(platform)];
    const defaultModel = models.find(m => m.isDefault);
    const newModel = defaultModel ? defaultModel.id : (models[0]?.id ?? '');
    setUi({ currentPlatform: platform, currentModel: newModel });
    actions.saveConfig();
  });
  void delegate(overlay, 'change', '#settings-model', (_e, sel) => {
    setUi({ currentModel: asSelect(sel).value });
    actions.saveConfig();
  });
  void delegate(overlay, 'change', '#settings-reasoning', (_e, sel) => {
    setUi({ reasoningEffort: ReasoningEffortSchema.parse(asSelect(sel).value) });
    actions.saveConfig();
  });
  void delegate(overlay, 'change', '#settings-agent-access', (_e, sel) => {
    setUi({ agentAccess: AgentAccessSchema.parse(asSelect(sel).value) });
    actions.saveConfig();
  });
  void delegate(overlay, 'change', '#settings-local-endpoint', (_e, input) => {
    actions.saveLocalEndpoint(asInput(input).value.trim());
  });
  void delegate(overlay, 'click', '#remove-key', actions.removeKey);
  void delegate(overlay, 'click', '#save-key-btn', actions.saveKey);
  void delegate(overlay, 'keydown', '#settings-key', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter') { ke.preventDefault(); actions.saveKey(); }
  });
  // Apple-FM fallback model picker (shown only when Apple is the platform).
  void delegate(overlay, 'change', '#settings-fallback-platform', (_e, sel) => {
    const platform = asSelect(sel).value;
    let model = '';
    if (platform !== '') {
      const models = modelsData.models[asPlatform(platform)];
      const def = models.find(m => m.isDefault);
      model = def ? def.id : (models[0]?.id ?? '');
    }
    setUi({ fallbackPlatform: platform, fallbackModel: model });
    actions.saveConfig();
  });
  void delegate(overlay, 'change', '#settings-fallback-model', (_e, sel) => {
    setUi({ fallbackModel: asSelect(sel).value });
    actions.saveConfig();
  });
  void delegate(overlay, 'click', '#remove-fallback-key', actions.removeFallbackKey);
  void delegate(overlay, 'click', '#save-fallback-key-btn', actions.saveFallbackKey);
  void delegate(overlay, 'keydown', '#settings-fallback-key', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key === 'Enter') { ke.preventDefault(); actions.saveFallbackKey(); }
  });
  void delegate(overlay, 'change', '#settings-guided-enabled', (_e, cb) => {
    setUi({ guidedEnabled: asInput(cb).checked });
    actions.saveConfig();
  });
  void delegate(overlay, 'change', '#settings-channel-enabled', (_e, cb) => {
    const enabled = asInput(cb).checked;
    channelState.enabled = enabled;
    // Disabling tears down the listener, so reflect "not connected" at once; the
    // periodic poll reconciles the connected state once a session attaches.
    if (!enabled) channelState.connected = false;
    void (enabled ? enableChannel() : disableChannel());
    forceRerender();
  });
  void delegate(overlay, 'click', '#channel-copy-btn', (_e, btn) => {
    void navigator.clipboard.writeText('claude --dangerously-load-development-channels server:glassbox-channel');
    const el = asEl(btn);
    el.textContent = 'Copied!';
    setTimeout(() => { el.textContent = 'Copy'; }, TOAST_DURATION_MS);
  });

  // Note: backdrop-click dismissal and focus trap/restore are owned by
  // kerfjs/overlay, and Escape by a bubble-phase listener — all configured in
  // `showSettingsDialog`, so they're not wired here and already work during the
  // loading phase before this runs.
}

function renderShell(visible: Tab[], activeTabId: string, ctx: TabContext): SafeHtml {
  return (
    <>
      <div className="settings-header">
        <h3>Settings</h3>
        <button className="settings-close" id="settings-close" title="Close" aria-label="Close"><IconX /></button>
      </div>

      <div className="settings-tabs">
        {visible.map(tab => (
          <button className={`settings-tab${tab.id === activeTabId ? ' active' : ''}`} data-tab={tab.id}>
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="settings-body">
        {visible.map(tab => (
          // Only the active panel renders its interactive content. Inactive
          // panels are `display:none` (so their controls aren't visible), but
          // kerfjs/overlay's focus trap detects focusables by DOM query and does
          // NOT skip `display:none` subtrees — leaving them rendered would put
          // hidden controls in the trap's tab cycle and let focus escape the
          // dialog (GB-1132). The empty panel div stays for the active-class
          // toggle; a tab switch re-runs this render, so nothing is lost.
          <div className={`settings-tab-panel${tab.id === activeTabId ? ' active' : ''}`} data-panel={tab.id}>
            {tab.id === activeTabId ? tab.render(ctx) : null}
          </div>
        ))}
      </div>
    </>
  );
}
