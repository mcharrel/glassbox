# My Glassbox

This is my personal review workspace, based on upstream Glassbox 1.2.3. The fork's `main` follows upstream; the installed customizations live on `mc/local-customizations`. Upstream bug fixes can be merged or cherry-picked without giving up these preferences.

## Workspace and PR tabs

- A permanent resizable tab panel sits to the left of the mid panel. It starts at 100 px and shows PR numbers; expanding it shows titles. The active tab has a purple background. Status dots show draft (gray), open (green), merged (purple), and closed (red).
- Long-press and drag a tab to reorder it. Option+Tab / Option+Shift+Tab cycle PRs. Double-click an expanded title to edit the GitHub title.
- The bottom + opens a URL field. A GitHub PR URL may include `/files`, query parameters, or a fragment. Reopening a tracked PR selects the existing tab.
- New own PRs appear above other people's PRs. Related stacked PRs are placed together, parent before child. Manual ordering persists.
- Each PR initially opens its Main view and remembers its last selected view. `r` switches Main and File views.
- GitHub metadata and conversations load in the background; all tracked PRs sync every ten seconds. Cached content is available before the network completes.
- Closing a tab, including “This is AI slop,” only removes it from the tab list. Pending comments keep syncing, and reopening restores the PR.

## Shared header and Main view

- The shared header shows the editable GitHub title, Settings, and a close-tab icon. Branches appear as `base ← head`. Added lines are blue, removed lines orange; totals exclude tests and generated protos.
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
- Reading order is fixed: ordinary source files using Glassbox's AI narrative order, YAML, tests, dependency changes, generated protos. This is most important first, least important last.
- Tab / Shift+Tab and `f` / `g` advance/backtrack through changes that are not fully visible. Show ideally five lines of preceding context. Page through oversized changes with ten lines of overlap, then continue to the next file.
- Advancing out of a file hides it from the remaining-file list. Reverse navigation reveals it again. Reaching the end can leave the list empty without losing the traversal history.
- Shift+G goes to the bottom. The old `gg` shortcut is removed.
- `c` / `v` move to the next / previous comment thread that is not fully visible (Shift+C also goes backward), including replies. Show ten preceding source lines below the sticky breadcrumb, counting wrapped lines correctly; use the available context near the file start or in a small window. Page through long threads with ten lines of overlap. Across files, wait for the destination to render and reveal the first / last thread with the same context.
- Cmd/Ctrl+S copies a GitHub link for the source line or filename under the pointer.

## Search and definitions

- Cmd/Ctrl+F searches all files in the PR and their comments, including GitHub conversations and AI thread replies. Matches in the current view are highlighted. `n` advances; `m` or Shift+N goes backward.
- One Escape closes search and clears highlights, even with the search field focused. It consumes the key so fullscreen remains active.
- Cmd/Ctrl+click navigates to a definition and searches the symbol name, highlighting occurrences for subsequent navigation. Local variables are resolved in their enclosing scope before the repository lookup.
- Identifier extraction reads across highlight spans, including one-letter identifiers. The repository definition scan allows up to 50,000 tracked files, with raw-file fallback and correct navigation history.

## Guidance

- GUIDE appears above LEARN at the bottom of the mid panel, outside the code. Hide their title badges and the Complete Review / Review History section.
- Show only notes anchored to lines currently visible in the code viewport. Guidance uses the code font size and retains its original colors.
- The divider above guidance controls its height and remembers it. The divider between GUIDE and LEARN also resizes their individual scrolling areas.
- AI context now carries explicit old/new source line numbers, including shortened hunks and supplemental files, instead of requiring the model to count diff rows. Existing cached guidance must be regenerated to use this improvement.

## Comments and background agents

- Click a line to open its comment box; clicking that same line again closes it. Enter or Cmd/Ctrl+Enter saves; Shift+Enter inserts a newline.
- Comments use the code font and size, with the purple selected-control background. Click an editable comment's body to edit it. Hide category, Attach file, Edit, and drag controls. Delete remains; Share copies the GitHub comment link once published.
- New comments are saved locally, queued for GitHub, and displayed alongside other people's GitHub comments and replies. A cloud marker indicates pending/failed synchronization; retries occur every five minutes. Stable markers reconcile ambiguous POST failures to avoid duplicate comments.
- A new comment starts an isolated local agent job using the provider/model selected for guidance. The thread shows queued/working/result/error states and supports retrying a failed job. Jobs on the same PR run sequentially.
- Agents can inspect tracked source and apply exact edits in a separate local checkout. They do not change the reviewed checkout or push code automatically. Their reply identifies the resulting checkout and validation performed. Project test commands are not currently executed by these jobs.
- Ordinary comment edits and deletes sync to GitHub; authorship controls prevent editing someone else's comment. Legacy local comments are imported when their review is connected to a PR, without rerunning their already-existing feedback as new agent jobs.

## Rendering fixes and contributions

- Changed and unchanged code lines share the same text alignment. Added/removed markers do not shift code indentation.
- Disable character-level change highlighting, retaining whole-line diff colors. Navigation uses an outline effect instead of replacing the red/green background.
- Bugs are contributed upstream autonomously; personal layout and workflow choices stay in this fork. Upstream contributions include definition lookup across search highlights, stable line alignment/highlighting, and explicit AI line anchors.

## Local data

PR tabs, cached metadata, comment queue and agent threads persist in `workspace.json` beside the active review database. Managed PR checkouts and agent worktrees live under that same local data directory. Tokens remain in GitHub CLI/OS credential storage and are never written to workspace state or repository remotes. Panel sizes and remaining-file progress are stored locally by the client.
