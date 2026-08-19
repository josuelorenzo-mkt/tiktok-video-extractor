const COUNT_TOKEN_SOURCE = String.raw`(?:\d{1,3}(?:[,.]\d{3})+|\d+(?:[.,]\d+)?)(?:\s*[KMB])?`;
const COUNT_TOKEN_RE = new RegExp(`^${COUNT_TOKEN_SOURCE}$`, 'i');
const LABELED_COUNT_RE = new RegExp(
  `(?:views?|visualizaciones?|reproducciones?|plays?)\\s*[:\\-]?\\s*(${COUNT_TOKEN_SOURCE})|(${COUNT_TOKEN_SOURCE})\\s*(?:views?|visualizaciones?|reproducciones?|plays?)`,
  'i',
);

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function visible(node) {
  return !!node && !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
}

function tokenFromText(value) {
  const text = cleanText(value);
  if (!text || /^(?:n\/?a|n\/?d|not available|—)$/i.test(text)) return null;
  const labeled = text.match(LABELED_COUNT_RE);
  if (labeled) return (labeled[1] || labeled[2] || '').replace(/\s+/g, '');
  return COUNT_TOKEN_RE.test(text) ? text.replace(/\s+/g, '') : null;
}

function profileAndVideoFromHref(value) {
  const raw = String(value ?? '');
  const match = raw.match(/(?:https?:\/\/[^/]+)?\/@([^/?#]+)\/video\/(\d+)/i);
  if (!match) return null;
  const profileId = decodeURIComponent(match[1]);
  const videoId = match[2];
  return {
    profile_id: profileId,
    video_id: videoId,
    canonical_url: `https://www.tiktok.com/@${encodeURIComponent(profileId)}/video/${videoId}`,
  };
}

export function parseTikTokVideoUrl(value) {
  return profileAndVideoFromHref(value);
}

export function captureTikTokGrid() {
  // Keep the browser evaluator self-contained: Playwright serializes this
  // function and does not carry module-level closures into the page.
  const countTokenSource = String.raw`(?:\d{1,3}(?:[,.]\d{3})+|\d+(?:[.,]\d+)?)(?:\s*[KMB])?`;
  const countTokenRe = new RegExp(`^${countTokenSource}$`, 'i');
  const labeledCountRe = new RegExp(
    `(?:views?|visualizaciones?|reproducciones?|plays?)\\s*[:\\-]?\\s*(${countTokenSource})|(${countTokenSource})\\s*(?:views?|visualizaciones?|reproducciones?|plays?)`,
    'i',
  );
  const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const isVisible = (node) => !!node && !!(node.offsetWidth || node.offsetHeight || node.getClientRects().length);
  const token = (value) => {
    const text = clean(value);
    if (!text || /^(?:n\/?a|n\/?d|not available|—)$/i.test(text)) return null;
    const labeled = text.match(labeledCountRe);
    if (labeled) return (labeled[1] || labeled[2] || '').replace(/\s+/g, '');
    return countTokenRe.test(text) ? text.replace(/\s+/g, '') : null;
  };
  const parse = (value) => {
    const match = String(value ?? '').match(/(?:https?:\/\/[^/]+)?\/@([^/?#]+)\/video\/(\d+)/i);
    if (!match) return null;
    const profileId = decodeURIComponent(match[1]);
    const videoId = match[2];
    return {
      profile_id: profileId,
      video_id: videoId,
      canonical_url: `https://www.tiktok.com/@${encodeURIComponent(profileId)}/video/${videoId}`,
    };
  };
  const rows = [];
  const seen = new Set();
  const viewSpecificSelectors = [
    '[data-e2e="video-views"]',
    '[data-e2e="browse-video-count"]',
    '[data-e2e="video-card-view-count"]',
    '[aria-label*="view"]',
    '[aria-label*="View"]',
    '[title*="view"]',
    '[title*="View"]',
  ].join(',');

  const readViews = (card) => {
    const targeted = [...card.querySelectorAll(viewSpecificSelectors)]
      .filter(isVisible)
      .flatMap((node) => [node.innerText, node.textContent, node.getAttribute('aria-label'), node.getAttribute('title')])
      .map(token)
      .filter(Boolean);
    const targetedUnique = [...new Set(targeted)];
    if (targetedUnique.length === 1) {
      return { views_display: targetedUnique[0], views_status: 'VISIBLE', views_evidence: 'view-specific-node', views_candidates: targetedUnique };
    }
    if (targetedUnique.length > 1) {
      return { views_display: null, views_status: 'AMBIGUOUS', views_evidence: 'conflicting-view-nodes', views_candidates: targetedUnique };
    }

    const fallback = [...card.querySelectorAll('strong, span')]
      .filter(isVisible)
      .map((node) => token(node.innerText || node.textContent))
      .filter(Boolean);
    const fallbackUnique = [...new Set(fallback)];
    if (fallbackUnique.length === 1) {
      return { views_display: fallbackUnique[0], views_status: 'VISIBLE', views_evidence: 'single-counter-candidate', views_candidates: fallbackUnique };
    }
    return {
      views_display: null,
      views_status: fallbackUnique.length > 1 ? 'AMBIGUOUS' : 'NOT_AVAILABLE',
      views_evidence: fallbackUnique.length > 1 ? 'multiple-counter-candidates' : 'counter-not-visible',
      views_candidates: fallbackUnique,
    };
  };

  [...document.querySelectorAll('a[href*="/video/"]')].forEach((anchor) => {
    if (!isVisible(anchor)) return;
    const parsed = parse(anchor.getAttribute('href') || anchor.href);
    if (!parsed || seen.has(parsed.video_id)) return;
    seen.add(parsed.video_id);
    const card = anchor.closest('div[data-e2e="user-post-item"], li, article') || anchor.parentElement || anchor;
    rows.push({
      position: rows.length + 1,
      ...parsed,
      ...readViews(card),
    });
  });

  const loading_present = [...document.querySelectorAll('[aria-busy="true"], [data-e2e*="loading"], [class*="skeleton"]')].some(isVisible);
  const scrollHeight = Math.max(document.documentElement?.scrollHeight || 0, document.body?.scrollHeight || 0);
  const at_bottom = window.scrollY + window.innerHeight >= scrollHeight - 160;
  const bodyText = clean(document.body?.innerText);
  const empty_state = /(?:no videos|no posts|no content|sin videos|sin publicaciones)/i.test(bodyText);
  return { rows, loading_present, at_bottom, empty_state, scroll_height: scrollHeight, scroll_y: window.scrollY };
}

export function mergeGridRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  const merged = new Map();
  for (const row of rows) {
    const videoId = String(row?.video_id || '');
    if (!/^\d{8,30}$/.test(videoId)) continue;
    const current = merged.get(videoId);
    const next = { ...row, video_id: videoId };
    if (!current) {
      merged.set(videoId, next);
      continue;
    }
    const shouldReplaceViews = !current.views_display && next.views_display;
    merged.set(videoId, {
      ...current,
      ...next,
      position: current.position ?? next.position ?? null,
      ...(shouldReplaceViews ? { views_display: next.views_display, views_status: next.views_status, views_evidence: next.views_evidence, views_candidates: next.views_candidates } : {
        views_display: current.views_display ?? null,
        views_status: current.views_status ?? 'NOT_AVAILABLE',
        views_evidence: current.views_evidence ?? null,
        views_candidates: current.views_candidates ?? [],
      }),
    });
  }
  return [...merged.values()].map((row, index) => ({ ...row, position: index + 1 }));
}

export const TIKTOK_STAGE_ONE_DEFAULTS = Object.freeze({
  max_scrolls: 80,
  stable_passes: 3,
  min_wait_ms: 1800,
});
