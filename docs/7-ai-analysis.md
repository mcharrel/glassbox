# 7. AI Analysis

Requirements for optional AI-powered code analysis features.

## Functional Requirements

### 7.1 General

- All AI features shall be entirely optional. The application shall be fully functional without any AI provider configured.
- AI analysis shall only make network calls to the configured AI provider's API. No other external communication shall occur.
- The system shall support five AI platforms: Anthropic (Claude), OpenAI (GPT), Google (Gemini), Local (an OpenAI-compatible local server such as Ollama or LM Studio), and Apple (on-device Foundation Models). The Local and Apple platforms are detailed in [22-local-and-on-device-models.md](22-local-and-on-device-models.md).
- Users shall be able to switch platforms and models via the settings dialog.
- **Model lists shall be discovered live from each provider's models API** when a key is configured, rather than relying solely on a hardcoded list (GB-894): Anthropic `GET /v1/models`, OpenAI `GET /v1/models` (filtered to chat models), Google `GET /v1beta/models` (filtered to `generateContent`). A curated static list (`src/ai/models.ts`) is the fallback when there is no key, the request fails, or in demo/`--ai-service-test` mode. Because the provider returns only currently-available models, retired snapshots never appear.
- Saved model IDs discovered from a provider shall be preserved even when absent from the bundled fallback catalog, including after restart or a discovery failure. Only explicitly listed legacy IDs are migrated (e.g. `claude-sonnet-4-5` → `claude-sonnet-4-6`, GB-893); an empty selection uses the platform default. An unknown ID alone is not evidence that a model is retired.

### 7.2 Risk Analysis

- The system shall analyze each file across six risk dimensions, each scored 0.0 to 1.0:
  - Security — injection, auth gaps, data exposure, insecure crypto
  - Correctness — logic errors, null handling, type safety, race conditions
  - Error handling — missing catches, unvalidated input, silent failures
  - Maintainability — complexity, coupling, unclear naming
  - Architecture — separation of concerns, API design, scalability
  - Performance — algorithmic complexity, memory management
- Files shall be ranked by their highest-risk dimension score (not averaged).
- Each file shall include a brief rationale explaining the primary risk concern.
- Each file shall include line-level notes identifying specific risky lines and their concerns.
- Risk scores shall be displayed as badges in the sidebar file list.
- Users shall be able to sort by individual risk dimensions.

### 7.3 Narrative Analysis

- The system shall determine an optimal reading order for reviewed files based on dependency structure and conceptual flow.
- The ordering shall prioritize: types/interfaces first, then utilities, then business logic, then integration code, then config/build, then tests.
- Each file shall include a rationale explaining why it belongs in its position.
- Each file shall include walkthrough notes explaining changes and connections to other files in the diff.
- In this personal fork, Reading order is the default for code reviews. From top to bottom, group ordinary source files, YAML, tests, dependency changes, and generated protobufs. Source files retain the AI reading order; other groups sort by path. Unanalysed source files follow analysed source files, ahead of lower-priority groups. Without analysis, sort source files by path. Authored `.proto` schemas remain source files; generated output is recognized by protobuf filenames, explicit generated-proto directories, or compiler headers present in the diff.
- Position numbers shall reflect the displayed file order, shared with keyboard navigation.
- Line-level walkthrough notes (GUIDE) shall appear in the bottom sidebar section only while their new-side anchor lines intersect the visible code viewport, excluding code covered by sticky headers. File-wide summaries have no line anchor and are omitted. Line references navigate to the code. Risk notes occupy the same section in Risk mode.

### 7.4 Guided Review

- The system shall generate educational annotations for users learning new languages, codebases, or programming concepts.
- Users shall be able to select learning topics: "Programming," "This codebase," and 28+ specific programming languages.
- Guided review shall run independently of risk/narrative analysis (can be active alongside either).
- When guided review is enabled, risk and narrative analyses shall also adjust their output to be more educational.
- Guided notes (LEARN) shall appear below GUIDE in the bottom sidebar section, with clickable line references. Notes update on scroll, resize, code reflow, diff replacement, selected-file changes, new analysis, and guided-review changes. Partially visible lines count; off-screen lines, old-side duplicates, loading panes, and raw files do not. These generated explanations do not interrupt the code; committed review notes and human annotations remain inline.

### 7.5 Analysis Processing

- Large reviews shall be split into token-budgeted batches to fit within model context windows.
- Token estimation shall use a character-based heuristic (approximately 3 characters per token).
- The system shall support multi-turn context loops where the AI can request full file content for more context.
- When the on-device Apple Foundation Models platform is selected, a batch it cannot process (its small context window overflowing, or any other failure) shall **fall back per-batch to the user-configured secondary model** rather than failing those files outright (see `22-local-and-on-device-models.md` §22.10).
- Analysis progress shall be tracked and displayed to the user (completed batches / total batches).
- Switching between risk and narrative modes shall cancel the other's running analysis.
- Binary files shall be excluded from AI analysis and assigned a score of 0.

### 7.6 Caching

- Analysis results shall be cached for the duration of the review session.
- Users shall be able to invalidate the cache and re-run analysis.
- If files are unchanged between analysis runs, previous scores shall be carried forward.

### 7.7 API Key Management

- API keys shall be resolved in priority order: environment variable, OS keychain, config file.
- The system shall support OS-level keychain storage: macOS Keychain, Linux GNOME Keyring/KDE Wallet (via `secret-tool`), Windows Credential Manager.
- Keys in the config file shall be base64-encoded (not plaintext).
- Users shall be able to add, remove, and view the source of configured keys via the settings dialog.
- Environment variable keys shall be detected automatically and shown as read-only.

## Non-Functional Requirements

### 7.8 Privacy

- API keys shall never leave the local machine except in direct API calls to the configured provider.
- Code diffs sent to AI providers shall be limited to the minimum context needed for analysis.

### 7.9 Resilience

- AI analysis failures shall not affect core review functionality.
- Failed analyses shall be reported to the user with an error message.
- The system shall handle AI response parsing errors gracefully (malformed JSON, unexpected schema).

AI prompt context labels each diff row with its original and new source line numbers. Supplemental full-file context also includes explicit new-side line numbers, so deletion rows and summarized gaps do not shift generated note anchors.
