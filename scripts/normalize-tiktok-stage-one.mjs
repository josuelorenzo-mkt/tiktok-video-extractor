import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeGridRows, parseTikTokVideoUrl } from './tiktok-stage-one.mjs';

const FIELD_SOURCES = Object.freeze({
  profile_id: 'tiktok.profile-grid.anchor.href',
  video_id: 'tiktok.profile-grid.anchor.href',
  canonical_url: 'tiktok.profile-grid.anchor.href',
  views_display: 'tiktok.profile-grid.visible-card-counter',
});

function profileFromUrl(value) {
  const match = String(value ?? '').match(/(?:https?:\/\/[^/]+)?\/@([^/?#]+)/i);
  return match ? decodeURIComponent(match[1]) : null;
}

function normalizeViewsDisplay(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  if (!text || /^(?:n\/?a|n\/?d|not available|—)$/i.test(text)) return null;
  const countToken = String.raw`(?:\d{1,3}(?:[,.]\d{3})+|\d+(?:[.,]\d+)?)(?:\s*[KMB])?`;
  const labeled = text.match(new RegExp(`(?:views?|visualizaciones?|reproducciones?|plays?)\\s*[:\\-]?\\s*(${countToken})|(${countToken})\\s*(?:views?|visualizaciones?|reproducciones?|plays?)`, 'i'));
  const token = labeled?.[1] || labeled?.[2] || (new RegExp(`^${countToken}$`, 'i').test(text) ? text : null);
  return token ? token.replace(/\s+/g, '') : null;
}

function requiredArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}

export function normalizeRun(input) {
  const rawGrid = requiredArray(input.grid, 'grid');
  for (const card of rawGrid) {
    const rawVideoId = String(card?.video_id || '');
    if (!/^\d{8,30}$/.test(rawVideoId)) throw new Error(`invalid video_id: ${rawVideoId || '(empty)'}`);
  }
  const grid = mergeGridRows(rawGrid);
  const profileUrl = input.profile_url ?? null;
  const profileId = input.profile_id ?? profileFromUrl(profileUrl);
  const collectionStatus = String(input.collection_status || 'PARTIAL').toUpperCase();
  const records = grid.map((card, index) => {
    const parsed = parseTikTokVideoUrl(card.canonical_url || card.url || card.href);
    const videoId = String(card.video_id || parsed?.video_id || '');
    if (!/^\d{8,30}$/.test(videoId)) throw new Error(`invalid video_id: ${videoId || '(empty)'}`);
    const rowProfile = String(card.profile_id || parsed?.profile_id || profileId || '');
    const canonicalUrl = parsed?.canonical_url || (rowProfile ? `https://www.tiktok.com/@${encodeURIComponent(rowProfile)}/video/${videoId}` : null);
    const viewsDisplay = normalizeViewsDisplay(card.views_display);
    const warnings = [...(Array.isArray(card.warnings) ? card.warnings : [])];
    if (card.views_display != null && viewsDisplay == null) warnings.push('unrecognized_views_display');
    if (viewsDisplay == null && !warnings.includes('views_not_visible')) warnings.push('views_not_visible');
    return {
      position: index + 1,
      profile_id: rowProfile || null,
      video_id: videoId,
      canonical_url: canonicalUrl,
      views: null,
      views_display: viewsDisplay,
      views_status: viewsDisplay ? 'VISIBLE' : (card.views_status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'NOT_AVAILABLE'),
      views_source: FIELD_SOURCES.views_display,
      observed_at: input.observed_at ?? null,
      status: viewsDisplay ? 'CAPTURED' : 'PARTIAL',
      field_sources: FIELD_SOURCES,
      ...(warnings.length ? { warnings: [...new Set(warnings)] } : {}),
    };
  });
  return {
    extractor: 'tiktok-video-extractor',
    extractor_version: '0.1.0',
    platform: 'tiktok',
    profile_url: profileUrl,
    profile_id: profileId,
    collection_status: collectionStatus,
    observed_at: input.observed_at ?? null,
    elapsed_ms: Number.isFinite(input.elapsed_ms) ? input.elapsed_ms : null,
    scroll_count: Number.isInteger(input.scroll_count) ? input.scroll_count : null,
    summary: {
      videos_discovered: records.length,
      videos_with_visible_views: records.filter((record) => record.views_display != null).length,
      videos_without_visible_views: records.filter((record) => record.views_display == null).length,
      warnings: records.reduce((sum, record) => sum + (record.warnings?.length || 0), 0),
    },
    grid: records,
    warnings: Array.isArray(input.warnings) ? input.warnings : [],
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] || null;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const inputPath = argument('--input');
  const outputPath = argument('--output');
  if (!inputPath || !outputPath) {
    console.error('Usage: node normalize-tiktok-stage-one.mjs --input raw-run.json --output normalized-run.json');
    process.exitCode = 2;
  } else {
    const result = normalizeRun(JSON.parse(fs.readFileSync(inputPath, 'utf8')));
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify({ collection_status: result.collection_status, ...result.summary }));
  }
}
