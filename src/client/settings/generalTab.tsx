import type { SafeHtml } from 'kerfjs';

import { IconSliders } from '../../icons.js';
import type { Tab, TabContext } from './tabContext.js';

function renderGeneralTab(ctx: TabContext): SafeHtml {
  const { themesData, activeThemeId } = ctx;
  return (
    <>
      <div className="settings-section">
        <label className="settings-label">Theme</label>
        <div className="settings-theme-row">
          <select className="settings-select" id="settings-theme">
            {themesData.themes.filter(t => t.builtIn).map(t =>
              // " (AA)" marks themes that clear WCAG AA everywhere (GB-1185).
              <option value={t.id} selected={t.id === activeThemeId}>{t.wcagAA ? `${t.name} (AA)` : t.name}</option>
            )}
            {themesData.themes.some(t => !t.builtIn) && (
              <>
                <option disabled>{'─'.repeat(20)}</option>
                {themesData.themes.filter(t => !t.builtIn).map(t =>
                  <option value={t.id} selected={t.id === activeThemeId}>{t.wcagAA ? `${t.name} (AA)` : t.name}</option>
                )}
              </>
            )}
          </select>
          <button className="btn btn-sm" id="manage-themes-btn">Manage Themes</button>
        </div>
        <p className="settings-hint">"(AA)" marks themes that meet the WCAG AA contrast standard everywhere. Other built-in themes replicate a specific palette and may have lower-contrast text.</p>
      </div>
      <div className="settings-section">
        <label className="settings-label" htmlFor="settings-code-lines">Long code lines</label>
        <select className="settings-select" id="settings-code-lines">
          <option value="wrap" selected={ctx.wrapLines}>Wrap lines</option>
          <option value="scroll" selected={!ctx.wrapLines}>Scroll horizontally</option>
        </select>
        <p className="settings-hint">Applies to all files and PRs. Wrapped lines fit the code pane without horizontal scrolling.</p>
      </div>
      <div className="settings-section">
        <a className="settings-share-link" id="settings-share-link" href="#">Know someone who'd love this? <strong>Share rev</strong></a>
      </div>
    </>
  );
}

export const generalTab: Tab = {
  id: 'general',
  label: 'General',
  icon: <IconSliders />,
  render: renderGeneralTab,
};
