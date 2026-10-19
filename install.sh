#!/usr/bin/env bash
# Install this checkout without changing global npm packages or review data.
set -euo pipefail

usage() {
  cat <<'HELP'
Usage: ./install.sh [--desktop] [--bin-dir DIR] [--app-dir DIR] [--no-auth] [--no-path]

Build rev and install its command in ~/.local/bin. On macOS, use Homebrew
for missing Node.js/npm and GitHub CLI dependencies when available.
  --desktop      Also build and install rev.app on macOS (requires Xcode tools).
  --bin-dir DIR  Command destination (default: ~/.local/bin).
  --app-dir DIR  Desktop destination (default: ~/Applications).
  --no-auth      Skip GitHub sign-in, for CI or an offline configuration step.
  --no-path      Do not add the command directory to your shell configuration.

GitHub review works without Codex. Automatic Codex replies need a separate,
compatible desktop connection; this installer does not configure that connection.
HELP
}
fail() { printf 'rev install: %s\n' "$*" >&2; exit 1; }
need_value() { [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || fail "$1 requires a directory"; }

repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
bin_dir="$HOME/.local/bin"
app_dir="$HOME/Applications"
desktop=false
auth=true
configure_path=true
while [[ $# -gt 0 ]]; do
  case "$1" in
    --desktop) desktop=true; shift ;;
    --bin-dir) need_value "$@"; bin_dir=$2; shift 2 ;;
    --app-dir) need_value "$@"; app_dir=$2; shift 2 ;;
    --no-auth) auth=false; shift ;;
    --no-path) configure_path=false; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "Unknown option: $1 (see --help)" ;;
  esac
done

platform=$(uname -s)
case "$platform" in Darwin|Linux) ;; *) fail 'Use macOS, Linux, or a Linux environment such as WSL.' ;; esac
if $desktop; then
  [[ "$platform" == Darwin ]] || fail '--desktop currently supports macOS only.'
  xcrun --find clang >/dev/null 2>&1 || fail 'Install Xcode Command Line Tools, then rerun: xcode-select --install'
  mkdir -p -- "$app_dir"
  app_dir=$(cd -- "$app_dir" && pwd -P)
  if [[ -e "$app_dir/rev.app" ]]; then
    bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app_dir/rev.app/Contents/Info.plist" 2>/dev/null || true)
    [[ "$bundle_id" == com.brianwestphal.glassbox ]] || fail "Refusing to replace an unrelated app: $app_dir/rev.app"
    while IFS= read -r process; do
      [[ "$process" != "$app_dir/rev.app/Contents/MacOS/"* ]] || fail 'Quit rev before replacing the installed desktop app.'
    done < <(ps -axo command=)
  fi
fi
command -v git >/dev/null 2>&1 || fail 'Git is required.'

# Resolve destinations before changing to the checkout, including paths with spaces.
mkdir -p -- "$bin_dir"
bin_dir=$(cd -- "$bin_dir" && pwd -P)
launcher="$bin_dir/rev"
if [[ -e "$launcher" || -L "$launcher" ]]; then
  [[ -f "$launcher" && ! -L "$launcher" ]] && grep -Fq '# rev source-install launcher' "$launcher" \
    || fail "Refusing to replace an unrelated command: $launcher. Choose another --bin-dir."
fi

has_node() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 &&
    node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 12) ? 0 : 1)' >/dev/null 2>&1
}
brew_install() {
  [[ "$platform" == Darwin ]] && command -v brew >/dev/null 2>&1 \
    || fail "$1 is required. Install it, then rerun this script (on macOS, Homebrew can install missing dependencies)."
  brew install "$2"
}
if ! has_node; then
  brew_install 'Node.js 22.12+ and npm' node@22
  export PATH="$(brew --prefix node@22)/bin:$PATH"
fi
has_node || fail 'Node.js 22.12+ and npm are required.'
if ! command -v gh >/dev/null 2>&1; then brew_install 'GitHub CLI (gh)' gh; fi
if $desktop && { ! command -v cargo >/dev/null 2>&1 || ! command -v rustc >/dev/null 2>&1; }; then
  brew_install 'Rust (cargo and rustc)' rust
fi

if $auth && ! gh auth status --hostname github.com --active >/dev/null 2>&1; then
  [[ -t 0 ]] || fail 'GitHub sign-in needs an interactive terminal. Rerun interactively, or use --no-auth and sign in later.'
  printf '\nSign in to the GitHub account you use for PR reviews.\n'
  gh auth login --hostname github.com --git-protocol https --web
fi

node_bin=$(command -v node)
gh_dir=$(dirname -- "$(command -v gh)")
cd -- "$repo_dir"
printf '\nInstalling dependencies and building rev…\n'
npm ci --include=dev

