# Live Context Monitor Design

## Goal

Continuously display context usage for official and non-official models while a response is streaming, so users can see when a provider that does not slide its context window is approaching truncation. Preserve the existing chip format and custom context-window setting.

The displayed value does not distinguish exact and estimated usage. Estimates are deliberately conservative and are replaced by native or transcript-derived values when available.

## Findings

Claude Code already updates `usageData` from final main-assistant messages when `message.usage` is present. That remains the fastest and most reliable path for official models and compatible providers.

Claude Code also processes raw streaming events before the final assistant message:

- `message_start.message.usage` may contain input, cache creation, cache read, and initial output usage;
- `message_delta.usage.output_tokens` may contain cumulative output usage;
- `content_block_delta` contains streamed text, thinking text, or partial tool JSON even when a provider omits usage.

The current transcript fallback runs only at idle startup and after `busy: true -> false`. It therefore cannot show growth during a response and may wait for the 300ms or 1000ms retry after the response completes.

Claude Todos is faster because it watches the transcript directory with `fs.watch` and a 150ms debounce. Its session hooks identify the relevant session; they are not the mechanism that calculates tokens.

## Architecture

Use a three-level data path, in priority order:

1. Claude's native final assistant usage remains authoritative when present.
2. A guarded wrapper around the current session's `processMessage()` derives a live value from raw stream events.
3. The existing transcript probe reconciles the final persisted value and handles providers whose stream events contain no usable usage.

The wrapper is installed once per session store and always calls the original method exactly once. Plugin parsing is isolated by `try/catch` so it cannot interfere with Claude message processing.

Live values are stored separately from confirmed usage, for example in `__ccLiveT`. They affect rendering but do not update `__ccLastT`. A lightweight signal refresh is throttled to at most once every 100ms.

## Streaming Usage

### Message start

For a root `stream_event` whose inner event is `message_start`, reset the per-call stream counters.

If `message.usage` contains finite, non-negative values, compute the context base from:

```text
input_tokens
+ cache_creation_input_tokens
+ cache_read_input_tokens
```

Use its initial `output_tokens` when present. A later tool-driven model call produces a new `message_start`; its input/cache total replaces the previous base because it already represents the expanded prompt for that call.

If the provider omits input usage, use the last confirmed `__ccLastT` as a fallback base. This is not exact because newly submitted user or tool content may not yet be included, but it is better than freezing the indicator.

### Message delta

For a root `message_delta`, accept finite, non-negative cumulative `usage.output_tokens`. The live total is:

```text
stream base + cumulative output tokens
```

### Content delta fallback

For root `content_block_delta` events, accumulate the UTF-8 bytes of:

- `text_delta.text`;
- `thinking_delta.thinking`;
- `input_json_delta.partial_json`.

When exact cumulative output usage is unavailable, estimate output tokens as:

```text
ceil(accumulated UTF-8 bytes / 3)
```

This ratio is intentionally conservative across English prose, code, JSON, and CJK text. Within one model call the displayed value does not decrease merely because a delayed exact output count is lower than the current estimate. A new `message_start`, compact event, clear event, native final usage, or transcript result may legitimately replace or reduce it.

### Rendering

While live state is active, render `__ccLiveT` instead of the confirmed `usageData.totalTokens`. Keep the existing output format, percentage calculation, progress fill, and colors. Do not add an approximation symbol.

Context-window priority remains:

1. user custom value;
2. API value;
3. model lookup table;
4. `200000` fallback.

The live state is retained briefly after `busy` becomes false when no native final usage arrived. It is cleared when the transcript probe applies its authoritative result, preventing a temporary jump back to the stale pre-turn value.

## Compact Handling

Handle `system/compact_boundary` in the stream wrapper before Claude's original handler writes `totalTokens: 0`.

1. Enable the existing one-shot legitimate-zero path.
2. Clear the old live base, output counters, estimate, and confirmed token cache.
3. Invalidate earlier stream timers and transcript generations.
4. If raw compact metadata contains a valid post-compact token count, apply it immediately.
5. Otherwise request an immediate compact-specific transcript reconciliation without waiting for `busy=false`.

The transcript probe continues to prefer finite, non-negative `compactMetadata.postTokens`. If absent, it computes `max(0, preTokens - cumulativeDroppedTokens)`.

The next root `message_start` provides another opportunity to replace the compact result with its post-compact input/cache usage. A short-lived zero is acceptable; retaining the pre-compact value is not.

## Clear Handling

When `/clear` creates a new session store, all live and confirmed state initializes from zero naturally.

When a store is reused, intercept a `system/init` whose non-empty `session_id` differs from the tracked session before Claude processes its usage reset:

- permit the legitimate zero assignment;
- clear `__ccLastT`, `__ccLastCW`, `__ccLiveT`, and all stream counters;
- invalidate stream timers and transcript generations;
- bind subsequent values to the new session ID.

The existing setter-level session-ID check remains as a second line of defense. An initial transition from an empty session ID to its first assigned ID is not treated as a clear.

## State and Precedence

The session store gains bounded plugin-owned state:

- wrapper-installed flag and original `processMessage` reference;
- stream/session generation;
- stream context base;
- exact cumulative output count, when supplied;
- accumulated UTF-8 byte count for fallback estimation;
- current live display token count;
- throttled-refresh timer and pending flag.

Token display precedence is:

1. active live stream value;
2. the latest native or transcript-confirmed `usageData.totalTokens`;
3. cached confirmed `__ccLastT` protection.

The transcript result is authoritative when it arrives and clears the corresponding live state. Compact and session changes may legitimately reduce the displayed value; ordinary same-session zero assignments still restore the last confirmed positive value.

## Error Handling

- Ignore sidechain/subagent stream events for the main context display.
- Reject negative, non-finite, or structurally invalid usage.
- Ignore unknown stream delta types.
- If `processMessage` is absent or changes shape, do not install the wrapper and retain current behavior.
- Always preserve the original method's `this`, arguments, return value, and thrown errors.
- A timer or async result must match both the current session ID and generation before updating state.
- Cancel or invalidate pending throttled refreshes on compact, clear, and session change.
- Transcript read/RPC failures remain silent and never clear a valid displayed value.

## Testing

Add regression coverage for:

1. `message_start` input/cache plus cumulative `message_delta` output produces a live total.
2. Missing usage falls back to UTF-8 byte estimation for text, thinking, and partial tool JSON.
3. Refreshes are throttled to at most one per 100ms window.
4. Live estimates do not update `__ccLastT`.
5. A later tool-call `message_start` replaces the earlier stream base.
6. Native final assistant usage clears and replaces live state.
7. A transcript result clears and replaces live state after the turn.
8. A compact boundary permits native zero, clears stale live state, and immediately reconciles `postTokens`.
9. Compact fallback subtraction remains supported.
10. A new store and a reused store both clear usage for `/clear`.
11. Old stream timers and transcript results cannot update a new session.
12. Missing `processMessage` silently retains the current transcript-only behavior.
13. Existing official-model, custom-window, ordinary-zero, compact, clear, and transcript tests remain green.

## Scope

Implementation changes are limited to `patch-core.js` and `test/patch-core.test.js`. No new hook, dependency, setting, UI segment, approximation marker, or direct installed-bundle modification is introduced.
