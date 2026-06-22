#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.YOUTUBE_API_KEY;
const DATA_FILE = path.join(__dirname, '..', 'data', 'videos.json');

const SEARCH_QUERIES = [
  { q: 'AMZ pickleball', priority: 1 },
  { q: '"AMZ Pickle Ball"', priority: 1 },
  { q: 'pickleball vũng tàu thi đấu', priority: 2 },
  { q: 'pickleball vung tau', priority: 2 },
  { q: 'pickleball tphcm thi đấu', priority: 3 },
  { q: 'pickleball hồ chí minh giải', priority: 3 },
  { q: 'pickleball việt nam giải đấu 2026', priority: 4 },
  { q: 'pickleball thi đấu việt nam hay', priority: 4 },
];

const MIN_DURATION_SECONDS = 120;

const NEGATIVE_KEYWORDS = [
  'tử vong', 'đột tử', 'chết', 'ngã gục', 'ngã lăn',
  'tai nạn', 'cấp cứu', 'bệnh viện', 'khám nghiệm',
  'điều tra', 'xác minh vụ', 'ra đi mãi mãi',
];

function isNegativeContent(title, description) {
  var text = (title + ' ' + description).toLowerCase();
  return NEGATIVE_KEYWORDS.some(function(kw) { return text.indexOf(kw) !== -1; });
}

function parseDuration(iso) {
  var m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

function formatDuration(seconds) {
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = seconds % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}

async function youtubeSearch(query, publishedAfter) {
  var params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    order: 'date',
    maxResults: '10',
    regionCode: 'VN',
    relevanceLanguage: 'vi',
    publishedAfter: publishedAfter,
    key: API_KEY,
  });
  var res = await fetch('https://www.googleapis.com/youtube/v3/search?' + params);
  if (!res.ok) throw new Error('YouTube search failed: ' + res.status + ' ' + (await res.text()));
  return (await res.json()).items || [];
}

async function youtubeVideoDetails(videoIds) {
  if (!videoIds.length) return [];
  var params = new URLSearchParams({
    part: 'contentDetails,statistics',
    id: videoIds.join(','),
    key: API_KEY,
  });
  var res = await fetch('https://www.googleapis.com/youtube/v3/videos?' + params);
  if (!res.ok) throw new Error('YouTube details failed: ' + res.status);
  return (await res.json()).items || [];
}

async function discover() {
  if (!API_KEY) {
    console.error('YOUTUBE_API_KEY not set');
    process.exit(1);
  }

  var data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  var existingIds = new Set(data.videos.map(function(v) { return v.id; }));

  var sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  var candidates = new Map();

  for (var sq of SEARCH_QUERIES) {
    console.log('Searching: "' + sq.q + '" (priority ' + sq.priority + ')');
    try {
      var items = await youtubeSearch(sq.q, sevenDaysAgo);
      for (var item of items) {
        var vid = item.id.videoId;
        var key = 'yt_' + vid;
        if (existingIds.has(key) || candidates.has(key)) continue;
        if (isNegativeContent(item.snippet.title, item.snippet.description || '')) {
          console.log('  Skipped (negative): ' + item.snippet.title.substring(0, 60));
          continue;
        }
        candidates.set(key, {
          id: key,
          platform: 'youtube',
          platformId: vid,
          title: item.snippet.title,
          description: (item.snippet.description || '').substring(0, 200),
          channelTitle: item.snippet.channelTitle,
          thumbnail: item.snippet.thumbnails.medium
            ? item.snippet.thumbnails.medium.url
            : item.snippet.thumbnails.default.url,
          publishedAt: item.snippet.publishedAt.substring(0, 10),
          priority: sq.priority,
          searchQuery: sq.q,
        });
      }
    } catch (err) {
      console.error('Error searching "' + sq.q + '":', err.message);
    }
  }

  if (!candidates.size) {
    console.log('No new videos found.');
    return 0;
  }

  var videoIds = Array.from(candidates.values()).map(function(v) { return v.platformId; });
  var batchSize = 50;
  var detailsMap = {};

  for (var i = 0; i < videoIds.length; i += batchSize) {
    var batch = videoIds.slice(i, i + batchSize);
    var details = await youtubeVideoDetails(batch);
    for (var d of details) {
      detailsMap[d.id] = d;
    }
  }

  var newVideos = [];
  candidates.forEach(function(v) {
    var detail = detailsMap[v.platformId];
    if (!detail) return;

    var durationSec = parseDuration(detail.contentDetails.duration);
    if (durationSec < MIN_DURATION_SECONDS) return;

    v.duration = formatDuration(durationSec);
    v.viewCount = parseInt(detail.statistics.viewCount || 0);
    v.status = 'pending';
    v.badge = '';
    v.addedAt = new Date().toISOString();
    v.approvedAt = null;
    newVideos.push(v);
  });

  newVideos.sort(function(a, b) {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.viewCount - a.viewCount;
  });

  data.videos = data.videos.concat(newVideos);
  data.lastScan = new Date().toISOString();

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');

  console.log('\n=== Results ===');
  console.log('New pending videos: ' + newVideos.length);
  newVideos.forEach(function(v) {
    console.log('  [P' + v.priority + '] ' + v.title + ' (' + v.duration + ', ' + v.viewCount + ' views)');
  });

  return newVideos.length;
}

discover().then(function(count) {
  console.log('\nDone. ' + count + ' new videos added.');
}).catch(function(err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
