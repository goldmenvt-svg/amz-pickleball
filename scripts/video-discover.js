#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.YOUTUBE_API_KEY;
const DATA_FILE = path.join(__dirname, '..', 'data', 'videos.json');

// ═══ SEARCH QUERIES ═══
// Group 1: AMZ & local — category default (no category field)
// Group 2: Pro/Featured — category "featured"

const AMZ_QUERIES = [
  { q: 'AMZ pickleball', priority: 1 },
  { q: '"AMZ Pickle Ball"', priority: 1 },
  { q: 'pickleball vũng tàu thi đấu', priority: 2 },
  { q: 'pickleball vung tau', priority: 2 },
  { q: 'pickleball tphcm thi đấu', priority: 3 },
  { q: 'pickleball hồ chí minh giải', priority: 3 },
  { q: 'pickleball việt nam giải đấu 2026', priority: 4 },
  { q: 'pickleball thi đấu việt nam hay', priority: 4 },
];

const FEATURED_QUERIES = [
  { q: 'PPA Tour pickleball finals 2026', priority: 1 },
  { q: 'PPA Tour singles final pickleball', priority: 1 },
  { q: 'PPA Tour Asia pickleball 2026', priority: 1 },
  { q: 'PPA Tour highlights best points', priority: 2 },
  { q: 'Ben Johns pickleball match 2026', priority: 2 },
  { q: 'Anna Leigh Waters pickleball final 2026', priority: 2 },
  { q: 'PVNA pickleball vietnam tournament', priority: 3 },
  { q: 'pickleball vietnam national championship', priority: 3 },
  { q: 'APP Tour pickleball final 2026', priority: 3 },
  { q: 'Major League Pickleball MLP 2026', priority: 4 },
];

// Known pro channels — videos from these auto-get category "featured"
const PRO_CHANNELS = [
  'ppa tour', 'ppa tour asia', 'ppa tour australia',
  'app tour', 'major league pickleball',
  'pickleball central vietnam', 'vietnam pickleball tv',
  'the kitchen pickleball', 'the dink pickleball',
  'pickleball channel', 'cbs sports', 'espn',
  'fpt play', 'htv thể thao',
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

function isProChannel(channelTitle) {
  var lower = channelTitle.toLowerCase();
  return PRO_CHANNELS.some(function(ch) { return lower.indexOf(ch) !== -1; });
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

async function youtubeSearchGlobal(query, publishedAfter) {
  var params = new URLSearchParams({
    part: 'snippet',
    q: query,
    type: 'video',
    order: 'relevance',
    maxResults: '10',
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
  var thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  var candidates = new Map();

  // ── AMZ & local searches (7 days, region VN) ──
  console.log('\n=== AMZ & Local Videos ===');
  for (var sq of AMZ_QUERIES) {
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
          _group: 'amz',
        });
      }
    } catch (err) {
      console.error('Error searching "' + sq.q + '":', err.message);
    }
  }

  // ── Featured / Pro searches (30 days, global) ──
  console.log('\n=== Featured / Pro Videos ===');
  for (var fq of FEATURED_QUERIES) {
    console.log('Searching: "' + fq.q + '" (priority ' + fq.priority + ')');
    try {
      var items = await youtubeSearchGlobal(fq.q, thirtyDaysAgo);
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
          priority: fq.priority,
          searchQuery: fq.q,
          _group: 'featured',
        });
      }
    } catch (err) {
      console.error('Error searching "' + fq.q + '":', err.message);
    }
  }

  if (!candidates.size) {
    console.log('\nNo new videos found.');
    return 0;
  }

  // ── Get video details (duration, views) ──
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

  var newAmz = [];
  var newFeatured = [];

  candidates.forEach(function(v) {
    var detail = detailsMap[v.platformId];
    if (!detail) return;

    var durationSec = parseDuration(detail.contentDetails.duration);
    if (durationSec < MIN_DURATION_SECONDS) return;

    v.duration = formatDuration(durationSec);
    v.viewCount = parseInt(detail.statistics.viewCount || 0);
    v.badge = '';
    v.addedAt = new Date().toISOString();
    v.approvedAt = null;

    var isFeaturedGroup = v._group === 'featured';
    var isFeaturedChannel = isProChannel(v.channelTitle);

    if (isFeaturedGroup || isFeaturedChannel) {
      v.category = 'featured';
      v.status = 'approved';
      v.badge = 'Thi đấu';
      v.approvedAt = new Date().toISOString();
      newFeatured.push(v);
    } else {
      v.status = 'pending';
      newAmz.push(v);
    }

    delete v._group;
    delete v.searchQuery;
  });

  newAmz.sort(function(a, b) {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.viewCount - a.viewCount;
  });

  newFeatured.sort(function(a, b) {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.viewCount - a.viewCount;
  });

  data.videos = data.videos.concat(newAmz).concat(newFeatured);
  data.lastScan = new Date().toISOString();

  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');

  console.log('\n=== Results ===');
  if (newAmz.length) {
    console.log('New AMZ/local pending: ' + newAmz.length);
    newAmz.forEach(function(v) {
      console.log('  [P' + v.priority + '] ' + v.title.substring(0, 70) + ' (' + v.duration + ', ' + v.viewCount + ' views)');
    });
  }
  if (newFeatured.length) {
    console.log('New Featured (auto-approved): ' + newFeatured.length);
    newFeatured.forEach(function(v) {
      console.log('  [P' + v.priority + '] ' + v.title.substring(0, 70) + ' (' + v.duration + ', ' + v.viewCount + ' views)');
    });
  }

  return newAmz.length + newFeatured.length;
}

discover().then(function(count) {
  console.log('\nDone. ' + count + ' new videos added.');
}).catch(function(err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
