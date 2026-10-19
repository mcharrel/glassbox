import { delegate, signal } from 'kerfjs';

import { type CodexSetup, getCodexChats, getCodexSetup, linkCodexChat, setCodexSetup } from '../../api/codex-connection.js';
import { isPullAuthor } from '../../api/workspace.js';
import { asInput, asSelect } from '../dom.js';
import { activeTab, refreshWorkspace } from '../workspace/state.js';

const state = signal<{ status: CodexSetup | null; busy: boolean; error: string; chats: Array<{ id: string; title: string }> }>({ status: null, busy: false, error: '', chats: [] });
let generation = 0;
let poll = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let visible = false;
export function resetCodexSettings(): void {
  generation++; poll++; visible = false; clearTimeout(timer);
  state.value = { status: null, busy: false, error: '', chats: [] };
}
async function refresh(version: number, polling: number): Promise<void> {
  try {
    const status = await getCodexSetup();
    if (version !== generation || polling !== poll || !visible) return;
    state.value = { ...state.value, status };
    if (status.state === 'connected' && state.value.chats.length === 0) {
      const { chats } = await getCodexChats();
      if (version === generation && polling === poll) state.value = { ...state.value, chats };
    }
  } catch {
    if (version === generation) state.value = { ...state.value, error: 'Could not check Codex. Reopen Settings to retry.' };
  } finally {
    if (version === generation && polling === poll && visible) timer = setTimeout(() => { void refresh(version, polling); }, 3000);
  }
}
export function showCodexSettings(show: boolean): void {
  poll++; visible = show; clearTimeout(timer);
  if (show && !state.value.busy) void refresh(generation, poll);
}
export function bindCodexSettings(root: HTMLElement): void {
  void delegate(root, 'change', '#codex-connect', (_event, el) => { void (async () => {
    if (state.value.busy) return;
    poll++; clearTimeout(timer);
    const version = generation;
    state.value = { ...state.value, busy: true, error: '' };
    try {
      const status = await setCodexSetup(asInput(el).checked);
      if (version === generation) state.value = { ...state.value, busy: false, status, chats: [] };
    } catch (error) {
      if (version === generation) state.value = { ...state.value, busy: false, error: error instanceof Error ? error.message : 'Could not configure Codex.' };
    } finally { if (version === generation && visible) showCodexSettings(true); }
  })(); });
  void delegate(root, 'change', '#codex-chat', (_event, el) => { void (async () => {
    const tab = activeTab(); const id = asSelect(el).value; const version = generation;
    if (!tab || !id || state.value.busy) return;
    state.value = { ...state.value, busy: true, error: '' };
    try { await linkCodexChat(tab.key, id); await refreshWorkspace(); }
    catch (error) { if (version === generation) state.value = { ...state.value, error: error instanceof Error ? error.message : 'Could not link that chat.' }; }
    finally { if (version === generation) state.value = { ...state.value, busy: false }; }
  })(); });
  void delegate(root, 'click', '#codex-refresh-chats', () => { state.value = { ...state.value, chats: [] }; showCodexSettings(true); });
}
export function renderCodexConnection() {
  const { status, busy, error, chats } = state.value;
  const tab = activeTab();
  return <div className="settings-section">
    <label className="settings-label settings-checkbox"><input id="codex-connect" type="checkbox" checked={status?.enabled ?? false} disabled={busy || status?.supported !== true} /> Connect to Codex</label>
    <p className="settings-hint">Let your original Codex chat handle local code comments. Enabling sets up the connection automatically; quit and reopen Codex once when prompted.</p>
    <p role="status" className="settings-hint">{busy ? 'Setting up…' : status?.message ?? 'Checking connection…'}</p>
    {error && <p role="alert" className="settings-warning">{error}</p>}
    {status?.state === 'connected' && tab !== undefined && isPullAuthor(tab) && <>
      {tab.codexThreadId !== undefined ? <p className="settings-hint">This PR is linked to its original chat. Open that chat in Codex to receive comments.</p> : <>
        <label className="settings-label" htmlFor="codex-chat">Chat for this PR</label>
        <select id="codex-chat" className="settings-select" disabled={busy}>
          <option value="" selected>Choose the chat that created this PR…</option>
          {chats.map(chat => <option value={chat.id}>{chat.title}</option>)}
        </select>
        <p className="settings-hint">Open the original chat in Codex, then <button className="btn btn-sm" id="codex-refresh-chats">Refresh chats</button></p>
      </>}
    </>}
  </div>;
}