stage_dir=''
launcher_tmp=''
cleanup() {
  if [[ -n "$launcher_tmp" ]]; then rm -f -- "$launcher_tmp"; fi
  if [[ -n "$stage_dir" ]]; then
    if [[ -d "$stage_dir/previous.app" && ! -e "$app_dir/rev.app" ]]; then
      mv -- "$stage_dir/previous.app" "$app_dir/rev.app"
    fi
    rm -rf -- "$stage_dir"
  fi
}
trap cleanup EXIT
if $desktop; then
  # Local builds do not need release/updater signing keys or upstream updates.
  build_target_dir="${CARGO_TARGET_DIR:-$repo_dir/src-tauri/target}"
  mkdir -p -- "$build_target_dir"
  build_target_dir=$(cd -- "$build_target_dir" && pwd -P)
  CARGO_TARGET_DIR="$build_target_dir" npm run tauri:build -- --bundles app --config '{"bundle":{"createUpdaterArtifacts":false,"macOS":{"signingIdentity":"-"}},"plugins":{"updater":{"endpoints":[]}}}'
  built_app="$build_target_dir/release/bundle/macos/rev.app"
  [[ -d "$built_app" ]] || fail "Desktop bundle not found: $built_app"
  stage_dir=$(mktemp -d "$app_dir/.rev-install.XXXXXX")
  ditto "$built_app" "$stage_dir/rev.app"
  codesign --verify --deep --strict "$stage_dir/rev.app"
  if [[ -d "$app_dir/rev.app" ]]; then mv -- "$app_dir/rev.app" "$stage_dir/previous.app"; fi
  mv -- "$stage_dir/rev.app" "$app_dir/rev.app"
else
  npm run build
fi

# Publish the launcher only after the build succeeds; quote paths as shell words.
launcher_tmp=$(mktemp "$bin_dir/.rev-launcher.XXXXXX")
{
  printf '#!/usr/bin/env bash\n# rev source-install launcher\nset -e\n'
  printf 'export PATH=%q:"$PATH"\n' "$gh_dir:$(dirname -- "$node_bin")"
  printf 'exec %q %q "$@"\n' "$node_bin" "$repo_dir/dist/rev.js"
} > "$launcher_tmp"
chmod 755 "$launcher_tmp"
mv -f -- "$launcher_tmp" "$launcher"
launcher_tmp=''

if $configure_path; then
  profile=''
  user_shell=${SHELL:-}
  case "${user_shell##*/}:$platform" in
    zsh:*) profile="$HOME/.zshrc" ;;
    bash:Darwin) profile="$HOME/.bash_profile" ;;
    bash:*) profile="$HOME/.bashrc" ;;
  esac
  if [[ -n "$profile" ]]; then
    path_line=$(printf 'export PATH=%q:"$PATH"' "$bin_dir")
    if [[ ! -f "$profile" ]] || ! grep -Fxq -- "$path_line" "$profile"; then
      printf '\n# rev command\n%s\n' "$path_line" >> "$profile"
    fi
  fi
fi
printf '\nrev is installed. Open a new terminal and run rev, or start it now with:\n  %q\n' "$launcher"
printf 'Keep this checkout: %s\nTo update, pull the latest code and rerun this script.\n' "$repo_dir"
if $desktop; then printf 'Native app installed: %s/rev.app\n' "$app_dir"; fi
cat <<'NEXT'

GitHub review and Codex replies have different setup requirements:
  - Review PRs and publish GitHub comments after GitHub sign-in; Codex is optional.
  - Automatic replies to local code comments are NOT set up by this installer.
    They require the original Codex desktop chat on a compatible shared server.
    A chat link alone does not enable push delivery. Existing connections are unchanged.

Start rev, then run this from the Codex chat that created your own PR:
NEXT
printf '  %q open https://github.com/OWNER/REPOSITORY/pull/123\n' "$launcher"
printf '\nFor automatic replies, paste this into that same Codex chat:\n'
printf '  Read %q (Codex feedback setup) and help set up rev feedback for this PR.\n' "$repo_dir/README.md"
cat <<'NEXT'
  Check whether this desktop can share its existing chat through a private Unix
  endpoint. Preserve this chat's history, model, permissions and native tools.
  Do not start a second server for this chat. Explain any required setup/restart,
  then verify a comment is picked up and answered in rev before claiming success.
  If push is unavailable, tell me and handle feedback with rev comments, rev pickup
  and rev reply when I ask. Linking the chat and manual replies work without push.

After a Codex restart: reopen the originating chat. Automatic recovery depends on
the separate connection setup; rev does not start or configure the Codex server.
NEXT
printf 'Full setup and restart guidance: %s/README.md#codex-feedback-setup\n' "$repo_dir"

if [[ "$(uname -s)" == Darwin ]]; then
  printf '\nDesktop PR links: approve “Use rev Links” when macOS asks.\n'
  printf 'Other web links stay in your browser. Configure accounts and retry link setup in Settings → Profile.\n'
fi
