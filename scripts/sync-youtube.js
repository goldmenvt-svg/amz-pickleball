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
  const existingIds = new Set(data.videos.map(v => v.platformId));

  const newEntries = rssEntries.filter(e => !existingIds.has(e.videoId));
  if (newEntries.length === 0) {
    console.log('No new videos — nothing to update.');
    return;
  }

  const now = new Date().toISOString();
  let addedCount = 0;

  for (const entry of newEntries) {
    const title = makeTitle(entry.title, entry.publishedAt);

    const video = {
      id: `yt_${entry.videoId}`,
      platform: 'youtube',
      platformId: entry.videoId,
      title,
      description: 'Video Pickleball tại sân AMZ — 179 Thống Nhất, TP.HCM',
      channelTitle: 'AMZ Pickleball',
      thumbnail: `https://i.ytimg.com/vi/${entry.videoId}/hqdefault.jpg`,
      duration: '',
      publishedAt: entry.publishedAt,
      viewCount: entry.viewCount,
      priority: 5,
      badge: 'Mới',
      status: 'approved',
      category: 'grid',
      addedAt: now,
      approvedAt: now
    };

    // Insert after the first featured video to keep it at top
    const featuredIdx = data.videos.findIndex(v => v.category === 'featured' && v.status === 'approved');
    const insertAt = featuredIdx >= 0 ? featuredIdx + 1 : 0;
    data.videos.splice(insertAt, 0, video);

    console.log(`+ Added: [${entry.videoId}] ${title}`);
    addedCount++;
  }

  data.lastScan = now;
  writeFileSync(VIDEOS_JSON, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`Done — ${addedCount} new video(s) added to data/videos.json`);
}

main().catch(err => {
  console.error('Sync failed:', err.message);
  process.exit(1);
});
