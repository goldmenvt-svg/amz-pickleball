#!/usr/bin/env node
// R25.06B quality + adversarial test suite for canonical YouTube ID normalization
// and strict video dedup in scripts/video-discover.js (kept consistent with
// admin.html and scripts/sync-youtube.js — see the shared
// "CANONICAL YOUTUBE ID NORMALIZATION" comment block in each file).
//
// Runs entirely offline: no network calls, no real workflow execution, no
// writes to data/videos.json. require('./video-discover.js') is safe because
// the file only runs discover() when invoked directly (require.main === module).
//
// Usage: node scripts/video-discover.quality.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { extractYouTubeId, buildExistingKeys, resolveYouTubeDedup } = require('./video-discover.js');

let passCount = 0;
let failCount = 0;
const failures = [];

function check(label, fn) {
  try {
    fn();
    passCount++;
    console.log(`PASS: ${label}`);
  } catch (err) {
    failCount++;
    failures.push({ label, error: err.message });
    console.log(`FAIL: ${label} — ${err.message}`);
  }
}

// Loads admin.html's copy of extractYouTubeId via source-text extraction (the
// block is browser-inline JS, not a Node export) and executes it in an
// isolated vm context so its behavior can be compared directly against
// video-discover.js's exported extractYouTubeId, verifying requirement 9
// ("logic in admin.html and video-discover.js must be consistent") behaviorally
// rather than by fragile byte-for-byte text diff (admin.html uses `var`,
// the Node scripts use `const` — textually different, behaviorally identical).
function loadAdminExtractYouTubeId() {
  const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const startMarker = '// === CANONICAL YOUTUBE ID NORMALIZATION';
  const endMarker = '// === END CANONICAL YOUTUBE ID NORMALIZATION ===';
  const startIdx = adminSrc.indexOf(startMarker);
  const endIdx = adminSrc.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('Could not locate CANONICAL YOUTUBE ID NORMALIZATION block in admin.html');
  }
  const block = adminSrc.slice(startIdx, endIdx + endMarker.length);
  const sandbox = { module: { exports: {} }, URL };
  vm.createContext(sandbox);
  vm.runInContext(block + '\nmodule.exports.extractYouTubeId = extractYouTubeId;', sandbox);
  if (typeof sandbox.module.exports.extractYouTubeId !== 'function') {
    throw new Error('admin.html block did not yield an extractYouTubeId function');
  }
  return sandbox.module.exports.extractYouTubeId;
}

// Loads admin.html's copies of buildExistingKeys/resolveYouTubeDedup (which
// depend on extractYouTubeId, defined earlier in the same source region) via
// source-text extraction + vm — same technique as loadAdminExtractYouTubeId()
// above, so the dedup tests below exercise admin.html's actual production
// code, not a hand-typed reimplementation of it.
function loadAdminDedupFunctions() {
  const adminSrc = fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8');
  const startMarker = '// === CANONICAL YOUTUBE ID NORMALIZATION';
  const endMarker = '// === END CANONICAL YOUTUBE DEDUP ===';
  const startIdx = adminSrc.indexOf(startMarker);
  const endIdx = adminSrc.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error('Could not locate CANONICAL YOUTUBE ID NORMALIZATION..DEDUP region in admin.html');
  }
  const block = adminSrc.slice(startIdx, endIdx + endMarker.length);
  const sandbox = { module: { exports: {} }, URL };
  vm.createContext(sandbox);
  vm.runInContext(
    block +
      '\nmodule.exports.buildExistingKeys = buildExistingKeys;' +
      '\nmodule.exports.resolveYouTubeDedup = resolveYouTubeDedup;',
    sandbox
  );
  if (typeof sandbox.module.exports.buildExistingKeys !== 'function' ||
      typeof sandbox.module.exports.resolveYouTubeDedup !== 'function') {
    throw new Error('admin.html block did not yield buildExistingKeys/resolveYouTubeDedup functions');
  }
  return sandbox.module.exports;
}

const RAW_ID = 'dQw4w9WgXcQ';
const MIXED_CASE_ID = 'aB3-_dE5xy1'; // exercises upper/lower/digit/hyphen/underscore together

