---
name: tiktok-video-extractor
description: Use when an agent must inventory videos from a public, authorized TikTok profile through Chrome Relay, especially when the profile loads progressively, shows closeable login overlays, or exposes only abbreviated visible view counters.
---

# TikTok Phase 1 Extractor

## Boundary

This skill completes only Phase 1: discover every video exposed by the public
profile grid, correlate each card with its canonical `video_id`, and preserve
the view counter visible on that card. The profile grid is the source of truth
for `views_display`.

Do not click a grid card and do not navigate to
`https://www.tiktok.com/@<profile>/video/<video_id>` in this skill. Per-video
detail collection is a separate Phase 2 workflow and is intentionally out of
scope.

## Preconditions and safety

- Collect only a public profile for which the user has authorization.
- Use a user-opened incognito Chrome tab connected to Chrome Relay. Phase 1
  runs in a normal incognito viewport; responsive/iPad emulation belongs to a
  different workflow.
- If the incognito tab is not visible to Relay, have the user expose/claim that
  tab or enable the Chrome extension's incognito permission. Never silently
  switch to a signed-in tab.
- Never request credentials, inspect cookies, change identities, use proxies,
  bypass access controls, or solve CAPTCHA, slider, audio, or puzzle
  challenges.
- Save one raw run and one normalized run. Include `observed_at` and
  `elapsed_ms` so the result is auditable.

## Output contract

Create `raw-run.json` during capture and produce `normalized-run.json` with:

```json
{
  "extractor": "tiktok-video-extractor",
  "extractor_version": "0.1.0",
  "platform": "tiktok",
  "profile_url": "https://www.tiktok.com/@example",
  "profile_id": "example",
  "collection_status": "COMPLETE",
  "observed_at": "2026-08-18T12:00:00.000Z",
  "elapsed_ms": 12345,
  "grid": [
    {
      "position": 1,
      "profile_id": "example",
      "video_id": "7659524702485892360",
      "canonical_url": "https://www.tiktok.com/@example/video/7659524702485892360",
      "views_display": "1.4M",
      "views_status": "VISIBLE",
      "views_source": "tiktok.profile-grid.visible-card",
      "status": "CAPTURED",
      "observed_at": "2026-08-18T12:00:00.000Z"
    }
  ],
  "warnings": []
}
```

`views_display` is deliberately a display string. Preserve `1.4M`, `916.8K`,
and `5,836` as displayed; do not convert abbreviations into invented exact
integers and do not use zero for an unavailable counter. Use `null` with
`views_status: "NOT_AVAILABLE"` or `"AMBIGUOUS"` when the card does not expose
a trustworthy counter.

## Phase 1 procedure

### 1. Open and stabilize the profile

1. In the Relay-connected incognito tab, navigate to the supplied profile URL
   (the trailing slash is optional) and wait for the header and first grid to
   render before reading the DOM.
2. Confirm that the URL is a TikTok profile and that the page is not
   `chrome-error://chromewebdata/`. Record the requested profile URL, the
   resolved profile handle, and the start timestamp.
3. Capture the initial grid before scrolling. Do not infer an empty profile
   from an initial empty snapshot; wait and make another capture.

### 2. Close only permitted overlays

When an overlay appears, identify it from its surrounding dialog/challenge
container. If it has a visible, explicit `X`/close control, click only that
control, wait for the page to settle, and capture again. If the overlay remains
after closing, reload once and resume the profile-grid scan. A login popup may
reappear after later scrolls; close its `X` and continue without logging in.

Known evidence from the validated flow includes `#captcha_close_button` and a
close button with `aria-label="Close"`, but never click an arbitrary page
control just because it says Close.

If the page presents a slider, audio challenge, puzzle, or refresh/verify
control and there is no effective `X`, stop with `BLOCKED_BY_CHALLENGE`. Never
drag, refresh a challenge, submit it, or try another identity. If a browser
error shows `ERR_BLOCKED_BY_CLIENT`, `chrome-error://chromewebdata/`, or an
access-denied page, stop with `BLOCKED_BY_CLIENT` and preserve the partial raw
run.

