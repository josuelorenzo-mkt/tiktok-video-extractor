# TikTok Phase 1 browser capture contract

Use the active user-authorized incognito Chrome Relay tab. The evaluator must
return only evidence available in the current public profile DOM. It must not
click links, open cards, navigate per-video, inspect cookies, or manufacture
view counts.

## Current-grid evaluator

The canonical implementation is exported by
`{baseDir}/scripts/tiktok-stage-one.mjs`:

```js
import { captureTikTokGrid } from '{baseDir}/scripts/tiktok-stage-one.mjs';

const snapshot = await tab.playwright.evaluate(captureTikTokGrid);
// snapshot.rows: current visible cards
// snapshot.at_bottom: viewport is at the loaded document bottom
// snapshot.loading_present: lazy-load/skeleton evidence is still present
```

The evaluator:

1. selects visible anchors containing `/video/`;
2. extracts `profile_id` and the numeric `video_id` from the canonical href;
3. scopes view-counter candidates to the matching card;
4. prefers view-specific `data-e2e`, `aria-label`, or `title` nodes;
5. accepts a single unambiguous bare token such as `5,836` or an abbreviated
   token such as `1.4M`;
6. returns `null` when the card has no trustworthy counter or has conflicting
   candidates;
7. reports scroll state so the caller does not stop on a transient empty DOM.

The returned row shape is:

```js
{
  position: 1,
  profile_id: 'example',
  video_id: '7659524702485892360',
  canonical_url: 'https://www.tiktok.com/@example/video/7659524702485892360',
  views_display: '1.4M',
  views_status: 'VISIBLE',
  views_evidence: 'view-specific-node',
  views_candidates: ['1.4M']
}
```

`views_display` is a source string, not an exact numeric field. The evaluator
does not parse K/M/B into integers.

## Capture loop

The caller owns the merge and stop logic. A minimal implementation is:

```js
import { captureTikTokGrid, mergeGridRows } from '{baseDir}/scripts/tiktok-stage-one.mjs';

let rows = [];
let stablePasses = 0;
for (let pass = 0; pass < 80; pass += 1) {
  const snapshot = await tab.playwright.evaluate(captureTikTokGrid);
  const before = rows.length;
  rows = mergeGridRows(rows.concat(snapshot.rows));
  const added = rows.length - before;

  if (added > 0 || snapshot.loading_present || !snapshot.at_bottom) stablePasses = 0;
  else stablePasses += 1;

  if (snapshot.at_bottom && !snapshot.loading_present && stablePasses >= 3) break;
  if (pass === 79) break;

  await tab.dom_cua.scroll({ x: 700, y: 900 });
  await tab.playwright.waitForTimeout(1800);
}
```

If the browser surface does not expose `window.innerHeight` outside
`evaluate`, use a fixed viewport-sized Relay scroll and retain the same
post-scroll wait/three-stable-captures rule. Do not scroll again before the
wait completes.

## View-counter regression cases

These are valid display values and must survive normalization unchanged:

```text
1.4M
916.8K
5,836
234
```

These are unavailable or ambiguous and must become `null`, with a warning:

```text
empty
N/D
—
1.4M 916.8K
```

Do not use follower, like, comment, caption, or page-header numbers as a
card's views. If TikTok exposes a bare number without the word “views”, it is
valid only when it comes from a view-specific node or the card has exactly one
unambiguous counter candidate.

