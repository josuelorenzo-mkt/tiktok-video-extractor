import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeGridRows, parseTikTokVideoUrl } from '../scripts/tiktok-stage-one.mjs';

test('parses absolute and relative TikTok video URLs', () => {
  assert.deepEqual(parseTikTokVideoUrl('https://www.tiktok.com/@example/video/7659524702485892360'), {
    profile_id: 'example',
    video_id: '7659524702485892360',
    canonical_url: 'https://www.tiktok.com/@example/video/7659524702485892360',
  });
  assert.deepEqual(parseTikTokVideoUrl('/@example/video/7659524702485892360?lang=en'), {
    profile_id: 'example',
    video_id: '7659524702485892360',
    canonical_url: 'https://www.tiktok.com/@example/video/7659524702485892360',
  });
});

test('deduplicates by video ID and fills a later visible counter', () => {
  const rows = mergeGridRows([
    { position: 7, profile_id: 'example', video_id: '7659524702485892360', views_display: null, views_status: 'NOT_AVAILABLE' },
    { position: 2, profile_id: 'example', video_id: '7659524702485892360', views_display: '1.4M', views_status: 'VISIBLE' },
    { position: 3, profile_id: 'example', video_id: '1234567890123456789', views_display: '5,836', views_status: 'VISIBLE' },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].position, 1);
  assert.equal(rows[0].views_display, '1.4M');
  assert.equal(rows[1].video_id, '1234567890123456789');
});

