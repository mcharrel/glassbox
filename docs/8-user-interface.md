# 8. User Interface

Requirements for the browser-based UI and user interaction patterns.

## Functional Requirements

### 8.1 Layout

- The UI shall consist of a sidebar (file list) and a main content area (diff viewer).
- The sidebar shall be resizable via drag handle.
- This personal fork hides the file-name navigation bar, sticky file-name header, and bottom diff toolbar. Their DOM nodes remain available to client hooks; they take no layout space.
- The class/function outline breadcrumb stays visible and sticky at the top of the code viewport, without a gap for the hidden file-name header.
- The sidebar shall contain: repository name, review mode, file filter, sort mode control, file list, and a separately scrollable guidance section at the bottom, with GUIDE above LEARN. The guidance section uses at most 45% of the sidebar height and disappears when empty. The Complete Review / Review History footer is hidden in this personal fork. Guidance follows visible code lines, uses the same font size as code, and retains its existing colors.
- Reveal in file manager remains available from the sidebar right-click context menu ("Reveal in Finder" on macOS, "Reveal in File Explorer" on Windows — see doc 21).

### 8.2 File Navigation

- Code reviews shall open in Reading order, using the priority groups in §7.3. Ground-truth image comparisons retain their ordered sets and hide-identical controls.
- Users shall be able to filter files by typing in the file filter input.
- Keyboard navigation shall be supported: `j`/`k` to move between files.
- Clicking a file shall load its diff in the main content area.
- When the selected file changes (via keyboard navigation, click, or any other means), the sidebar shall auto-scroll (without animation) the minimum amount needed to keep the selected file visible.
- File rows in Reading order and Risk mode shall show only the filename; the full path remains in the hover title for disambiguation.
- The sidebar shall display annotation count badges per file.
- Beside the annotation count, a number-only badge shows the number of distinct text change blocks, using the same grouping as change navigation. Adjacent removals and additions count together; context and hunk boundaries separate blocks. Files with no known text changes omit the badge.
- The sidebar shall display stale annotation count indicators per file.

### 8.3 Sort Modes

- The sidebar shall support three sort modes via a segmented control:
  - Folder — alphabetical tree view
  - Risk — sorted by AI risk score (highest first) with score badges
  - Narrative (Reading order) — default; priority groups with source files sorted by AI reading order and position numbers
- Explicitly switching to an AI sort mode without a configured API key shall prompt the settings dialog. Initial Reading order remains usable without AI, using alphabetical source order within the priority groups.

### 8.4 Progress Tracking

- A progress bar shall show the proportion of files marked as "reviewed."
- A summary shall display "X of Y files reviewed, Z annotations."

### 8.5 Settings Dialog

- A settings dialog shall be accessible via a gear icon in the sidebar header.
- The dialog shall be closeable at any time via the close button, clicking outside, or pressing Escape.
- All settings shall save automatically when changed (no Save/Cancel buttons).
- The settings dialog shall use a tabbed interface with icon-and-label tabs:
  - **General** — Theme selection, app name (Tauri desktop app only), git-difftool register/unregister (doc 19)
  - **Profile** — Experience level and language familiarity (for AI-tailored explanations)
  - **Experimental** — AI configuration and guided review toggle
  - **Plugins** — Content-plugin management (doc 29): installed list, enable/disable, preferences, opt-in installs
  - **Updates** — Software update checks (Tauri desktop app only; tab hidden in browser)
- The General tab shall include:
  - Theme selection dropdown and "Manage Themes" button (see `15-themes.md`)
- When running in the Tauri desktop app, the General tab shall additionally include:
  - Custom app name input (auto-saved on change, debounced)
- The Profile tab shall include:
  - "I'm new to..." topic tags: Programming, This codebase
  - "I'm new to these languages" language tags with "More languages..." toggle
  - Topic changes saved immediately / debounced for rapid changes
