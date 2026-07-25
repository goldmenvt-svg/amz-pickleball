#!/usr/bin/env node
// Auto-sync script: fetches AMZ YouTube RSS and updates data/videos.json
// Run by GitHub Actions daily — do not run manually unless testing

const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

const VIDEOS_JSON = resolve(__dirname, '../data/videos.json');

const CHANNEL_ID = 'UCm3-CYZbJmFxet5cn10ULXA';
const RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

async function fetchRSS() {
  const res = await fetch(RSS_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AMZ-Bot/1.0)' }
  });
  if (!res.ok) throw new Error(`RSS fetch failed: ${res.status} ${res.statusText}`);
  return res.text();
}

// === CANONICAL YOUTUBE ID NORMALIZATION (kept identical across scripts/sync-youtube.js, scripts/video-discover.js, admin.html) ===
const YOUTUBE_ID_RE = /^[A-Za-z0-9_-]{11}$/;

function extractYouTubeId(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (YOUTUBE_ID_RE.test(trimmed)) return trimmed;

  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : 'https://' + trimmed;
  let url;
  try {
    url = new URL(withScheme);
  } catch (e) {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, '').toLowerCase();
  let candidate = null;

  if (host === 'youtu.be') {
    candidate = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com') {
    if (url.pathname === '/watch') {
      candidate = url.searchParams.get('v');
    } else if (url.pathname.indexOf('/shorts/') === 0) {
      candidate = url.pathname.split('/')[2];
    } else if (url.pathname.indexOf('/embed/') === 0) {
      candidate = url.pathname.split('/')[2];
    } else if (url.pathname.indexOf('/live/') === 0) {
      candidate = url.pathname.split('/')[2];
    }
  } else {
    return null;
  }

  if (!candidate) return null;
  return YOUTUBE_ID_RE.test(candidate) ? candidate : null;
}
// === END CANONICAL YOUTUBE ID NORMALIZATION ===

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseRSSEntries(xml) {
  const entries = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const entry = match[1];
    const videoId = (entry.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
    const title = (entry.match(/<title>(.*?)<\/title>/) || [])[1];
    const published = (entry.match(/<published>(.*?)<\/published>/) || [])[1];
    const viewCount = (entry.match(/<yt:viewCount>(.*?)<\/yt:viewCount>/) || [])[1];

    if (!videoId) continue;

    entries.push({
      videoId,
      title: title ? decodeHtmlEntities(title) : '',
      publishedAt: published ? published.split('T')[0] : '',
      viewCount: parseInt(viewCount || '0', 10)
    });
  }

  return entries;
}

function isDateLikeTitle(title) {
  // Detect titles like "ngày 2 tháng 11, 2025" or "01/11/2025" or just a date
  return /^(ngày\s+\d|[\d]{1,2}[\/\-]\d|^\d{4}-\d{2}-\d{2}$)/i.test(title.trim());
}

function makeTitle(rawTitle, publishedAt) {
  if (!rawTitle || isDateLikeTitle(rawTitle)) {
    const date = publishedAt
      ? new Date(publishedAt).toLocaleDateString('vi-VN', { day: 'numeric', month: 'numeric', year: 'numeric' })
      : '';
    return `Trận đấu tại sân AMZ Pickleball${date ? ` — ${date}` : ''}`;
  }
  return rawTitle;
}

async function main() {
  console.log('Fetching AMZ YouTube RSS feed…');
  const xml = await fetchRSS();
  const rssEntries = parseRSSEntries(xml);
  console.log(`Found ${rssEntries.length} video(s) on channel.`);

  const data = JSON.parse(readFileSync(VIDEOS_JSON, 'utf-8'));

  // Canonical dedup set, built across ALL statuses (approved/pending/rejected) —
  // prefer platformId, fall back to parsing the yt_<id> form of .id.
  const existingKeys = new Set();
  for (const v of data.videos) {
    if (v.platform !== 'youtube') continue;
    const idMatch = typeof v.id === 'string' ? v.id.match(/^yt_([A-Za-z0-9_-]{11})$/) : null;
    const canonical = extractYouTubeId(v.platformId) || (idMatch ? idMatch[1] : null);
    if (canonical) existingKeys.add(`youtube:${canonical}`);
  }

  const now = new Date().toISOString();
  let addedCount = 0;

  for (const entry of rssEntries) {
    const canonicalId = extractYouTubeId(entry.videoId);
    if (!canonicalId) {
      console.log(`  Skipped (invalid YouTube ID): ${entry.videoId}`);
      continue;
    }
    const dedupKey = `youtube:${canonicalId}`;
    if (existingKeys.has(dedupKey)) continue;
    existingKeys.add(dedupKey);

    const title = makeTitle(entry.title, entry.publishedAt);

    const video = {
      id: `yt_${canonicalId}`,
      platform: 'youtube',
      platformId: canonicalId,
      title,
      description: 'Video Pickleball tại sân AMZ — 179 Thống Nhất, TP.HCM',
      channelTitle: 'AMZ Pickleball',
      thumbnail: `https://i.ytimg.com/vi/${canonicalId}/hqdefault.jpg`,
      duration: '',
      publishedAt: entry.publishedAt,
      viewCount: entry.viewCount,
      priority: 5,
      badge: 'Mới',
      status: 'pending',
      category: 'grid',
      addedAt: now,
      approvedAt: now
    };

    // Insert after the first featured video to keep it at top
    const featuredIdx = data.videos.findIndex(v => v.category === 'featured' && v.status === 'approved');
    const insertAt = featuredIdx >= 0 ? featuredIdx + 1 : 0;
    data.videos.splice(insertAt, 0, video);

    console.log(`+ Added: [${canonicalId}] ${title}`);
    addedCount++;
  }

  if (addedCount === 0) {
    console.log('No new videos — nothing to update.');
    return;
  }

  data.lastScan = now;
  writeFileSync(VIDEOS_JSON, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`Done — ${addedCount} new video(s) added to data/videos.json`);
}

main().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
