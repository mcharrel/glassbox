# My Glassbox

This is my personal review workspace, based on upstream Glassbox 1.2.3. The fork's `main` follows upstream; the installed customizations live on `mc/local-customizations`. Upstream bug fixes can be merged or cherry-picked without giving up these preferences.

## Workspace and PR tabs

- A permanent resizable tab panel sits to the left of the mid panel. It starts at its compact minimum and shows bare PR numbers without a hashtag or status dot; expanding it shows titles. The active tab has a purple background. Unselected tab text shows draft (gray), open (green), merged (purple), and closed (red).
- Long-press and drag a tab to reorder it. Option+Tab / Option+Shift+Tab cycle PRs. Double-click an expanded title to edit the GitHub title only for my own PRs.
- The + immediately after the PR tabs opens a URL field. A GitHub PR URL may include `/files`, query parameters, or a fragment. Reopening a tracked PR selects the existing tab.
- New own PRs appear above other people's PRs. Related stacked PRs are placed together, parent before child. Manual ordering persists.
- Each PR initially opens its Main view and remembers its last selected view. `r` switches Main and File views.
- GitHub metadata and conversations load in the background; all tracked PRs sync every ten seconds. Cached content is available before the network completes.
- Closing a tab, including “This is AI slop,” only removes it from the tab list. Pending comments keep syncing, and reopening restores the PR.

## Shared header and Main view

- The shared header shows the GitHub title, Settings, and a close-tab icon. Only my own PR titles are editable. Editing keeps the displayed font size, and clicking away immediately restores the normal title while saving. Branches appear as `base ← head`. Added lines are blue, removed lines orange; totals exclude tests and generated protos.
- Own PR actions: Draft, Ready for Review, Close. Other PR actions: Approve, Request Changes, This is AI slop. The last action only closes the tab. Merged PRs show one disabled selected Merged button.
- Cmd/Ctrl+R refreshes the PR. New source revisions are fetched on explicit refresh, preserving annotations through Glassbox's re-anchoring logic. Background metadata updates do not move the code underneath a review.
- Main content is the PR description. Click to edit; Save or Cmd/Ctrl+Enter publishes the edit. Escape/Cancel discards it.
- The mid panel contains reviewers, CI checks ordered failed/pending/succeeded, then the PR conversation with newest comments first. Every section scrolls and its divider resizes. Merged PRs replace CI with the Deployment section; deployment details are intentionally undecided.
- Reviewer names open Slack where a local mapping exists. The local mapping was imported from Doggo; company directory data and account mappings stay outside this repository in `~/.glassbox/workspace-config.json`.
- Desktop notifications report reviewer-state changes, readiness to merge, and merging. Initial loading does not generate notifications.

## Reading files

- Unified view is the default. Show full file context, without folding. Keep only the new line-number column in unified view.
- Hide both file-name bars and the bottom toolbar. Keep the sticky class/function breadcrumb.
- The mid-panel file list shows basenames, with paths on hover and no position numbers. No Filter files field or sorting buttons.
- Beside each filename, a diff-icon badge counts distinct change blocks alongside the comment count. Adjacent additions/removals form one block; unchanged lines separate blocks, just as in change navigation. No badge appears for files without text changes.
- Reading order is fixed: ordinary source files using Glassbox's AI narrative order, YAML, tests, dependency changes, generated protos. This is most important first, least important last.
- Tab / Shift+Tab and `f` / `g` advance/backtrack through changes that are not fully visible. Show ideally five lines of preceding context. Page through oversized changes with ten lines of overlap, then continue to the next file.
- Advancing out of a file hides it from the remaining-file list. Reverse navigation reveals it again. Reaching the end can leave the list empty without losing the traversal history.
- Shift+G goes to the bottom. The old `gg` shortcut is removed.
- `c` / `v` move to the next / previous comment thread that is not fully visible (Shift+C also goes backward), including replies. Show ten preceding source lines below the sticky breadcrumb, counting wrapped lines correctly; use the available context near the file start or in a small window. Page through long threads with ten lines of overlap. Across files, wait for the destination to render and reveal the first / last thread with the same context.
- Cmd/Ctrl+S copies a GitHub link for the source line or filename under the pointer.

## Search and definitions

- Cmd/Ctrl+F focuses search; pressing it again returns focus to the file while retaining the query, highlights, and current match, so `n` works immediately. Search covers all files in the PR and their comments, including GitHub conversations and AI thread replies. Matches in the current view are highlighted. `n` advances; `m` or Shift+N goes backward.
- One Escape closes search and clears highlights, even with the search field focused. It consumes the key so fullscreen remains active.
- Cmd/Ctrl+click navigates to a definition and searches the symbol name, highlighting occurrences for subsequent navigation. Local variables are resolved in their enclosing scope before the repository lookup.
- Identifier extraction reads across highlight spans, including one-letter identifiers. The repository definition scan allows up to 50,000 tracked files, with raw-file fallback and correct navigation history.

## Guidance

- GUIDE appears above LEARN at the bottom of the mid panel, outside the code. Hide their title badges and the Complete Review / Review History section.
- Show only notes anchored to lines currently visible in the code viewport. Guidance uses the code font size and retains its original colors.
- The divider above guidance controls its height and remembers it. GUIDE and LEARN stay together without an internal divider.
- AI context now carries explicit old/new source line numbers, including shortened hunks and supplemental files, instead of requiring the model to count diff rows. Existing cached guidance must be regenerated to use this improvement.

