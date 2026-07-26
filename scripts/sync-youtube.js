#!/usr/bin/env node
// Auto-sync script: fetches AMZ YouTube RSS and updates data/videos.json
// Run by GitHub Actions daily — do not run manually unless testing

const { readFileSync, writeFileSync } = require('fs');
const { resolve } = require('path');

const VIDEOS_JSON = resolve(__dirname, '../data/videos.json');

const CHANNEL_ID = 'UCm3-CYZbJmFxet5cn10ULXA';
const RSS_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`;

// === RSS FETCH RESILIENCE (R25.15-REV3 design) ===
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 10000;
const JITTER_RATIO = 0.3;
const ATTEMPT_TIMEOUT_MS = 15000;

function isRetryableStatus(status) {
  return status === 404 || status === 429 || (status >= 500 && status <= 599);
}

function computeBackoffMs(attemptNumber, randomImpl = Math.random) {
  const rawExponential = BASE_DELAY_MS * 2 ** (attemptNumber - 1);
  const jitterRange = rawExponential * JITTER_RATIO;
  const jitter = jitterRange * (randomImpl() * 2 - 1);
  const jitteredDelay = rawExponential + jitter;
  const finalDelay = Math.min(MAX_DELAY_MS, Math.max(0, jitteredDelay));
  return Math.round(finalDelay);
}

async function defaultSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const XML_S_RE = /[ \t\r\n]/; // XML 1.0 "S" (whitespace) production — space/tab/CR/LF only
const XML_NAME_START_RE = /[A-Za-z_:]/;
const XML_NAME_CHAR_RE = /[A-Za-z0-9._:-]/;

// XML 1.0 "Char" production (§2.2): excludes most C0 controls (so U+000B/U+000C
// are NOT valid Chars) while including U+00A0 and ordinary text (0x20-0xD7FF).
function isXmlChar(cp) {
  return cp === 0x9 || cp === 0xA || cp === 0xD ||
    (cp >= 0x20 && cp <= 0xD7FF) ||
    (cp >= 0xE000 && cp <= 0xFFFD) ||
    (cp >= 0x10000 && cp <= 0x10FFFF);
}

// Parses a "<feed...>" start-tag beginning at s[pos] against the minimal grammar
//   STag       ::= '<feed' (S Attribute)* S? '>'
//   Attribute  ::= Name S? '=' S? AttValue
//   AttValue   ::= '"' Char* '"'  |  "'" Char* "'"     (no raw '<' inside; Char
//                                                        per the XML 1.0 Char
//                                                        production above, so
//                                                        U+000B/U+000C are
//                                                        rejected and U+00A0 is
//                                                        allowed)
// A bare Name with no "= AttValue", an unquoted value, a second "=", or an
// orphan quote with no preceding Name are all malformed and rejected. Returns
// the index just past the matching ">", or -1 if malformed, unterminated, or
// not actually "feed" (e.g. "<feedback>", a different, longer tag name).
function matchFeedStartTagEnd(s, pos) {
  if (s.slice(pos, pos + 5) !== '<feed') return -1;
  const boundary = s[pos + 5];
  if (boundary !== undefined && XML_NAME_CHAR_RE.test(boundary)) return -1;

  const len = s.length;
  let i = pos + 5;

  for (;;) {
    let sawS = false;
    while (i < len && XML_S_RE.test(s[i])) { i++; sawS = true; }

    if (i < len && s[i] === '>') return i + 1;
    if (!sawS || i >= len) return -1;

    // Attribute name: NameStartChar NameChar*
    if (!XML_NAME_START_RE.test(s[i])) return -1;
    i++;
    while (i < len && XML_NAME_CHAR_RE.test(s[i])) i++;

    // Eq ::= S? '=' S?
    while (i < len && XML_S_RE.test(s[i])) i++;
    if (i >= len || s[i] !== '=') return -1;
    i++;
    while (i < len && XML_S_RE.test(s[i])) i++;

    // AttValue ::= quote Char* quote — no raw '<', no invalid XML Char
    if (i >= len || (s[i] !== '"' && s[i] !== "'")) return -1;
    const q = s[i];
    i++;
    while (i < len && s[i] !== q) {
      if (s[i] === '<') return -1;
      const cp = s.codePointAt(i);
      if (!isXmlChar(cp)) return -1;
      i += cp > 0xFFFF ? 2 : 1;
    }
    if (i >= len) return -1; // unterminated quote
    i++; // consume closing quote
  }
}

// Minimal Atom feed structural validation — rejects empty/garbled HTTP-200 bodies
// without requiring a full XML parser. Deliberately does NOT require <entry>.
//
// XML whitespace (the "S" production, XML 1.0 §2.3) is exactly space/tab/CR/LF —
// NOT JS's \s or trim()/trimStart(), which also treat U+000B, U+000C, U+00A0 and
// other Unicode whitespace as whitespace even though XML does not. Every place
// below that matches XML-structural whitespace therefore uses the literal class
// [ \t\r\n]. The one exception is [\s\S] inside the comment-stripping regex, which
// means "any character" for arbitrary comment *content*, not whitespace matching.
function isValidAtomFeed(body) {
  if (typeof body !== 'string' || body.length === 0) return false;

  let s = body.charCodeAt(0) === 0xFEFF ? body.slice(1) : body;

  // An XML declaration, if present, must be the very first thing in the document —
  // no leading whitespace before it is accepted — and must match a strict minimal
  // grammar: mandatory version="1.x" first, then optional encoding="EncName", then
  // optional standalone="yes"/"no", in that order, single- or double-quoted. Anything
  // that merely starts with "<?xml" but doesn't match this grammar (missing version,
  // wrong order, version not 1.x, arbitrary content, illegal whitespace char, ...) is
  // deliberately left in place, which causes the root-tag match below to fail. If
  // there is no "<?xml" at position 0 at all (including the case of whitespace then
  // "<?xml"), no stripping is attempted here — plain leading whitespace before the
  // root tag is still fine.
  if (s.startsWith('<?xml')) {
    const declMatch = s.match(/^<\?xml[ \t\r\n]+version[ \t\r\n]*=[ \t\r\n]*(["'])1\.[0-9]+\1(?:[ \t\r\n]+encoding[ \t\r\n]*=[ \t\r\n]*(["'])[A-Za-z][A-Za-z0-9._-]*\2)?(?:[ \t\r\n]+standalone[ \t\r\n]*=[ \t\r\n]*(["'])(?:yes|no)\3)?[ \t\r\n]*\?>/);
    if (declMatch) {
      s = s.slice(declMatch[0].length);
    }
  }

  s = s.replace(/^([ \t\r\n]*<!--[\s\S]*?-->[ \t\r\n]*)*/, '');
  s = s.replace(/^[ \t\r\n]*/, '');

  const rootEnd = matchFeedStartTagEnd(s, 0); // case-sensitive: "<FEED>" must not pass; full attribute region validated, not just the first character after "feed"
  if (rootEnd === -1) return false;

  const afterRoot = s.slice(rootEnd);
  const closeIdx = afterRoot.search(/<\/feed>/); // case-sensitive: "</FEED>" must not pass
  if (closeIdx === -1) return false;

  // Reject nested/unclosed feed (e.g. "<feed><feed></feed>" or a malformed nested
  // start-tag like "<feed><feedxmlns=\"x\"></feed>"): if "<feed" appears again
  // before the first "</feed>", at a genuine tag-name boundary (next char is not a
  // Name-continuation character, so it isn't e.g. "<feedback>"), that closing tag
  // cannot legitimately belong to the root — reject regardless of whether the inner
  // attempt's own attribute syntax happens to be well-formed.
  const beforeClose = afterRoot.slice(0, closeIdx);
  if (/<feed(?![A-Za-z0-9._:-])/.test(beforeClose)) return false;

  const afterClose = afterRoot.slice(closeIdx + '</feed>'.length);
  if (/[^ \t\r\n]/.test(afterClose)) return false;

  return true;
}

// Performs exactly one fetch attempt. The timeout (via AbortController) covers the
// entire attempt — connection, status check, AND reading the response body — not just
// the initial fetch() call. The timer is only ever cleared in `finally`, so it stays
// live through res.text() and correctly aborts a stalled body read too.
async function fetchOnce(fetchImpl, timeoutMs, setTimeoutImpl, clearTimeoutImpl) {
  const controller = new AbortController();
  const timer = setTimeoutImpl(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(RSS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AMZ-Bot/1.0)' },
      signal: controller.signal,
    });

    if (res.status !== 200) {
      // Only an exact 200 is success. res.ok (any 2xx) is deliberately not used —
      // 204/206/other non-200 2xx must fail fast, not be read as a body.
      return { ok: false, kind: 'http', status: res.status, statusText: res.statusText };
    }

    const body = await res.text();
    if (!isValidAtomFeed(body)) {
      return { ok: false, kind: 'content', reason: 'Invalid or empty Atom feed body' };
    }

    return { ok: true, body };
  } catch (err) {
    if (err && err.name === 'AbortError') {
      throw new Error(`RSS fetch timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeoutImpl(timer);
  }
}