console.log('========================================');
console.log('QUALITY — canonical ID normalization (raw, URL forms, case)');
console.log('========================================');

check('Q1. Raw 11-char ID returned unchanged', () => {
  assert.strictEqual(extractYouTubeId(RAW_ID), RAW_ID);
});

check('Q2. watch?v= URL, including with extra trailing params', () => {
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/watch?v=${RAW_ID}`), RAW_ID);
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/watch?v=${RAW_ID}&t=30s`), RAW_ID);
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/watch?list=PL123&v=${RAW_ID}`), RAW_ID);
});

check('Q3. youtu.be/ short URL, including with a query string', () => {
  assert.strictEqual(extractYouTubeId(`https://youtu.be/${RAW_ID}`), RAW_ID);
  assert.strictEqual(extractYouTubeId(`https://youtu.be/${RAW_ID}?t=10`), RAW_ID);
});

check('Q4. shorts/ URL', () => {
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/shorts/${RAW_ID}`), RAW_ID);
});

check('Q5. embed/ URL', () => {
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/embed/${RAW_ID}`), RAW_ID);
});

check('Q6. live/ URL', () => {
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/live/${RAW_ID}`), RAW_ID);
});

check('Q7. Scheme-less bare-domain input still resolves (https:// implied)', () => {
  assert.strictEqual(extractYouTubeId(`youtu.be/${RAW_ID}`), RAW_ID);
  assert.strictEqual(extractYouTubeId(`www.youtube.com/watch?v=${RAW_ID}`), RAW_ID);
  assert.strictEqual(extractYouTubeId(`youtube.com/shorts/${RAW_ID}`), RAW_ID);
});

check('Q8. ID case is preserved exactly — never lowercased/uppercased', () => {
  assert.strictEqual(extractYouTubeId(MIXED_CASE_ID), MIXED_CASE_ID);
  assert.strictEqual(extractYouTubeId(`https://youtu.be/${MIXED_CASE_ID}`), MIXED_CASE_ID);
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/watch?v=${MIXED_CASE_ID}`), MIXED_CASE_ID);
  assert.notStrictEqual(extractYouTubeId(MIXED_CASE_ID), MIXED_CASE_ID.toLowerCase());
});

check('Q9. Host matching is case-insensitive (only the host, never the ID)', () => {
  assert.strictEqual(extractYouTubeId(`https://WWW.YOUTUBE.COM/watch?v=${RAW_ID}`), RAW_ID);
  assert.strictEqual(extractYouTubeId(`https://YouTu.Be/${RAW_ID}`), RAW_ID);
});

console.log('');
console.log('========================================');
console.log('QUALITY — strict yt_<ID> fallback (buildExistingKeys)');
console.log('========================================');

check('Q10. Fallback accepted only on an exact yt_<11-char-ID> match; rejected on near-misses', () => {
  const viaFallback = buildExistingKeys([
    { platform: 'youtube', platformId: 'not-a-valid-id!!', id: `yt_${RAW_ID}`, status: 'approved' },
  ]);
  assert.strictEqual(viaFallback.size, 1);
  assert.ok(viaFallback.has(`youtube:${RAW_ID}`));

  const missingUnderscore = buildExistingKeys([
    { platform: 'youtube', platformId: 'not-a-valid-id!!', id: `yt${RAW_ID}`, status: 'approved' },
  ]);
  assert.strictEqual(missingUnderscore.size, 0);

  const extraSuffix = buildExistingKeys([
    { platform: 'youtube', platformId: 'not-a-valid-id!!', id: `yt_${RAW_ID}extra`, status: 'approved' },
  ]);
  assert.strictEqual(extraSuffix.size, 0);

  const platformIdWins = buildExistingKeys([
    { platform: 'youtube', platformId: MIXED_CASE_ID, id: `yt_${RAW_ID}`, status: 'approved' },
  ]);
  assert.strictEqual(platformIdWins.size, 1);
  assert.ok(platformIdWins.has(`youtube:${MIXED_CASE_ID}`), 'platformId must be preferred over the .id fallback');
});

