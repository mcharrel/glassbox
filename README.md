# rev

**rev** (formerly MyReview) is a local GitHub pull-request review app, built on [Glassbox](https://github.com/brianwestphal/glassbox). Keep several PRs open, read full-file unified diffs, navigate with the keyboard, and post comments to GitHub without leaving the app.

The `main` branch contains the current personal app, including its Git-graph icon. Legacy `glassbox` commands and data directories remain compatible. This fork is not the upstream `glassbox` npm package.

## Install from source

Clone and run the installer:

```sh
git clone https://github.com/mcharrel/rev.git && ./rev/install.sh
```

The script installs dependencies, builds rev, sets up `~/.local/bin/rev`, and guides you through GitHub sign-in if needed. It adds the command directory to your Bash/Zsh configuration. No `sudo` or global npm installation is needed.

You need Git to clone the repository. On macOS, the script uses an existing [Homebrew](https://brew.sh/) installation to install missing Node.js/npm and GitHub CLI dependencies. On Linux, or without Homebrew, install Node.js 22.12+, npm and [GitHub CLI](https://cli.github.com/) first; the installer checks these before building.

Start rev from a new terminal with `rev`, or run `~/.local/bin/rev` immediately. This starts the local app in your browser at `http://localhost:4183`. Use `rev serve --no-open` to run without opening a browser. The server binds only to your computer.

Keep the cloned directory: the command runs the build from that checkout. Rerunning the installer rebuilds it without changing review data or GitHub credentials. It refuses to overwrite an unrelated existing `rev` launcher; use `--bin-dir /another/directory` if needed. Run `./rev/install.sh --help` for the options, including `--no-auth` and `--no-path` for unattended installs.

Open a PR from another terminal or paste its URL into the app's **+** tab:

```sh
rev open https://github.com/OWNER/REPOSITORY/pull/123
```

Trailing GitHub URL fragments and query parameters are accepted. Opening a PR reuses the running app; source downloads and GitHub metadata load in the background. Review state and the comment outbox persist locally.

### Optional macOS desktop build

Add `--desktop` to also build and install the native app into `~/Applications/rev.app`:

```sh
./rev/install.sh --desktop
```

This requires Xcode Command Line Tools; the script installs missing Rust through Homebrew when available. The first native build takes longer. Quit an existing rev desktop app before replacing it. `--app-dir /another/directory` changes the destination.

The native bundle includes Node and uses local ad-hoc signing, so no release signing keys are required. Upstream automatic updates are disabled for this source build; rerun the installer to update. The `rev` command continues to provide the standalone browser workspace; legacy native `glassbox` launchers remain available in the app bundle.

### GitHub accounts

rev uses `gh` credentials; never put tokens in this repository. For multiple accounts, create `~/.glassbox/workspace-config.json` locally:

```json
{
  "accounts": {
    "OWNER/REPOSITORY": "your-github-login"
  },
  "repositories": {
    "OWNER/REPOSITORY": "/path/to/your/local/checkout"
  }
}
```

Existing local checkouts can speed up first imports. Every open PR tab refreshes GitHub status, reviewers, CI checks, description and comments in the background every five minutes. **Cmd/Ctrl+R** refreshes immediately and loads new source revisions; background refresh keeps the code snapshot stable while you read. Main-view comments publish to GitHub on every PR. Code comments on your own PRs stay local; code comments on other people’s PRs publish to GitHub. Offline writes retry every five minutes. Disposable managed checkouts expire after two weeks without use or updates, with unpublished work preserved.

### GUIDE and LEARN

Choose a provider and model in Settings to generate review guidance. API keys belong in local settings or the OS keychain, never in Git. GUIDE and LEARN follow the visible code. Press **a**, then **i** to replace guidance with a fresh review (at most once per five minutes per PR).

## Codex workflow

After creating a draft PR, run this **inside the Codex chat that created it**:

```sh
rev open https://github.com/OWNER/REPOSITORY/pull/123
```

Codex supplies `CODEX_THREAD_ID`, so rev links your own PR to that original chat once ownership is known. Other people’s PRs are opened without a Codex binding. Opening it from a normal terminal still works, without linking a chat. An existing link cannot silently be replaced by another chat. Add the command to your personal agent instructions to make draft-PR opening automatic.

**Main-view comments publish to GitHub on every PR**, including your own, and never go to Codex. Their edits and deletes sync with GitHub too. On **your own PRs**, comments on code, their follow-ups, edits, deletes, and Codex replies stay **local to rev**. Linked comments are saved as `new comment: …`, with the PR URL and source location. Ordinary comments use the original chat's queue; a leading `[steer]` requests immediate steering of its active turn. On **other people’s PRs**, your code comments also publish to **GitHub only**, without Codex watching or answering them. Code comments wait until ownership is known; Main-view comments only need GitHub authentication. A private comment can never become public through a refresh, retry, or account change. Imported GitHub comments and old annotations do not trigger Codex; existing published comments remain on GitHub. rev never starts a separate comment agent.

**Current limitation:** delivery requires a Codex installation whose desktop chat is connected to an existing shared app server exposing `thread/queue/add`, `thread/queue/start`, and `turn/steer`. A desktop session running its private stdio server cannot receive these messages from rev. Linking/opening still works, but comments stay visibly pending. This is not a substitute for the originating chat, and rev never resumes a second process against the same history.

Only for a compatible shared-server setup, launch rev with `REV_CODEX_SHARED_SERVER=1` and a current `codex` on `PATH` (or set `REV_CODEX_BIN`). It connects through `codex app-server proxy`; it does not start a daemon. The chat's existing model and permissions remain in effect. If delivery is interrupted, rev asks you to check the chat before resending to avoid duplicate work. After handling a comment, the same Codex chat posts its answer back into the original rev thread:

```sh
rev reply https://github.com/OWNER/REPOSITORY/pull/123 --comment COMMENT_ID --body-file reply.txt
```

The incoming message includes the comment ID and reply instruction. Replies appear as **Codex** underneath that comment, with the same formatting as earlier agent responses. They are local rev replies, not additional GitHub posts. The command requires the original `CODEX_THREAD_ID`; it never changes models or starts another chat. This return path works even when automatic incoming delivery is unavailable.

## Keyboard navigation

| Shortcut | Action |
| --- | --- |
| `r` | Switch Main / File views |
| Tab / `f` | Next change not fully visible; continue to the next file |
| Shift+Tab / `g` | Previous change |
| `c` / `v` | Next / previous comment with source context |
| Cmd/Ctrl+F | Toggle search focus while keeping matches |
| `n` / `m` | Next / previous match across files and comments |
| Escape | Close search without leaving fullscreen |
| Shift+G | Bottom of the file |
| Option+Tab | Next PR |
| Enter / Shift+Enter | Save comment / insert newline |
| Cmd/Ctrl+S | Copy GitHub link for the hovered line or file |
| Cmd/Ctrl+R | Refresh the current PR |
| Cmd/Ctrl+= / − / 0 | Zoom in / out / reset |

Panel sizes and per-PR reading positions are remembered. Source files come first, followed by YAML, tests, dependencies, and generated protos. [MY_GLASSBOX.md](MY_GLASSBOX.md) records the full customization history.

## Update and develop

```sh
cd rev
git pull --ff-only && ./install.sh
```

Repeat `--desktop` if you also want to rebuild the native app. Restart the app after updating. To incorporate upstream changes, fetch the original project into an `upstream` remote and merge on a separate branch before updating `main`; personal changes do not prevent future upstream updates.

Run `npm test -- --maxWorkers=4`, `npm run lint`, and `npm run typecheck` before publishing changes. Never commit `.env`, review databases, local workspace mappings, Codex connection files, API tokens, or private PR content. The inherited Glassbox architecture documentation remains under [docs/](docs/).

MIT licensed. Original Glassbox by Brian Westphal; this fork retains its attribution and license.
