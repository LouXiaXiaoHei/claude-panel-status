# Preserve Context Usage Design

## Goal

Prevent the status chip from falling back to `0/200k (0%)` after Claude Code resets `usageData`, when a valid token count and context window were already available earlier in the session.

## Current behavior

The injected setter interceptor initializes `__ccLastT` and `__ccLastCW` to zero when it is first installed. The footer can render only after `usageData.value` has already received valid values, so the first render is correct while the interceptor's cache remains empty.

When Claude Code later handles a new `system/init` event, it assigns `totalTokens: 0`. A non-official API may not provide a compatible top-level assistant `message.usage` or result `modelUsage`, so no later assignment contains a positive value. The interceptor therefore has nothing to restore and the display becomes `0/200k (0%)`.

## Design

When installing the interceptor, read the current `usageData.value` once and seed:

- `__ccLastT` from a positive `totalTokens`, otherwise zero.
- `__ccLastCW` from a positive `contextWindow`, otherwise zero.
- `__ccSetCount` as zero because the initial read is not a setter call.

Keep the existing setter behavior:

- Positive incoming values replace the corresponding cache.
- Zero or missing incoming values are replaced from the cache when a cached positive value exists.
- A user-configured context window remains the highest-priority context-window value.
- If no valid context window has ever been observed, use the model lookup table and finally the existing `200000` fallback.

No token estimation or interception of Claude Code's minified message-processing methods will be added. If a fresh session never exposes any valid usage data, the chip cannot determine the real token count and may still show zero.

## Data flow

1. The footer renders and installs the interceptor.
2. The interceptor snapshots the current valid usage values into session-local cache fields.
3. Claude Code assigns a new usage object.
4. The interceptor records positive values or repairs zero values from its cache before invoking the original signal setter.
5. Rendering continues to read the repaired `usageData.value`.

The cache remains attached to the session store, so separate sessions do not share usage values.

## Testing

Add regression coverage for the production ordering:

1. Construct a session whose current usage is already positive.
2. Render once to install the interceptor.
3. Verify the cache was seeded without incrementing the setter count.
4. Assign a new object with zero `totalTokens` and zero `contextWindow`.
5. Render again and verify the original token count, context window, percentage, and debug cache values remain intact.

Retain coverage that a later positive assignment updates the cache and that absent debug fields render safely.

## Scope

Only `patch-core.js` and `test/patch-core.test.js` will change during implementation. The generated VS Code extension bundle will not be edited directly by the source change or test run.