console.log('');
console.log('========================================');
console.log('QUALITY — duplicate detection across ALL statuses, and within one batch');
console.log('========================================');

check('Q11. Dedup set spans approved + pending + rejected videos', () => {
  const existing = [
    { platform: 'youtube', platformId: 'AAAAAAAAAAA', id: 'yt_AAAAAAAAAAA', status: 'approved' },
    { platform: 'youtube', platformId: 'BBBBBBBBBBB', id: 'yt_BBBBBBBBBBB', status: 'pending' },
    { platform: 'youtube', platformId: 'CCCCCCCCCCC', id: 'yt_CCCCCCCCCCC', status: 'rejected' },
    { platform: 'tiktok', platformId: '1234567890123456789', id: 'tt_1234567890123456789', status: 'approved' },
  ];
  const keys = buildExistingKeys(existing);
  assert.strictEqual(keys.size, 3, 'non-youtube platforms must not produce youtube: keys');
  assert.ok(keys.has('youtube:AAAAAAAAAAA'));
  assert.ok(keys.has('youtube:BBBBBBBBBBB'));
  assert.ok(keys.has('youtube:CCCCCCCCCCC'));

  // A previously REJECTED video must still block re-discovery of the same ID —
  // this is the core anti-duplicate guarantee, not just "don't re-approve".
  const rejectedAgain = resolveYouTubeDedup(keys, 'CCCCCCCCCCC');
  assert.strictEqual(rejectedAgain.ok, false);
  assert.strictEqual(rejectedAgain.reason, 'duplicate');
});

check('Q12. A duplicate within the same discovery batch is blocked immediately, even across URL forms', () => {
  const existingKeys = buildExistingKeys([]); // fresh Set, mirrors a real run with no prior videos of this ID
  const first = resolveYouTubeDedup(existingKeys, RAW_ID);
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.key, `youtube:${RAW_ID}`);
  existingKeys.add(first.key); // mirrors discover()'s existingKeys.add(key) immediately on acceptance

  const secondSameForm = resolveYouTubeDedup(existingKeys, RAW_ID);
  assert.strictEqual(secondSameForm.ok, false);
  assert.strictEqual(secondSameForm.reason, 'duplicate');

  const secondDifferentForm = resolveYouTubeDedup(existingKeys, `https://www.youtube.com/watch?v=${RAW_ID}`);
  assert.strictEqual(secondDifferentForm.ok, false, 'canonicalization must catch the same video re-offered via a different URL shape');
  assert.strictEqual(secondDifferentForm.reason, 'duplicate');
});

console.log('');
console.log('========================================');
console.log('QUALITY — admin.html / video-discover.js consistency (behavioral, via vm)');
console.log('========================================');

check('Q13. admin.html extractYouTubeId agrees with video-discover.js on every shared vector', () => {
  const adminExtractYouTubeId = loadAdminExtractYouTubeId();
  const vectors = [
    RAW_ID,
    MIXED_CASE_ID,
    `https://www.youtube.com/watch?v=${RAW_ID}`,
    `https://youtu.be/${RAW_ID}`,
    `https://www.youtube.com/shorts/${RAW_ID}`,
    `https://www.youtube.com/embed/${RAW_ID}`,
    `https://www.youtube.com/live/${RAW_ID}`,
    `youtu.be/${RAW_ID}`,
    `https://WWW.YOUTUBE.COM/watch?v=${RAW_ID}`,
    'dQw4w9WgXc',        // too short
    'dQw4w9WgXcQz',       // too long
    'dQw4w9WgXc!',        // forbidden char
    'https://vimeo.com/dQw4w9WgXcQ', // wrong host
    'https://www.youtube.com/watch?v=', // empty v param
    'http://',            // throws inside URL constructor
    null, undefined, 12345, {}, [],
  ];
  for (const v of vectors) {
    const a = adminExtractYouTubeId(v);
    const b = extractYouTubeId(v);
    assert.strictEqual(a, b, `mismatch for input=${JSON.stringify(v)}: admin.html=${JSON.stringify(a)} video-discover.js=${JSON.stringify(b)}`);
  }
});