## Comments and background agents

- Click a line to open its comment box; clicking that same line again closes it. Enter or Cmd/Ctrl+Enter saves; Shift+Enter inserts a newline.
- Comments use the code font and size, with the purple selected-control background. Click an editable comment's body to edit it. Hide category, Attach file, Edit, and drag controls. Delete remains; Share copies the GitHub comment link once published.
- New comments are saved locally, queued for GitHub, and displayed alongside other people's GitHub comments and replies. A cloud marker indicates pending/failed synchronization; retries occur every five minutes. Stable markers reconcile ambiguous POST failures to avoid duplicate comments.
- A new comment starts an isolated agent job using the provider/model and reasoning effort selected for guidance. The thread shows queued/working/result/error states and supports retrying a failed job. Jobs on the same PR run sequentially.
- Agents can inspect tracked source and apply exact edits in a separate local checkout. Settings offer Read only, Local edits, and Signed commit & push (the default). Push jobs start from the current PR head, format touched Go files, check whitespace, sign with the configured Git signer, verify the signature, and push without force. If signing fails or the PR advances, preserve the work locally and explain the blocker. They never modify the checkout being reviewed. Project test commands are not currently executed by these jobs.
- Ordinary comment edits and deletes sync to GitHub; authorship controls prevent editing someone else's comment. Legacy local comments are imported when their review is connected to a PR, without rerunning their already-existing feedback as new agent jobs.

## Rendering fixes and contributions

- Changed and unchanged code lines share the same text alignment. Added/removed markers do not shift code indentation.
- Disable character-level change highlighting, retaining whole-line diff colors. Navigation uses an outline effect instead of replacing the red/green background.
- All contributions, including bug fixes and personal customizations, stay in `mcharrel/glassbox`. Do not open or update upstream contribution PRs. The earlier upstream PRs (#73–77) are closed; their fixes remain in this fork. Reading and pulling upstream updates is still allowed.

## Local data

PR tabs, cached metadata, comment queue and agent threads persist in `workspace.json` beside the active review database. Managed PR checkouts and agent worktrees live under that same local data directory. Tokens remain in GitHub CLI/OS credential storage and are never written to workspace state or repository remotes. Panel sizes and remaining-file progress are stored locally by the client.

## Workspace stability

- GUIDE and LEARN stay together in one scrolling section; only the divider above the combined section resizes it.
- All panel widths and section heights persist. Temporary hiding or limited space does not overwrite the chosen size. The title section cannot shrink below its content, including wrapped titles and action buttons.
- PR tabs switch within the same page. Files, AI guidance, loaded diff DOM, inline drafts, scroll positions, remaining-file lists, and navigation history remain in memory per PR. The first load stays asynchronous; background GitHub synchronization continues. Explicit refresh or a changed reviewed revision invalidates the affected cached content.
- Remote inline comments appear only at a valid current source line, including old-side coordinates on unified context lines. Threads without a matching current line are hidden, with no fallback at the file top.

## Loading and input fixes

- The PR tab rail shrinks to the width of the longest compact PR ID, with small padding around it. Longer IDs increase that minimum so they remain readable.
- Newly opened PRs show a pending indicator until their own file list is available. Their file view, file names, and GUIDE/LEARN never display the previous PR. A cold file also shows a loading indicator instead of the previous file. Failed file-list loads offer Retry.
- Model selections discovered from the provider, including `gpt-5.5-pro`, persist across settings opens and app restarts. The fallback model catalog no longer silently substitutes GPT-4o. GPT-5.5, GPT-5.5 Pro, and their dated snapshots use the Responses API for analysis, with response storage disabled. Both model fixes remain in this fork.

## Review workflow polish

- Change-block counts show only the number, without a diff icon. When navigation has hidden every file, show “You reviewed all the files, congrats!”; empty or loading reviews do not count as finished.
- Dividers are one pixel normally and widen on hover/focus without moving the panels.
- Cmd/Ctrl+F works through both the desktop menu and a keyboard fallback; duplicate native/key events toggle only once. Repeated presses keep the query while moving focus between search and code.
- AI settings persist reasoning effort and agent access. GPT-5.5 offers Default, None, Low, Medium, High, and Extra high; Pro offers Default, Medium, High, and Extra high. Unsupported models retain their provider default.
- Agent replies contain two or three plain sentences about the result, with a commit link after a successful push. No incremental narration or long diff summary.
- Press `a` then `i` within 1.2 seconds to replace GUIDE/LEARN with a fresh review. It bypasses cached analysis, keeps human comments, and is limited to once per five minutes per PR, including after a restart. LEARN runs when enabled. Stale requests cannot restore discarded guidance.
- Import source code and remote comments independently. Reuse existing Git objects and negotiate missing objects through an existing repository, instead of downloading another shallow copy for every PR. First-time repository downloads still depend on repository size and the network.
- Suppress desktop notifications while a Glassbox window is visible and focused. Background windows still notify for reviewer/mergeability/merge changes.
- The native app icon uses my supplied purple portrait, preserved in `assets/app-icon.png`.
