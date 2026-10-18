# rev

[rev](https://github.com/mcharrel/rev) is my personal review workspace, based on upstream Glassbox 1.2.3. The fork's `main` follows upstream; the installed customizations live on `mc/local-customizations`. Upstream bug fixes can be merged or cherry-picked without giving up these preferences.

## Workspace and PR tabs

- A permanent resizable tab panel sits to the left of the mid panel. It starts at its compact minimum and shows bare PR numbers without a hashtag or status dot; expanding it shows titles. The active tab has a purple background. Unselected tab text shows draft (gray), open (green), merged (purple), and closed (red).
- Long-press and drag a tab to reorder it. Option+Tab / Option+Shift+Tab cycle PRs. Double-click an expanded title to edit the GitHub title only for my own PRs.
- The + immediately after the PR tabs opens a URL field. A GitHub PR URL may include `/files`, query parameters, or a fragment. Reopening a tracked PR selects the existing tab.
- A small `rev` link stays at the very bottom of the tab panel, below the scrolling PR list, and opens the fork's GitHub repository in the default browser.
- New own PRs appear above other people's PRs. Related stacked PRs are placed together, parent before child. Manual ordering persists.
- Each PR initially opens its Main view and remembers its last selected view. `r` switches Main and File views.
- New PRs load GitHub metadata and conversations asynchronously. Existing PRs use their cached data at startup, when switching tabs, and when reopening; every open tab refreshes metadata and conversations in the background every five minutes. Cmd/Ctrl+R refreshes the selected PR immediately, including source changes.
- Closing a tab only removes it from the tab list. Pending comments keep syncing, and reopening restores the PR.

The desktop app, native menu, loading screens, and share link use the rev name. Existing `.glassbox` data, settings, bundle identity, and `glassbox` commands remain compatible; the local `myreview` command opens the saved PR workspace.

## Shared header and Main view

- The shared header shows the GitHub title and a close-tab icon. Settings sits at the far right of the topbar (the class/function breadcrumb bar showing “Top level”). The topbar stays available in Main/File views, while loading, and for files without an outline. Only my own PR titles are editable. Editing keeps the displayed font size, and clicking away immediately restores the normal title while saving. Added lines are blue, removed lines orange; totals exclude tests and generated protos and appear above the branch names. Show the PR branch first, followed by a separate `-> <base>` line only when the target is neither `prod` nor `main`.
- Use one compact purple dropdown. Own PRs show their current Draft, Ready for Review, or Close state. Other PRs show Review with Approve, Request code change, and Make explanations more human. The last choice submits a GitHub Request changes review with exactly: “Could you make the explanations (description, in-line comments) easier to digest for a human ?” Merged PRs replace the dropdown with a green, non-clickable Merged button. GitHub merge status is picked up by the five-minute background refresh or immediately on Cmd/Ctrl+R.
- Cmd/Ctrl+R refreshes the PR. New source revisions are fetched on explicit refresh, preserving annotations through Glassbox's re-anchoring logic. Repeated shortcuts during an in-flight refresh do not queue another full refresh.
- Main content is the PR description. Click to edit; Save or Cmd/Ctrl+Enter publishes the edit. Escape/Cancel discards it.
- The mid panel contains reviewers, CI checks ordered failed/pending/succeeded, then the PR conversation with newest comments first, without visible section titles. Accessible section labels remain. Every section scrolls and its divider resizes. Merged PRs reserve the CI area for deployment details, which are intentionally undecided.
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
- Main-view comments publish to GitHub on every PR, including my own, and never go to Codex. Code comments on my own PRs stay local, including follow-ups, edits, deletes and Codex answers. Code comments on others’ PRs publish to GitHub only, with no Codex delivery or chat binding. A cloud marker indicates pending/failed GitHub synchronization; retries occur every five minutes. Stable markers reconcile ambiguous POST failures to avoid duplicate comments. Both kinds display alongside imported GitHub feedback.
- New local requests on my PRs go to the originating Codex chat when linked. Local threads support replies without GitHub IDs. The thread shows Local and Codex delivery state; private messages have no GitHub share button.
- Codex uses the original chat’s model, permissions and context, following normal verification and signed-push rules. No isolated comment agents start automatically; GUIDE/LEARN retain their own model settings.
- Main-view edits and deletes sync to GitHub; code-thread edits and deletes follow PR ownership; authorship controls prevent editing someone else’s comment. Legacy local annotations are imported without treating them as fresh Codex requests. Unknown ownership holds code-comment writes locally; Main-view comments wait only for GitHub authentication. Previously queued code-comment GitHub writes on my own PRs are canceled, without deleting already-public copies. Historical conversations already marked private remain private and are not republished by this correction. Private messages survive refresh/restart and cannot be published after changing accounts.

## Rendering fixes and contributions

- Changed and unchanged code lines share the same text alignment. Added/removed markers do not shift code indentation.
- Disable character-level change highlighting, retaining whole-line diff colors. Navigation uses an outline effect instead of replacing the red/green background.
- All contributions, including bug fixes and personal customizations, stay in `mcharrel/rev`. Do not open or update upstream contribution PRs. The earlier upstream PRs (#73–77) are closed; their fixes remain in this fork. Reading and pulling upstream updates is still allowed.

## Local data

PR tabs, cached metadata, comment queue and agent threads persist in `workspace.json` beside the active review database. Managed PR checkouts and agent worktrees live under that same local data directory. Tokens remain in GitHub CLI/OS credential storage and are never written to workspace state or repository remotes. Panel sizes and remaining-file progress are stored locally by the client.

## Workspace stability

- GUIDE and LEARN stay together in one scrolling section; only the divider above the combined section resizes it.
- All panel widths and section heights persist. Temporary hiding or limited space does not overwrite the chosen size. The title section cannot shrink below its content, including wrapped titles and action buttons.
- PR tabs switch within the same page. Files, AI guidance, loaded diff DOM, inline drafts, scroll positions, remaining-file lists, and navigation history remain in memory per PR. The first load stays asynchronous; metadata and comments refresh every five minutes without switching views or replacing the source snapshot; new commits wait for Cmd/Ctrl+R. Posting comments, edits, and review actions remains immediate, and offline comments still retry every five minutes. Explicit refresh or a changed reviewed revision invalidates the affected cached content.
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
- The native app icon uses my supplied dark rev Git-graph wordmark, preserved in `assets/app-icon.png`. Keep its existing rounded silhouette and transparency. `swift scripts/build-personal-icon.swift` crops the supplied transparent margin and scales the original artwork to 824 pixels wide, centered on a 1024-pixel transparent canvas, preserving its proportions and the established Dock size. An opaque dark rounded tile behind the translucent artwork prevents macOS from adding a pale outer frame; the canvas outside the tile remains transparent. Generate native icon sizes with `tauri icon assets/app-icon-macos.png`.

## GitHub request budget

- All open tabs, including inactive tabs and merged/closed PRs still in the tab list, refresh metadata and comments every five minutes. Removed tabs do not poll. Startup, switching tabs and reopening use the cache immediately. The local client also checks its own server for import, comment, and agent progress; those local reads never contact GitHub.
- A normal background or explicit refresh uses one GraphQL request for metadata and three REST requests for issue comments, inline comments, and submitted review bodies. More than 99 entries in a collection require extra pagination requests; first-time account identification and source fetches add work.
- At four requests per refresh, the background budget is about 48 GitHub requests per hour per open PR, plus pagination, explicit actions and retries. No background Git fetches run for cached PRs.
- New PRs and unfinished imports load immediately. Overlapping requests are coalesced; Cmd/Ctrl+R during a background read waits for one subsequent full refresh, including source changes. Failures retain cached data and retry at the next five-minute tick; closing the app stops polling.
- Comments, title/description edits, review actions, and agent pushes still contact GitHub when requested. Failed comment publication keeps its five-minute retry schedule.
- Reviewer, mergeability and merge changes are discovered within the next background refresh. Desktop notifications remain suppressed while the app is visible and focused.

## Import reliability and app zoom

- Workspace updates, adding PRs, and visibility reports do not depend on the selected review ID. An importing tab cannot block its own progress updates or prevent opening another PR. Non-JSON HTTP failures show a useful request/status message.
- Reuse matching local repositories found under Go workspaces and common source folders, validating their GitHub remotes (including SSH aliases). Optional explicit paths live in `~/.glassbox/workspace-config.json` under `repositories` keyed by `owner/repo`. Preserve the source checkout's files/index/branch and protect borrowed commits from garbage collection.
- Cold imports fetch the exact PR/base snapshots with depth 1, using GitHub's reported merge base. Do not guess with depth 100 or deepen by 1,000 commits. Completely new repositories still require downloading source snapshots; metadata and comments can display independently. Poll local import progress more frequently while an import is running; cached tabs poll GitHub only every five minutes.
- Cmd/Ctrl+= (or +) and Cmd/Ctrl+- zoom the entire desktop app, in 10% steps from 50% to 200%. Cmd/Ctrl+0 resets to 100%. The preference persists and applies to every PR; standard browser zoom remains unchanged when running outside the desktop shell.

## Workspace retention

- Automatically check on startup and hourly for PR checkouts and comment-agent worktrees inactive for 14 days. Selection, imports, edits and agent completion count as activity; local workspace polling and background GitHub metadata refresh do not. Background refresh never recreates an expired checkout.
- Remove only disposable directories created inside this review data directory’s `workspaces/` and `agents/`. Preserve the selected PR, running work, queued offline comments, dirty/untracked/ignored files, unpublished commits, user branches, locked worktrees and initialized submodules. Never delete my ordinary clones or the checkout hosting the running app.
- Shared Git providers stay while another checkout needs them; expired borrowers are removed first. Agent worktrees are unregistered with Git, without force.
- Keep PR tabs, comments, annotations, attachments and reading state. Selecting an expired PR shows loading while recreating its exact saved source revision; it does not refresh GitHub metadata or rewrite annotations. Cleanup makes no GitHub API requests.

## rev name, publication, and originating Codex chat

- Renamed the app and public repository to `rev` (formerly MyReview). Repository: https://github.com/mcharrel/rev. `main` is now the verified personal app; retain an `upstream` remote for future Glassbox updates. Legacy executable/data names stay compatible.
- Replaced the upstream README with source installation, GitHub account setup, keyboard navigation, updates and Codex integration instructions. The supplied app icon is intentionally public. Local credentials, connection files, workspace state and private PR data are excluded. Removed the inherited Hotsheet credential from the tracked tree; already-public upstream history is unchanged.
- `rev open <PR URL>` opens/selects a tab in the running app and captures `CODEX_THREAD_ID` when run from the originating Codex chat. External opens are reflected by the existing window without losing per-PR reading state. Existing chat bindings cannot be silently replaced.
- New local code comments are queued for that original chat as `new comment: ...` plus PR/source context. `[steer]` requests immediate steering. Only code comments on my own PRs route to Codex, and these conversations never publish to GitHub. Imported comments and old annotations never dispatch automatically. No new isolated comment agents are started; GUIDE/LEARN still use the model settings.
- Delivery uses an existing shared Codex app server only when explicitly enabled. The currently installed desktop session uses a private stdio server, so live forwarding is unavailable and comments remain visibly pending. No second agent is resumed as a fallback. The adapter is protocol-tested; live delivery awaits a compatible desktop connection.
- Delivery state survives restarts. Ambiguous acknowledgements require checking the original chat before manually resending. The same chat can post answers back into the original rev thread with `rev reply <URL> --comment <ID> --body-file <FILE>`. Replies are local, attributed to Codex, and preserve the existing thread appearance. Repeated identical submissions are deduplicated.
