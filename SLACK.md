# Connect Slack to rev

Open **Settings → Slack**, choose **one connection**, and enable **React to PR reviews in Slack** when you are ready. It is disabled by default.

rev searches public and private conversations your account can access for the exact PR link after GitHub accepts your review. Approval uses `stamp-approved`; both change-request actions use `request-changes`. You can change both to emoji names available in your workspace, without the surrounding colons.

## Option 1: Slack app

Use this when you can install a Slack app or your workspace provides one.

1. Open [Slack app settings](https://api.slack.com/apps) and create or select an app.
2. Under **OAuth & Permissions → User Token Scopes**, add `search:read` and `reactions:write`.
3. Install or reinstall it in your workspace. Complete any approval your workspace requires.
4. Copy its **User OAuth Token** (`xoxp-…`). A bot token cannot search as you.
5. In rev, select **Slack app (user OAuth token)**, paste the token and save.

rev stores the token in the system keychain. It never returns it through the settings API or writes it to configuration files, exports or Git. Linux requires Secret Service and `secret-tool`; there is no plaintext fallback. **Disconnect Slack** removes the token and disables reactions.

## Option 2: Claude Code

Use this when Slack is available through Claude's approved Slack integration. You do not need to create another Slack app. Workspace administrators can still restrict or require approval for the integration.

1. Install [Claude Code](https://code.claude.com/docs/en/setup), sign in and check that a simple prompt works in your terminal. Keep your existing organization-managed login configuration.
2. Install the official Slack plugin:

   ```sh
   claude plugin install slack@claude-plugins-official
   ```

3. Connect it and finish the Slack authorization in your browser:

   ```sh
   claude mcp login plugin:slack:slack
   ```

   For a terminal that cannot open a browser, add `--no-browser` and open the displayed authorization URL yourself.

4. Run `claude mcp list`. The `plugin:slack:slack` entry should show **Connected**.
5. In rev, select **Claude Code (Slack plugin)** and save.

A connection only in Claude Desktop or claude.ai is not always available to Claude Code. The explicit plugin setup above works independently of cloud-connector import. See [Slack's Claude setup guide](https://docs.slack.dev/ai/slack-mcp-server/connect-to-claude/).

Claude retains its OAuth credentials; rev does not copy them. rev invokes your installed Claude Code with its configured model and authentication to execute narrowly constrained Slack tools. This uses your Claude plan or API usage and can be slower than a Slack app token. rev does not resume your chats, give these calls file/shell tools, or accept model text as a successful reaction. Local and organization permission policies still apply. A working Slack login alone is insufficient if Claude's model service is unreachable; connect to any network required by your existing Claude configuration first.

Switching to the Slack app option or disabling reactions in rev does not sign you out of Claude. To revoke Claude's Slack connection separately, use `claude mcp logout plugin:slack:slack`.

## Test from rev

1. Check **React to PR reviews in Slack**.
2. Set **Approval emoji** to an emoji present in the workspace.
3. In Slack, copy the link to a message where you want to try the reaction.
4. Paste it under **Test your connection** and click **Test reaction**.

This saves the selected settings and **adds a real approval reaction to that one message**. It does not post a new message or submit a GitHub review. Success appears below the field with a check and “Connection working — your reaction is on the Slack message.” An existing reaction by you also counts as success. Changing the link, connection or emoji clears the previous confirmation.

A failed test shows an error rather than a success check. Check the emoji, message access and your selected connection. After a timeout, check Slack before retrying: Slack may have accepted a reaction before its reply was lost. Adding the same reaction again is idempotent.

## Review reactions and privacy

Reactions run in the background after a successful GitHub review, without delaying it. rev searches for exact PR links, follows result pages and skips duplicate messages. Search visibility and Slack's indexing limits apply. It does not poll Slack, backfill old reviews, post new messages or remove existing reactions.

Failures appear separately from the GitHub decision with **Retry Slack**; retrying does not submit another GitHub review. Closing a tab, changing accounts or saving Slack settings cancels unfinished review reactions. Reactions already sent remain in Slack. Settings are local to this computer. Never put Slack tokens, workspace details or real message fixtures in a public issue or repository.