- The Experimental tab shall include:
  - AI platform selection (segmented control, saved immediately on switch)
  - Model selection (dropdown per platform, saved immediately on change)
  - API key management (add with inline "Save Key" button, view source, remove)
  - Guided review toggle (saved immediately)
- When running in the Tauri desktop app, the Updates tab shall include:
  - "Check for Updates" button with status display

### 8.6 Keyboard Shortcuts

- Cmd/Ctrl+= and Cmd/Ctrl+- zoom the entire desktop interface in 10% steps, bounded to 50–200%; Cmd/Ctrl+0 resets to 100%. Persist the setting across launches and deduplicate native/key delivery. Browser mode retains browser zoom.

- `Enter` or `Cmd/Ctrl+Enter` shall save the current annotation form; Shift+Enter inserts a newline.
- `Escape` shall close modals and annotation forms.
- `j`/`k` shall navigate between files in the sidebar.
- `Tab` / `Shift+Tab` shall reveal the next / previous change not yet fully visible in that direction, using the code viewport below sticky headers. Fully visible changes are skipped. Jumps show ideally five lines of context before the change (after it when moving backward), reduced when needed to fit the whole change. Changes taller than the viewport are read a page at a time with ten lines of overlap; very small windows reduce overlap enough to keep advancing. After the final page, navigation continues to the next / previous file in the complete Reading order, including previously hidden files when going backward, stopping at the ends of the review. It waits for the destination to render; repeated Tab presses during loading do not skip files. Files without changed blocks are visited once. Geometry is remeasured after manual scrolling, resizing, or changing diff mode. Inputs, editable content, and visible dialogs retain normal Tab behavior; modified Tab shortcuts are untouched.
- `Cmd/Ctrl+F` shall toggle focus between the review search bar and code while preserving matches. Desktop menu and keyboard events are deduplicated; a failed native listener cannot disable the shortcut.
- `Cmd+Click` (macOS) / `Ctrl+Click` (Windows/Linux) on a symbol in the diff shall navigate to its definition — same file (scrolls) or different file in the review (switches file and scrolls). Uses the existing regex-based outline parser to build a cross-file symbol index.

### 8.7 Completion Modal

- Clicking "Complete Review" shall complete the review immediately — no confirmation step — **unless stale annotations exist**, in which case a gating prompt offers Cancel / Discard All Stale / Keep All & Complete first (doc 1 §1.3).
- After completion, the modal shall show the export summary: the export path, the copyable AI-tool command hint, and — when the Claude channel is connected (doc 17) — a "Send to Claude" action. A Reopen control replaces Complete in the toolbar.
- (The earlier post-completion offer to add `.glassbox/` to `.gitignore` was replaced by automatic management at launch — doc 27.)

## Non-Functional Requirements

### 8.8 Rendering

- Pages shall be server-rendered HTML with client-side JavaScript for interactivity.
- The kerfjs JSX runtime (returning `SafeHtml`) shall be used for all HTML generation, both server-side and client-side. Client-side reactivity (re-renders, event delegation) is also kerfjs-driven (`mount()`, `delegate()`, `signal()`, `defineStore`).
- Client-side DOM elements shall be created via `toElement()`, never `document.createElement()`.
- All string content shall be auto-escaped to prevent XSS. Pre-escaped HTML shall use `raw()`.

### 8.9 Responsiveness

- The UI shall support light and dark color schemes via the theme system (see `15-themes.md`).
- The layout shall function at minimum window dimensions of 800x500 pixels.

Personal fork: drag the divider above sidebar guidance to resize its height, or focus it and use Up/Down. The height persists locally and is clamped on window resize to preserve file-list space. Empty guidance hides the divider. GUIDE/LEARN title badges are omitted; their text and order remain.

The personal fork adds a PR tab rail, a Main view with description/reviewers/checks/conversation, and a File view. `r` changes views; `f`/`g` mirror change navigation; `c`/`v` skip fully visible comment threads and show ten preceding source lines below sticky chrome. Replies count toward thread visibility; oversized threads page with ten lines of overlap. Cross-file navigation waits for rendering and targets the first/last thread in reading order. Shared header actions operate on GitHub. See [MY_GLASSBOX.md](../MY_GLASSBOX.md) for the full workspace specification.