console.log('');
console.log('========================================');
console.log('QUALITY — admin.html dedup mechanism (Set format, fallback, cross-status, batch-update)');
console.log('========================================');

check('Q14. admin.html buildExistingKeys produces keys in the exact "youtube:<canonicalId>" format', () => {
  const admin = loadAdminDedupFunctions();
  const keys = admin.buildExistingKeys([
    { platform: 'youtube', platformId: 'dQw4w9WgXcQ', id: 'yt_dQw4w9WgXcQ', status: 'approved' },
  ]);
  // Object.prototype.toString is realm-agnostic (unlike `instanceof Set`,
  // which fails here because the vm sandbox has its own Set constructor from
  // a separate realm — a test-harness detail, not a production concern).
  assert.strictEqual(Object.prototype.toString.call(keys), '[object Set]', 'buildExistingKeys must return a real Set');
  assert.strictEqual(keys.size, 1);
  assert.ok(keys.has('youtube:dQw4w9WgXcQ'), 'expected the literal key "youtube:dQw4w9WgXcQ"');
});

check('Q15. admin.html strict yt_<ID> fallback: exact match accepted, near-misses rejected', () => {
  const admin = loadAdminDedupFunctions();

  const exact = admin.buildExistingKeys([
    { platform: 'youtube', platformId: 'not-a-valid-id!!', id: 'yt_dQw4w9WgXcQ', status: 'pending' },
  ]);
  assert.strictEqual(exact.size, 1);
  assert.ok(exact.has('youtube:dQw4w9WgXcQ'));

  const missingUnderscore = admin.buildExistingKeys([
    { platform: 'youtube', platformId: 'not-a-valid-id!!', id: 'ytdQw4w9WgXcQ', status: 'pending' },
  ]);
  assert.strictEqual(missingUnderscore.size, 0, '"yt" without the underscore must not fall back');

  const platformIdWins = admin.buildExistingKeys([
    { platform: 'youtube', platformId: 'aB3-_dE5xy1', id: 'yt_dQw4w9WgXcQ', status: 'approved' },
  ]);
  assert.strictEqual(platformIdWins.size, 1);
  assert.ok(platformIdWins.has('youtube:aB3-_dE5xy1'), 'platformId must be preferred over the .id fallback');
});

check('Q16. admin.html dedup set spans approved + pending + rejected, and a rejected video still blocks re-discovery', () => {
  const admin = loadAdminDedupFunctions();
  const keys = admin.buildExistingKeys([
    { platform: 'youtube', platformId: 'AAAAAAAAAAA', id: 'yt_AAAAAAAAAAA', status: 'approved' },
    { platform: 'youtube', platformId: 'BBBBBBBBBBB', id: 'yt_BBBBBBBBBBB', status: 'pending' },
    { platform: 'youtube', platformId: 'CCCCCCCCCCC', id: 'yt_CCCCCCCCCCC', status: 'rejected' },
  ]);
  assert.strictEqual(keys.size, 3);
  assert.ok(keys.has('youtube:AAAAAAAAAAA'));
  assert.ok(keys.has('youtube:BBBBBBBBBBB'));
  assert.ok(keys.has('youtube:CCCCCCCCCCC'));

  const rejectedAgain = admin.resolveYouTubeDedup(keys, 'CCCCCCCCCCC');
  assert.strictEqual(rejectedAgain.ok, false);
  assert.strictEqual(rejectedAgain.reason, 'duplicate');
});

check('Q17. admin.html fallback rejects prefix/suffix padding glued onto the yt_<ID> token', () => {
  const admin = loadAdminDedupFunctions();

  const suffixPadded = admin.buildExistingKeys([
    { platform: 'youtube', platformId: 'not-a-valid-id!!', id: 'yt_dQw4w9WgXcQextra', status: 'approved' },
  ]);
  assert.strictEqual(suffixPadded.size, 0, 'a suffix glued onto the 11-char token must not fall back');

  const prefixPadded = admin.buildExistingKeys([
    { platform: 'youtube', platformId: 'not-a-valid-id!!', id: 'abc_yt_dQw4w9WgXcQ', status: 'approved' },
  ]);
  assert.strictEqual(prefixPadded.size, 0, 'a prefix glued before "yt_" must not fall back');
});