async function fetchRSS(deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const sleepImpl = deps.sleep || defaultSleep;
  const randomImpl = deps.random || Math.random;
  const timeoutMs = deps.timeoutMs ?? ATTEMPT_TIMEOUT_MS; // nullish coalescing: an injected 0 must not be overridden
  const setTimeoutImpl = deps.setTimeout || setTimeout;
  const clearTimeoutImpl = deps.clearTimeout || clearTimeout;

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const isLastAttempt = attempt === MAX_ATTEMPTS;
    let result;

    try {
      result = await fetchOnce(fetchImpl, timeoutMs, setTimeoutImpl, clearTimeoutImpl);
    } catch (err) {
      lastError = err;
      if (isLastAttempt) {
        console.warn(`[RSS fetch] Attempt ${attempt}/${MAX_ATTEMPTS} network/stream error: ${err.message}. No attempts remaining.`);
      } else {
        console.warn(`[RSS fetch] Attempt ${attempt}/${MAX_ATTEMPTS} network/stream error: ${err.message}. Retrying.`);
        const delay = computeBackoffMs(attempt, randomImpl);
        console.warn(`[RSS fetch] Waiting ${delay}ms before attempt ${attempt + 1}/${MAX_ATTEMPTS}...`);
        await sleepImpl(delay);
      }
      continue;
    }

    if (result.ok) return result.body;

    if (result.kind === 'http') {
      lastError = new Error(`RSS fetch failed: ${result.status} ${result.statusText}`);
      if (!isRetryableStatus(result.status)) {
        console.error(`[RSS fetch] Attempt ${attempt}/${MAX_ATTEMPTS} failed with non-retryable status ${result.status} ${result.statusText}. Not retrying.`);
        throw lastError;
      }
      if (isLastAttempt) {
        console.warn(`[RSS fetch] Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${result.status} ${result.statusText}. No attempts remaining.`);
      } else {
        console.warn(`[RSS fetch] Attempt ${attempt}/${MAX_ATTEMPTS} failed: ${result.status} ${result.statusText}. Retrying.`);
        const delay = computeBackoffMs(attempt, randomImpl);
        console.warn(`[RSS fetch] Waiting ${delay}ms before attempt ${attempt + 1}/${MAX_ATTEMPTS}...`);
        await sleepImpl(delay);
      }
    } else {
      lastError = new Error(`RSS fetch returned invalid content: ${result.reason}`);
      if (isLastAttempt) {
        console.warn(`[RSS fetch] Attempt ${attempt}/${MAX_ATTEMPTS} invalid content: ${result.reason}. No attempts remaining.`);
      } else {
        console.warn(`[RSS fetch] Attempt ${attempt}/${MAX_ATTEMPTS} invalid content: ${result.reason}. Retrying.`);
        const delay = computeBackoffMs(attempt, randomImpl);
        console.warn(`[RSS fetch] Waiting ${delay}ms before attempt ${attempt + 1}/${MAX_ATTEMPTS}...`);
        await sleepImpl(delay);
      }
    }
  }

  const finalError = new Error(`RSS fetch failed after ${MAX_ATTEMPTS} attempts: ${lastError.message}`);
  console.error(`[RSS fetch] ${finalError.message}`);
  throw finalError;
}
// === END RSS FETCH RESILIENCE ===

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

async function main(deps = {}) {
  const fetchRSSImpl = deps.fetchRSS || fetchRSS;
  const readFileSyncImpl = deps.readFileSync || readFileSync;
  const writeFileSyncImpl = deps.writeFileSync || writeFileSync;

  console.log('Fetching AMZ YouTube RSS feed…');
  const xml = await fetchRSSImpl();
  const rssEntries = parseRSSEntries(xml);
  console.log(`Found ${rssEntries.length} video(s) on channel.`);

  const data = JSON.parse(readFileSyncImpl(VIDEOS_JSON, 'utf-8'));

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
  writeFileSyncImpl(VIDEOS_JSON, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log(`Done — ${addedCount} new video(s) added to data/videos.json`);
}

module.exports = {
  fetchRSS,
  fetchOnce,
  isRetryableStatus,
  computeBackoffMs,
  isValidAtomFeed,
  parseRSSEntries,
  extractYouTubeId,
  makeTitle,
  main,
};

if (require.main === module) {
  main().catch(err => {
    console.error('Sync failed:', err.message);
    process.exit(1);
  });
}