The personal workspace retains loaded reviews and rendered files in memory across PR tab switches, without page navigation or refetching unchanged data. Divider preferences survive both switches and hidden sections; header resizing respects the full content height. GUIDE and LEARN share one scroll area without an internal divider.

The compact PR rail's minimum follows the rendered ID text plus small padding, without a hashtag or status dot. A second Cmd/Ctrl+F returns focus to the file without closing search or resetting the match. A pending PR import clears the previous session and hides file content, file names, and guidance until the selected PR's own file list loads; an explicit indicator is shown in File view. Cold file loads also replace the previous diff with an indicator. Failed file lists offer Retry without discarding other cached PR sessions.

Personal workflow polish: place + directly after the PR tabs; use thin dividers that widen on hover/focus. Only own PR titles can be edited, with the same font and immediate exit on blur. Show “You reviewed all the files 👍” after every file is hidden by review navigation. Desktop notifications are suppressed while any Glassbox client is visible and focused.

Personal GitHub synchronization refreshes every open PR tab in the background every five minutes. Cached startup and tab switches remain immediate without fetching on selection. New/unfinished imports load immediately, and Cmd/Ctrl+R refreshes the selected PR including its source; background reads preserve the current source snapshot. Overlapping refreshes are coalesced. Explicit edits/actions and queued comments still publish, with offline retries every five minutes. The client's local-server progress polling remains active. Status notifications retain focus suppression.

The shared PR header places line totals above the PR branch and adds a second `-> <base>` line only for targets other than `prod`/`main`. Use a compact purple dropdown: own Draft/Ready for Review/Close status; other PRs show Review with Approve, Request code change, and Make explanations more human. The last option posts the exact explanation request documented in MY_GLASSBOX.md as a GitHub Request changes review. Workspace progress and opening additional PRs remain available while the current import has no review ID.

Settings stays at the right of the persistent topbar. Share sits immediately to the left of Close on the right of the PR title section in both Main and File views, including while files load. It copies the selected PR’s GitHub link and displays “Link copied to clipboard” in a simple toast after a successful copy.

GitHub descriptions and comments use GitHub-rendered HTML from the existing metadata/comment requests, with a sanitized local GitHub-flavored Markdown fallback for cached or pending content. Tables, task lists, nested lists, fenced code, images and expandable bot reports render as content. Raw Markdown remains the editing/publishing source, and edits invalidate stale rendered HTML. Links and disclosure toggles do not start editing; local polling preserves expanded reports. Search indexes displayed comment text and opens collapsed reports when navigating to a match. This adds no GitHub requests and preserves comment fonts/colors.

Merged PRs replace CI checks with separate service groups, each with one row per datacenter from the locally configured deployment source. Services sort by name. Within each service, datacenters sort staging, production, then federal (including federal staging), with unclassified datacenters last. Fully reached datacenters sort first within each tier. Namespace/environment targets are aggregated only within the same service and datacenter; mixed statuses are marked partial, with details on hover. Deploying, missing and unknown states remain distinct. Suggested services are queried automatically in one follow-up request. Status loads independently of PR content, is cached locally, refreshes every five minutes and on Cmd/Ctrl+R, and is canceled when a tab closes. Failed refreshes retain clearly marked last-known results; unavailable or empty reports never mean “not reached”.

Settings → **My company → Deployments** selects a local shell command or an HTTP GET endpoint and an explicit list of GitHub organizations. Tracking is disabled by default. Saving settings cancels old requests, clears old deployment results and refreshes matching merged tabs without blocking the settings dialog. Commands, endpoints and optional Authorization headers live only in the user's global config (`~/.glassbox/config.json`, mode 0600), never in project settings, review exports or the public repository. No company-specific provider configuration ships with the app.