check('Q18. admin.html: the Set is updated immediately on acceptance and blocks a same-pass duplicate', () => {
  const admin = loadAdminDedupFunctions();
  const keys = admin.buildExistingKeys([]); // fresh Set, mirrors buildExistingKeys(videoData.videos) with no prior match

  const first = admin.resolveYouTubeDedup(keys, 'dQw4w9WgXcQ');
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.key, 'youtube:dQw4w9WgXcQ');
  keys.add(first.key); // mirrors addManualVideo()'s existingKeys.add(dedup.key) on acceptance

  const second = admin.resolveYouTubeDedup(keys, 'dQw4w9WgXcQ');
  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.reason, 'duplicate');

  const secondDifferentForm = admin.resolveYouTubeDedup(keys, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.strictEqual(secondDifferentForm.ok, false, 'canonicalization must catch the same video re-offered via a different URL shape');
  assert.strictEqual(secondDifferentForm.reason, 'duplicate');
});

check('Q19. admin.html and video-discover.js dedup mechanisms agree on every shared scenario', () => {
  const admin = loadAdminDedupFunctions();
  const sharedVideos = [
    { platform: 'youtube', platformId: 'AAAAAAAAAAA', id: 'yt_AAAAAAAAAAA', status: 'approved' },
    { platform: 'youtube', platformId: 'not-a-valid-id!!', id: 'yt_BBBBBBBBBBB', status: 'pending' }, // fallback path
    { platform: 'youtube', platformId: 'not-a-valid-id!!', id: 'yt_CCCCCCCCCCCextra', status: 'rejected' }, // must NOT yield a key
    { platform: 'tiktok', platformId: '1234567890123456789', id: 'tt_1234567890123456789', status: 'approved' },
    null, // malformed entry — both implementations must skip it, not throw
  ];

  // Both sides are the REAL production functions: admin.* extracted from
  // admin.html via vm above; buildExistingKeys/resolveYouTubeDedup imported
  // at the top of this file are video-discover.js's actual exports.
  const adminKeys = admin.buildExistingKeys(sharedVideos);
  const scriptKeys = buildExistingKeys(sharedVideos);
  assert.deepStrictEqual(Array.from(adminKeys).sort(), Array.from(scriptKeys).sort());

  const candidates = [
    'AAAAAAAAAAA',
    'BBBBBBBBBBB',
    'DDDDDDDDDDD',
    `https://www.youtube.com/watch?v=AAAAAAAAAAA`,
    'not-a-valid-id',
    null,
    undefined,
  ];
  for (const c of candidates) {
    const a = admin.resolveYouTubeDedup(adminKeys, c);
    const b = resolveYouTubeDedup(scriptKeys, c);
    assert.strictEqual(a.ok, b.ok, `ok mismatch for candidate=${JSON.stringify(c)}`);
    assert.strictEqual(a.reason, b.reason, `reason mismatch for candidate=${JSON.stringify(c)}`);
    assert.strictEqual(a.canonicalId, b.canonicalId, `canonicalId mismatch for candidate=${JSON.stringify(c)}`);
    assert.strictEqual(a.key, b.key, `key mismatch for candidate=${JSON.stringify(c)}`);
  }
});

console.log('');
console.log('========================================');
console.log('ADVERSARIAL — must reject malformed/partial/oversized/forbidden input');
console.log('========================================');

check('A1. Partial ID / substring match rejected (no partial-match leniency)', () => {
  assert.strictEqual(extractYouTubeId(`X${RAW_ID}X`), null);
  assert.strictEqual(extractYouTubeId(`prefix_${RAW_ID}`), null);
  assert.strictEqual(extractYouTubeId(`${RAW_ID}_suffix`), null);
  assert.strictEqual(extractYouTubeId(RAW_ID.slice(0, 8)), null, 'a genuine substring of a valid ID must not match');
});

