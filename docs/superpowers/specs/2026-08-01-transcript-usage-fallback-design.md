# Transcript Usage Fallback Design

## Goal

Update context usage after every completed model turn for official and non-official models, even when the Claude Code webview does not propagate a positive `usageData.totalTokens` value in real time.

The existing percentage display and user-configurable context window remain unchanged. Unknown models continue to use the existing `200000`-token default unless the user supplies a custom value or the session exposes a better value.

## Findings

Claude Todos uses `SessionStart` and `UserPromptSubmit` hooks only to associate a Claude session ID with a working directory. It does not obtain token usage from hook input. Its VS Code extension watches Claude Code transcript files under `~/.claude/projects`, then reads `message.usage` from assistant records after the transcript changes.

The current non-official model session already writes valid usage into its transcript while the live webview store continues assigning zero values. Reloading VS Code reconstructs session state from that transcript, which explains why the chip becomes correct only after reload.

## Architecture

Keep two complementary data paths:

1. **Native fast path:** retain the existing `usageData.value` interceptor. Official APIs and any compatible non-official API continue to update immediately through Claude Code's normal UI state.
2. **Transcript fallback:** after a turn finishes, read the active session transcript through the session connection's existing `exec` RPC. If the transcript contains a newer valid assistant usage record, write its calculated token count back into `usageData.value`.

The fallback is session-local and does not install new Claude hooks, depend on Claude Todos, modify Claude settings, or patch Claude Code's minified message-processing methods.

## Session and transcript resolution

The injected chip reads these existing session signals:

- `sessionId.value` for the active Claude session ID.
- `cwd.value` for the session working directory, including worktree sessions.
- `connection.value.exec` for host-side command execution in local or remote sessions.
- `busy.value` to detect turn completion.

The probe runs `node` through `connection.exec` with separate arguments rather than a shell command. The host-side script:

1. Validates the session ID against `^[A-Za-z0-9_-]+$`.
2. Encodes the working directory using Claude Code's project-directory rule: replace every non-alphanumeric character with `-`.
3. Resolves `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`.
4. Scans transcript records from newest to oldest for the latest assistant message that:
   - is not a sidechain record;
   - has a non-synthetic model;
   - contains numeric `message.usage` fields.
5. Returns only compact JSON usage metadata, never transcript content.

If the direct path does not exist, the probe fails silently and the native path remains active. It will not recursively scan unrelated project transcripts.

## Token calculation

To match Claude Code's native `updateUsage` behavior, current context tokens are calculated from the latest valid assistant usage record as:

```text
input_tokens
+ cache_creation_input_tokens
+ cache_read_input_tokens
+ output_tokens
```

Missing or non-finite fields count as zero. A result is accepted only when the sum is positive.

This differs intentionally from aggregate session-cost accounting: the chip displays the current context represented by the latest model response, not a sum across every turn.

## Triggering and concurrency

The chip subscribes to `busy.value` during render and stores transition state on the session object.

- When a session ID first becomes available while idle, perform one initial probe only if no positive token value has been captured.
- On every `busy: true -> false` transition, schedule transcript probes immediately and with short delayed retries to tolerate transcript flush ordering.
- Do not poll continuously.
- Allow only one probe generation per completed turn. Delayed results carry the session ID and generation number; stale results from a previous session or turn are ignored.
- Applying a transcript result may cause another render, but an idle-to-idle render must not schedule another probe.

Recommended retry delays are `0`, `300`, and `1000` milliseconds. Probe failures remain silent so they cannot affect chat operation.

## Applying fallback data

When a valid probe result arrives:

1. Re-read the current `usageData.value`.
2. Preserve `totalCost`, `contextWindow`, `maxOutputTokens`, and unknown fields.
3. Replace only `totalTokens` with the transcript-derived positive value.
4. Assign the new object through the normal signal setter so the existing interceptor cache and UI rendering update consistently.

Native positive updates remain authoritative in real time, while the completed-turn transcript result acts as the final reconciliation value.

## Context window priority

The context-window denominator retains the current priority:

1. User-configured custom context window.
2. Positive context window exposed by Claude Code for the active session.
3. Previously captured positive session value.
4. Known-model lookup table.
5. Existing `200000` default.

If observed token usage exceeds the selected fallback window, the existing percentage cap prevents overflow. Automatic window adjustment and manual user input remain separate capabilities; this change does not remove or lower their priority.

The transcript fallback makes token usage dynamic for arbitrary official and non-official model names. It cannot infer an unknown provider's exact context-window limit because transcripts do not contain that metadata.

## Error handling and security

- Validate session IDs before constructing paths.
- Pass `node`, script text, session ID, and working directory as discrete `exec` arguments; do not invoke a shell.
- Return only numeric usage data.
- Ignore missing files, malformed JSON lines, missing usage, unavailable connections, remote execution errors, and stale asynchronous results.
- Never modify transcript files.

## Testing

Add regression coverage for:

1. An initial idle session with zero UI usage receiving a positive transcript result.
2. A `busy: true -> false` transition scheduling reconciliation and updating the context pill.
3. The token formula including input, cache creation, cache read, and output tokens.
4. Synthetic and sidechain records being skipped in favor of the latest valid main assistant record.
5. An invalid session ID or missing transcript producing no update.
6. A stale asynchronous result from another session or earlier generation being ignored.
7. Applying a result preserving context window, cost, and other usage fields.
8. Existing native setter, cache preservation, custom context window, and debug-state tests continuing to pass.

## Scope

Implementation changes are limited to `patch-core.js` and `test/patch-core.test.js`. The installed Claude Code bundle is not edited directly by source tests. No new runtime dependency or Claude hook is introduced.
