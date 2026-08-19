import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeRun } from '../scripts/normalize-tiktok-stage-one.mjs';

test('preserves visible display strings and never invents exact views', () => {
  const result = normalizeRun({
    profile_url: 'https://www.tiktok.com/@example',
    observed_at: '2026-08-18T12:00:00.000Z',
    collection_status: 'COMPLETE',
    grid: [
      { video_id: '7659524702485892360', profile_id: 'example', canonical_url: 'https://www.tiktok.com/@example/video/7659524702485892360', views_display: '1.4M' },
      { video_id: '1234567890123456789', profile_id: 'example', canonical_url: 'https://www.tiktok.com/@example/video/1234567890123456789', views_display: '5,836' },
      { video_id: '9876543210123456789', profile_id: 'example', canonical_url: 'https://www.tiktok.com/@example/video/9876543210123456789', views_display: null, views_status: 'NOT_AVAILABLE' },
    ],
  });
  assert.equal(result.collection_status, 'COMPLETE');
  assert.equal(result.summary.videos_discovered, 3);
  assert.equal(result.summary.videos_with_visible_views, 2);
  assert.equal(result.grid[0].views_display, '1.4M');
  assert.equal(result.grid[0].views, null);
  assert.equal(result.grid[1].views_display, '5,836');
  assert.equal(result.grid[2].views_display, null);
  assert.equal(result.grid[2].status, 'PARTIAL');
});

test('rejects malformed rows instead of silently creating a record', () => {
  assert.throws(() => normalizeRun({ grid: [{ video_id: 'not-an-id' }] }), /invalid video_id/);
});