### 3. Capture IDs and visible views from the current grid

Use the evaluator in `{baseDir}/references/browser-evaluators.md`, preferably
through the reusable `captureTikTokGrid` export:

```js
import { captureTikTokGrid } from '{baseDir}/scripts/tiktok-stage-one.mjs';

const snapshot = await tab.playwright.evaluate(captureTikTokGrid);
```

For every visible anchor whose `href` matches
`/@<profile>/video/<digits>`, extract the numeric ID from the URL. Canonicalize
it as `https://www.tiktok.com/@<profile>/video/<video_id>`. Do not derive the
ID from card text, captions, image filenames, or DOM position.

Read views only from the matching card: first use a view-specific
`data-e2e`/accessible node, then a single unambiguous counter candidate within
that card. A whole-page number is never evidence. Merge repeated DOM rows by
`video_id`; keep the first position and replace an earlier missing
`views_display` when a later capture exposes the counter.

### 4. Scroll gradually until the inventory is stable

Use a small viewport-sized scroll, then wait for lazy-loaded cards and any
overlay to settle before capturing again. A practical default is one scroll of
about `0.8 * innerHeight` followed by at least 1.5–2 seconds of waiting; use a
longer wait when the grid still has loading placeholders. Never issue another
scroll while the current wait is pending.

Keep `scroll_count`, `scroll_height`, `at_bottom`, `loading_present`, and the
number of newly discovered IDs in the raw run. Reset the stable-pass counter
whenever a new ID appears, loading is still visible, or the document has not
reached the bottom. Merge every snapshot into the same ID map.

Stop only when all of these are true:

- the page is at the bottom of the loaded grid;
- no loading placeholders remain;
- three consecutive post-wait captures add no new IDs.

Use a bounded maximum of 80 scroll passes as a safety limit. Hitting that limit
is `PARTIAL`, not `COMPLETE`. An empty snapshot, unchanged screenshot, or
placeholder by itself is not proof that the profile is complete.

If the profile explicitly displays an empty/no-posts state after the page has
stabilized, use `collection_status: "EMPTY"` and an empty `grid`. If the page
loaded but some cards or counters remained unavailable, use `PARTIAL` and keep
the records that were actually observed.

### 5. Normalize and report

Run the deterministic normalizer after the browser run:

```bash
node {baseDir}/scripts/normalize-tiktok-stage-one.mjs \
  --input raw-run.json \
  --output normalized-run.json
```

Report the collection status, elapsed time, number of unique videos, number
with visible views, number with unavailable/ambiguous views, scroll count, and
every warning. Report `EMPTY`, `PARTIAL`, `BLOCKED_BY_CHALLENGE`,
`BLOCKED_BY_CLIENT`, `LOGIN_OVERLAY_UNDISMISSABLE`, and `NOT_FOUND` explicitly;
never silently turn them into a successful empty result.

## Status rules and common mistakes

| Situation | Required result |
|---|---|
| Stable bottom, no loaders, 3 no-new-ID captures | `COMPLETE` |
| Explicit profile empty state | `EMPTY` |
| Max passes, interrupted load, or incomplete pagination | `PARTIAL` |
| Slider/puzzle/audio challenge cannot be closed | `BLOCKED_BY_CHALLENGE` |
| `ERR_BLOCKED_BY_CLIENT` or Chromium error page | `BLOCKED_BY_CLIENT` |
| Login overlay has no usable X and blocks the grid | `LOGIN_OVERLAY_UNDISMISSABLE` |
| Profile is unavailable or returns a genuine not-found page | `NOT_FOUND` |

Red flags that require stopping and correcting the run:

- clicking a tile or opening a universal per-video URL during Phase 1;
- treating a blank first snapshot as an empty profile;
- converting `1.4M` into `1,400,000` and presenting it as exact;
- using `0` for a missing counter;
- solving or retrying a challenge by changing identity, proxy, or browser;
- switching accounts before the current profile meets the stable-bottom stop
  condition.

