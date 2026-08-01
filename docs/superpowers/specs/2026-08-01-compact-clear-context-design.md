# Compact and Clear Context Design

## Goal

Make `/compact` display the compacted context size and make `/clear` reset context state, without removing the zero-value protection required by non-official APIs during ordinary turns.

## Findings

The current setter interceptor treats every `totalTokens: 0` assignment as an invalid API reset and restores `__ccLastT`. Claude Code legitimately writes zero for both a compact boundary and a new session, so the protection blocks `/compact` and can leak the previous session's usage into `/clear`.

Claude Code's persisted compact boundary contains exact enriched metadata. A real record from the current non-official model session contains:

```json
{
  "compactMetadata": {
    "preTokens": 83146,
    "postTokens": 6750,
    "cumulativeDroppedTokens": 76396
  }
}
```

The invariant is `preTokens - cumulativeDroppedTokens = postTokens`. The Claude Code UI only displays `preTokens` as a rounded “tokens freed” message, so UI text is not an accurate calculation source.

## Compact handling

Extend `TRANSCRIPT_PROBE` so its reverse scan recognizes the newest meaningful context record:

1. If it encounters a valid main assistant usage first, return the existing usage-derived positive `totalTokens`.
2. If it encounters a `system/compact_boundary` first, return the compacted token count:
   - use finite, non-negative `compactMetadata.postTokens` when present;
   - otherwise compute `max(0, preTokens - cumulativeDroppedTokens)` when both finite numbers exist;
   - otherwise return no result and wait for a later assistant usage.

The probe returns compact metadata as a typed result:

```json
{"kind":"compact","totalTokens":6750}
```

Normal usage results become:

```json
{"kind":"usage","totalTokens":76673}
```

The webview accepts both kinds when `totalTokens` is finite and non-negative. A compact result may legitimately be zero; a usage result must remain positive.

Applying a compact result preserves context window, cost, max output tokens, and unknown usage fields. The existing signal setter accepts a positive `postTokens` value naturally and updates `__ccLastT`. If an exact compact result is zero, the apply path uses a one-shot legitimate-reset flag so the setter clears `__ccLastT` instead of restoring it.

## Clear handling

Track the session ID associated with the usage cache when the setter interceptor is installed.

Before processing every incoming usage object:

1. Read the current `sessionId.value`.
2. If a previously non-empty tracked session ID differs from the current value, treat the assignment as a legitimate new-session reset.
3. Update the tracked session ID and clear `__ccLastT` and `__ccLastCW` before context-window fallback and zero-value repair run.
4. Allow the incoming `totalTokens: 0` to reach the original setter.

This works when Claude Code reuses a session store and changes its session ID before assigning the init usage reset. If `/clear` creates a new store object instead, its caches already initialize from the new store's zero values.

The transcript probe lifecycle also invalidates outstanding generations when the session ID changes. Results from the previous session cannot update the new session.

An initial transition from an empty session ID to its first assigned ID is not treated as a clear when no previous non-empty session ID exists. This prevents the first normal response from discarding valid usage.

## Ordinary turn behavior

The existing non-official API protection remains active when all of the following are true:

- the session ID has not changed;
- no one-shot compact reset is active;
- an incoming usage assignment has zero or missing `totalTokens`;
- `__ccLastT` contains a positive value.

In that case the setter continues restoring the last positive token count until native usage or transcript reconciliation supplies a newer value.

## Error handling

- Ignore malformed compact metadata rather than estimating from UI text.
- Reject negative or non-finite token values.
- Ignore stale transcript results using the existing generation and session checks.
- Never clear usage merely because a transcript is missing.
- Preserve the current custom context-window priority and `200000` unknown-model fallback.

## Testing

Add regression coverage for:

1. Probe returns `postTokens` when a compact boundary is newer than the last assistant usage.
2. Probe computes `preTokens - cumulativeDroppedTokens` when `postTokens` is absent.
3. A newer assistant usage after a compact boundary wins over the boundary.
4. A compact result updates a prior large token value to the smaller post-compact value while preserving other fields.
5. An exact zero compact result clears the cache through the one-shot reset path.
6. A real session ID change followed by `totalTokens: 0` clears token and context-window caches.
7. The first empty-to-assigned session ID transition does not discard a valid first response.
8. An old probe generation cannot restore pre-clear usage.
9. Ordinary same-session zero assignments continue restoring cached usage.
10. All transcript fallback and existing context-window tests continue to pass.

## Scope

Implementation changes are limited to `patch-core.js` and `test/patch-core.test.js`. No Claude hook, setting, dependency, or installed bundle is modified directly.