check('A2. ID too short (<11 chars) rejected, raw and inside a URL', () => {
  assert.strictEqual(extractYouTubeId(RAW_ID.slice(0, 10)), null);
  assert.strictEqual(extractYouTubeId('a'), null);
  assert.strictEqual(extractYouTubeId(''), null);
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/watch?v=${RAW_ID.slice(0, 10)}`), null);
});

check('A3. ID too long (>11 chars) rejected, raw and inside a URL', () => {
  assert.strictEqual(extractYouTubeId(`${RAW_ID}z`), null);
  assert.strictEqual(extractYouTubeId(`${RAW_ID}zzzzzzzzzz`), null);
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/watch?v=${RAW_ID}z`), null);
});

check('A4. Extra prefix/suffix glued directly onto the ID token rejected (not a separate path segment)', () => {
  // Glued onto the query VALUE itself (not a separate "/"-delimited segment) — rejected.
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/watch?v=${RAW_ID}-extra`), null);
  // Glued onto the shorts/embed path segment with no "/" separator — rejected.
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/shorts/${RAW_ID}extra`), null);
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/embed/prefix${RAW_ID}`), null);
  // Contrast: a genuinely separate path segment after a youtu.be short link is
  // legitimate URL structure, not a "suffix on the ID" — this must still resolve.
  assert.strictEqual(extractYouTubeId(`https://youtu.be/${RAW_ID}/some-title-slug`), RAW_ID);
});

check('A5. Forbidden characters rejected (only [A-Za-z0-9_-] is valid)', () => {
  assert.strictEqual(extractYouTubeId('dQw4w9WgXc!'), null);
  assert.strictEqual(extractYouTubeId('dQw4w9WgX c'), null, 'internal whitespace is not trimmed away');
  assert.strictEqual(extractYouTubeId('dQw4w9WgXc.'), null);
  assert.strictEqual(extractYouTubeId('dQw4w9WgXc/'), null);
  assert.strictEqual(extractYouTubeId(`https://www.youtube.com/watch?v=dQw4w9WgXc!`), null);
});

check('A6. Malformed URLs, wrong host, empty ID, and non-string input rejected', () => {
  assert.strictEqual(extractYouTubeId('https://vimeo.com/dQw4w9WgXcQ'), null, 'non-YouTube host');
  assert.strictEqual(extractYouTubeId('https://www.youtube.com/watch?v='), null, 'empty v param');
  assert.strictEqual(extractYouTubeId('https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx'), null, 'unrecognized path shape');
  assert.strictEqual(extractYouTubeId('http://'), null, 'throws inside the URL constructor, must be caught');
  assert.strictEqual(extractYouTubeId(null), null);
  assert.strictEqual(extractYouTubeId(undefined), null);
  assert.strictEqual(extractYouTubeId(12345), null);
  assert.strictEqual(extractYouTubeId({}), null);
  assert.strictEqual(extractYouTubeId([]), null);
});

console.log('');
console.log('========================================');
console.log('GUARD — require() must not run discover() or touch network/filesystem writes');
console.log('========================================');

check('G1. require(./video-discover.js) does not invoke discover()', () => {
  const { execFileSync } = require('child_process');
  const scriptPath = path.join(__dirname, 'video-discover.js');
  const out = execFileSync(process.execPath, ['-e', `require(${JSON.stringify(scriptPath)}); console.log('REQUIRE_OK_NO_DISCOVER_RUN');`], { timeout: 5000, encoding: 'utf-8' });
  assert.ok(out.includes('REQUIRE_OK_NO_DISCOVER_RUN'));
  assert.ok(!out.includes('AMZ & Local Videos'), 'discover() must NOT have run just from require()');
});

console.log('');
console.log('========================================');
console.log(`SUMMARY: ${passCount} passed, ${failCount} failed`);
console.log('========================================');
if (failCount > 0) {
  console.log('FAILURES:');
  failures.forEach(f => console.log(`  - ${f.label}: ${f.error}`));
  process.exit(1);
}
