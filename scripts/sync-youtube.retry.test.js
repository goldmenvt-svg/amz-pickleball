#!/usr/bin/env node
// Offline regression + resilience test suite for scripts/sync-youtube.js (R25.15-REV3 design).
// Runs entirely offline — no real network calls, no real timers longer than a few ms.
// Usage: node scripts/sync-youtube.retry.test.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
  fetchRSS,
  isRetryableStatus,
  computeBackoffMs,
  isValidAtomFeed,
  parseRSSEntries,
  extractYouTubeId,
  main,
} = require('./sync-youtube.js');

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

async function checkAsync(label, fn) {
  try {
    await fn();
    passCount++;
    console.log(`PASS: ${label}`);
  } catch (err) {
    failCount++;
    failures.push({ label, error: err.message });
    console.log(`FAIL: ${label} — ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Watchdog: independent of production timer deps, guarantees the test suite
// itself cannot hang forever if the code under test regresses.
// ─────────────────────────────────────────────────────────────────────────
function withWatchdog(promise, ms, label) {
  let watchdogTimer;
  const watchdog = new Promise((_, reject) => {
    watchdogTimer = setTimeout(() => {
      reject(new Error(`WATCHDOG TIMEOUT: ${label} did not settle within ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, watchdog]).finally(() => clearTimeout(watchdogTimer));
}

function instantSleep() {
  return Promise.resolve();
}

function makeOkResponse(body) {
  return { ok: true, status: 200, statusText: 'OK', text: async () => body };
}
function makeErrResponse(status, statusText) {
  return { ok: false, status, statusText: statusText || '' };
}

// Captures console.warn/error/log output for assertion, and guarantees restoration
// via the caller's try/finally even if an assertion inside the captured block throws.
function captureConsole() {
  const original = { warn: console.warn, error: console.error, log: console.log };
  const captured = { warn: [], error: [], log: [] };
  console.warn = (...args) => { captured.warn.push(args.join(' ')); };
  console.error = (...args) => { captured.error.push(args.join(' ')); };
  console.log = (...args) => { captured.log.push(args.join(' ')); };
  return {
    captured,
    restore: () => { console.warn = original.warn; console.error = original.error; console.log = original.log; },
  };
}

function makeTimerSpy() {
  let created = 0, cleared = 0;
  const active = new Set();
  return {
    setTimeout: (fn, ms) => {
      created++;
      const handle = setTimeout(fn, ms);
      active.add(handle);
      return handle;
    },
    clearTimeout: (handle) => {
      cleared++;
      if (!active.has(handle)) {
        throw new Error(`clearTimeout called with unknown/already-cleared handle: ${String(handle)}`);
      }
      active.delete(handle);
      return clearTimeout(handle);
    },
    counts: () => ({ created, cleared }),
    activeSize: () => active.size,
  };
}

const VALID_FEED = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>T</title><published>2026-01-01T00:00:00Z</published></entry></feed>';

async function run() {
  console.log('========================================');
  console.log('R25.06B REGRESSION SUITE (strict yt_<ID> fallback, 3 files, text-extracted)');
  console.log('========================================');
  runR25_06B_Regression();

  console.log('');
  console.log('========================================');
  console.log('HTTP RETRY / FAIL-FAST');
  console.log('========================================');
  await checkAsync('1. 200 immediately on first attempt', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return makeOkResponse(VALID_FEED); };
    const body = await fetchRSS({ fetch: fetchImpl, sleep: instantSleep });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 1);
  });

  await checkAsync('2. 404 then 200', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return calls === 1 ? makeErrResponse(404, 'Not Found') : makeOkResponse(VALID_FEED); };
    let sleeps = 0;
    const body = await fetchRSS({ fetch: fetchImpl, sleep: async () => { sleeps++; } });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 2);
    assert.strictEqual(sleeps, 1);
  });

  await checkAsync('2b. 429 then 200', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return calls === 1 ? makeErrResponse(429, 'Too Many Requests') : makeOkResponse(VALID_FEED); };
    const body = await fetchRSS({ fetch: fetchImpl, sleep: instantSleep });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 2);
  });

  await checkAsync('3. 500 then 200', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return calls === 1 ? makeErrResponse(500, 'Internal Server Error') : makeOkResponse(VALID_FEED); };
    const body = await fetchRSS({ fetch: fetchImpl, sleep: instantSleep });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 2);
  });

  await checkAsync('3b. 599 then 200 (full 5xx range retried)', async () => {
    assert.strictEqual(isRetryableStatus(599), true);
    let calls = 0;
    const fetchImpl = async () => { calls++; return calls === 1 ? makeErrResponse(599, 'Weird Server Error') : makeOkResponse(VALID_FEED); };
    const body = await fetchRSS({ fetch: fetchImpl, sleep: instantSleep });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 2);
  });

  await checkAsync('4. 404 continuously exhausts all 4 attempts', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return makeErrResponse(404, 'Not Found'); };
    let sleeps = 0;
    await assert.rejects(
      fetchRSS({ fetch: fetchImpl, sleep: async () => { sleeps++; } }),
      /after 4 attempts/
    );
    assert.strictEqual(calls, 4);
    assert.strictEqual(sleeps, 3);
  });

  await checkAsync('5. 500 continuously exhausts all 4 attempts', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return makeErrResponse(500, 'Internal Server Error'); };
    await assert.rejects(fetchRSS({ fetch: fetchImpl, sleep: instantSleep }), /after 4 attempts/);
    assert.strictEqual(calls, 4);
  });

  await checkAsync('6. HTTP 400 fails immediately, no retry', async () => {
    let calls = 0, sleeps = 0;
    const fetchImpl = async () => { calls++; return makeErrResponse(400, 'Bad Request'); };
    await assert.rejects(
      fetchRSS({ fetch: fetchImpl, sleep: async () => { sleeps++; } }),
      (err) => {
        assert.strictEqual(err.message, 'RSS fetch failed: 400 Bad Request');
        return true;
      }
    );
    assert.strictEqual(calls, 1);
    assert.strictEqual(sleeps, 0);
    assert.strictEqual(isRetryableStatus(400), false);
  });

  await checkAsync('7. HTTP 403 fails immediately, no retry', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return makeErrResponse(403, 'Forbidden'); };
    await assert.rejects(
      fetchRSS({ fetch: fetchImpl, sleep: instantSleep }),
      (err) => { assert.strictEqual(err.message, 'RSS fetch failed: 403 Forbidden'); return true; }
    );
    assert.strictEqual(calls, 1);
    assert.strictEqual(isRetryableStatus(403), false);
  });

  await checkAsync('7b. HTTP 302 fails immediately, no retry', async () => {
    let calls = 0;
    assert.strictEqual(isRetryableStatus(302), false);
    const fetchImpl = async () => { calls++; return makeErrResponse(302, 'Found'); };
    await assert.rejects(
      fetchRSS({ fetch: fetchImpl, sleep: instantSleep }),
      (err) => { assert.strictEqual(err.message, 'RSS fetch failed: 302 Found'); return true; }
    );
    assert.strictEqual(calls, 1);
  });

  await checkAsync('7c. HTTP 204 fails immediately, no retry, res.text() never called', async () => {
    let calls = 0, textCalled = false, sleeps = 0;
    assert.strictEqual(isRetryableStatus(204), false);
    const fetchImpl = async () => {
      calls++;
      return { ok: true, status: 204, statusText: 'No Content', text: async () => { textCalled = true; return VALID_FEED; } };
    };
    await assert.rejects(
      fetchRSS({ fetch: fetchImpl, sleep: async () => { sleeps++; } }),
      (err) => { assert.strictEqual(err.message, 'RSS fetch failed: 204 No Content'); return true; }
    );
    assert.strictEqual(calls, 1);
    assert.strictEqual(sleeps, 0);
    assert.strictEqual(textCalled, false, 'res.text() must not be called for a non-200 status');
  });

  await checkAsync('7d. HTTP 206 fails immediately even with a valid feed body — body is never read', async () => {
    let calls = 0, textCalled = false, sleeps = 0;
    assert.strictEqual(isRetryableStatus(206), false);
    const fetchImpl = async () => {
      calls++;
      return { ok: true, status: 206, statusText: 'Partial Content', text: async () => { textCalled = true; return VALID_FEED; } };
    };
    await assert.rejects(
      fetchRSS({ fetch: fetchImpl, sleep: async () => { sleeps++; } }),
      (err) => { assert.strictEqual(err.message, 'RSS fetch failed: 206 Partial Content'); return true; }
    );
    assert.strictEqual(calls, 1);
    assert.strictEqual(sleeps, 0);
    assert.strictEqual(textCalled, false, 'res.text() must not be called for a non-200 status, even with a valid-looking body available');
  });

  console.log('');
  console.log('========================================');
  console.log('NETWORK / BODY-READ');
  console.log('========================================');

  await checkAsync('8. Network exception then success', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; if (calls === 1) throw new Error('ECONNRESET'); return makeOkResponse(VALID_FEED); };
    const body = await fetchRSS({ fetch: fetchImpl, sleep: instantSleep });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 2);
  });

  await checkAsync('9. res.text() reject (non-abort) then success', async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) {
        return { ok: true, status: 200, statusText: 'OK', text: async () => { throw new Error('stream reset'); } };
      }
      return makeOkResponse(VALID_FEED);
    };
    const body = await fetchRSS({ fetch: fetchImpl, sleep: instantSleep });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 2);
  });

  console.log('');
  console.log('========================================');
  console.log('TIMEOUT TESTS (real short timers, watchdog-protected, no 15s real wait)');
  console.log('========================================');

  await checkAsync('10. Fetch not yet resolved -> abort -> attempt 2 succeeds', async () => {
    const events = { abortEventSeen: false, attemptCount: 0, order: [] };
    function makeHangingConnectionFetch() {
      let call = 0;
      return async function mockFetch(url, options) {
        call++;
        events.attemptCount = call;
        assert.ok(options.signal, 'fetch must receive an AbortSignal');
        if (call === 1) {
          events.order.push('fetch-called');
          return new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              events.abortEventSeen = true;
              events.order.push('abort');
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        }
        events.order.push('second-attempt');
        return makeOkResponse(VALID_FEED);
      };
    }
    const mockFetch = makeHangingConnectionFetch(); // created ONCE, reused across attempts
    const spy = makeTimerSpy();

    const body = await withWatchdog(
      fetchRSS({ fetch: mockFetch, sleep: instantSleep, timeoutMs: 20, setTimeout: spy.setTimeout, clearTimeout: spy.clearTimeout }),
      2000, 'fetch-phase timeout test'
    );

    assert.strictEqual(events.abortEventSeen, true);
    assert.strictEqual(events.attemptCount, 2);
    assert.deepStrictEqual(events.order, ['fetch-called', 'abort', 'second-attempt']);
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(spy.counts().created, spy.counts().cleared);
    assert.strictEqual(spy.activeSize(), 0);
  });

  await checkAsync('11. Fetch resolves but res.text() hangs -> abort -> attempt 2 succeeds', async () => {
    const events = {
      fetchResolved: false, bodyReadStarted: false, abortEventSeen: false,
      bodyRejectedFromAbort: false, attemptCount: 0, order: [],
    };
    function makeBodyHangingFetch() {
      let call = 0;
      return async function mockFetch(url, options) {
        call++;
        events.attemptCount = call;
        if (call === 1) {
          assert.ok(options.signal, 'fetch must receive an AbortSignal');
          events.fetchResolved = true;
          events.order.push('fetch-resolved');
          return {
            ok: true, status: 200, statusText: 'OK',
            text: () => {
              events.bodyReadStarted = true;
              events.order.push('body-started');
              return new Promise((resolve, reject) => {
                options.signal.addEventListener('abort', () => {
                  events.abortEventSeen = true;
                  events.order.push('abort');
                  const err = new Error('The operation was aborted');
                  err.name = 'AbortError';
                  events.bodyRejectedFromAbort = true;
                  reject(err);
                });
              });
            },
          };
        }
        events.order.push('second-attempt');
        return makeOkResponse(VALID_FEED);
      };
    }
    const bodyHangingFetch = makeBodyHangingFetch(); // created ONCE, reused across attempts (fixes REV2 bug)
    const spy = makeTimerSpy();

    const body = await withWatchdog(
      fetchRSS({ fetch: bodyHangingFetch, sleep: instantSleep, timeoutMs: 20, setTimeout: spy.setTimeout, clearTimeout: spy.clearTimeout }),
      2000, 'body-read timeout test'
    );

    assert.strictEqual(events.fetchResolved, true);
    assert.strictEqual(events.bodyReadStarted, true);
    assert.strictEqual(events.abortEventSeen, true);
    assert.strictEqual(events.bodyRejectedFromAbort, true);
    assert.strictEqual(events.attemptCount, 2);
    assert.deepStrictEqual(events.order, ['fetch-resolved', 'body-started', 'abort', 'second-attempt']);
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(spy.counts().created, spy.counts().cleared);
    assert.strictEqual(spy.activeSize(), 0);
  });

  await checkAsync('11b. timeoutMs=0 is honored via nullish coalescing, not silently defaulted by ||', async () => {
    // If `deps.timeoutMs || ATTEMPT_TIMEOUT_MS` were used instead of `??`, an injected 0
    // would be treated as falsy and silently replaced by the real 15000ms default — the
    // mock below would then never abort within the 500ms watchdog window and this test
    // would fail with a WATCHDOG TIMEOUT, correctly exposing the regression.
    const events = { attemptCount: 0 };
    function makeHangingFetch() {
      let call = 0;
      return async (url, options) => {
        call++;
        events.attemptCount = call;
        if (call === 1) {
          return new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
            });
          });
        }
        return makeOkResponse(VALID_FEED);
      };
    }
    const mockFetch = makeHangingFetch();
    const body = await withWatchdog(
      fetchRSS({ fetch: mockFetch, sleep: instantSleep, timeoutMs: 0 }),
      500, 'timeoutMs=0 nullish-coalescing test'
    );
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(events.attemptCount, 2);
  });

  console.log('');
  console.log('========================================');
  console.log('TIMER ACCOUNTING (created===cleared, activeSize===0, no double-clear) per branch');
  console.log('========================================');

  await checkAsync('12a. Timer accounting: success branch', async () => {
    const spy = makeTimerSpy();
    await fetchRSS({ fetch: async () => makeOkResponse(VALID_FEED), sleep: instantSleep, setTimeout: spy.setTimeout, clearTimeout: spy.clearTimeout });
    assert.strictEqual(spy.counts().created, spy.counts().cleared);
    assert.strictEqual(spy.activeSize(), 0);
  });

  await checkAsync('12b. Timer accounting: HTTP error (retry-then-success) branch', async () => {
    const spy = makeTimerSpy();
    let calls = 0;
    const fetchImpl = async () => { calls++; return calls === 1 ? makeErrResponse(500, 'x') : makeOkResponse(VALID_FEED); };
    await fetchRSS({ fetch: fetchImpl, sleep: instantSleep, setTimeout: spy.setTimeout, clearTimeout: spy.clearTimeout });
    assert.strictEqual(spy.counts().created, spy.counts().cleared);
    assert.strictEqual(spy.activeSize(), 0);
  });

  await checkAsync('12c. Timer accounting: network error branch', async () => {
    const spy = makeTimerSpy();
    let calls = 0;
    const fetchImpl = async () => { calls++; if (calls === 1) throw new Error('net'); return makeOkResponse(VALID_FEED); };
    await fetchRSS({ fetch: fetchImpl, sleep: instantSleep, setTimeout: spy.setTimeout, clearTimeout: spy.clearTimeout });
    assert.strictEqual(spy.counts().created, spy.counts().cleared);
    assert.strictEqual(spy.activeSize(), 0);
  });

  await checkAsync('12d. Timer accounting: fetch-phase timeout branch', async () => {
    const spy = makeTimerSpy();
    let call = 0;
    const fetchImpl = async (url, options) => {
      call++;
      if (call === 1) {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
          });
        });
      }
      return makeOkResponse(VALID_FEED);
    };
    await withWatchdog(
      fetchRSS({ fetch: fetchImpl, sleep: instantSleep, timeoutMs: 15, setTimeout: spy.setTimeout, clearTimeout: spy.clearTimeout }),
      2000, '12d'
    );
    assert.strictEqual(spy.counts().created, spy.counts().cleared);
    assert.strictEqual(spy.activeSize(), 0);
  });

  await checkAsync('12e. Timer accounting: body-phase timeout branch', async () => {
    const spy = makeTimerSpy();
    let call = 0;
    const fetchImpl = async (url, options) => {
      call++;
      if (call === 1) {
        return {
          ok: true, status: 200, statusText: 'OK',
          text: () => new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => {
              const err = new Error('aborted'); err.name = 'AbortError'; reject(err);
            });
          }),
        };
      }
      return makeOkResponse(VALID_FEED);
    };
    await withWatchdog(
      fetchRSS({ fetch: fetchImpl, sleep: instantSleep, timeoutMs: 15, setTimeout: spy.setTimeout, clearTimeout: spy.clearTimeout }),
      2000, '12e'
    );
    assert.strictEqual(spy.counts().created, spy.counts().cleared);
    assert.strictEqual(spy.activeSize(), 0);
  });

  await checkAsync('12f. Timer accounting: res.text() reject (non-abort) branch', async () => {
    const spy = makeTimerSpy();
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls === 1) return { ok: true, status: 200, statusText: 'OK', text: async () => { throw new Error('stream reset'); } };
      return makeOkResponse(VALID_FEED);
    };
    await fetchRSS({ fetch: fetchImpl, sleep: instantSleep, setTimeout: spy.setTimeout, clearTimeout: spy.clearTimeout });
    assert.strictEqual(spy.counts().created, spy.counts().cleared);
    assert.strictEqual(spy.activeSize(), 0);
  });

  console.log('');
  console.log('========================================');
  console.log('BACKOFF / JITTER BOUNDS');
  console.log('========================================');
  check('13a. attempt 1 min bound (random=0) === 1400', () => assert.strictEqual(computeBackoffMs(1, () => 0), 1400));
  check('13b. attempt 1 max bound (random=1) === 2600', () => assert.strictEqual(computeBackoffMs(1, () => 1), 2600));
  check('13c. attempt 2 min bound (random=0) === 2800', () => assert.strictEqual(computeBackoffMs(2, () => 0), 2800));
  check('13d. attempt 2 max bound (random=1) === 5200', () => assert.strictEqual(computeBackoffMs(2, () => 1), 5200));
  check('13e. attempt 3 min bound (random=0) === 5600', () => assert.strictEqual(computeBackoffMs(3, () => 0), 5600));
  check('13f. attempt 3 max bound (random=1) === 10000 (capped from 10400)', () => assert.strictEqual(computeBackoffMs(3, () => 1), 10000));

  console.log('');
  console.log('========================================');
  console.log('ATOM FEED VALIDATION');
  console.log('========================================');
  check('14a. Negative: HTML wrapping <feed> as substring', () => assert.strictEqual(isValidAtomFeed('<html><body><feed>x</feed></body></html>'), false));
  check('14b. Negative: text before <feed>', () => assert.strictEqual(isValidAtomFeed('garbage text <feed></feed>'), false));
  check('14c. Negative: garbage after </feed>', () => assert.strictEqual(isValidAtomFeed('<feed></feed>trailing garbage'), false));
  check('14d. Negative: only opening tag', () => assert.strictEqual(isValidAtomFeed('<feed>'), false));
  check('14e. Negative: only closing tag', () => assert.strictEqual(isValidAtomFeed('</feed>'), false));
  check('14f. Negative: empty body', () => assert.strictEqual(isValidAtomFeed(''), false));
  check('15a. Positive: standard feed', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="http://www.w3.org/2005/Atom"><entry></entry></feed>'), true));
  check('15b. Positive: with XML declaration', () => assert.strictEqual(isValidAtomFeed('<?xml version="1.0" encoding="UTF-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), true));
  check('15c. Positive: with BOM', () => assert.strictEqual(isValidAtomFeed('﻿<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), true));
  check('15d. Positive: zero-entry feed', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), true));
  check('15e. Positive: whitespace after closing tag', () => assert.strictEqual(isValidAtomFeed('<feed></feed>\n  '), true));
  check('14g. Negative: <FEED></FEED> uppercase root rejected (case-sensitive)', () => assert.strictEqual(isValidAtomFeed('<FEED></FEED>'), false));
  check('14h. Negative: <feed></FEED> mismatched-case closing tag rejected', () => assert.strictEqual(isValidAtomFeed('<feed></FEED>'), false));
  check('14i. Negative: <?XML ...?> malformed (uppercase) declaration rejected', () => assert.strictEqual(isValidAtomFeed('<?XML version="1.0"?><feed></feed>'), false));
  check('14j. Negative: <?xmlfoo?> is not a valid XML declaration boundary, must not be stripped', () => assert.strictEqual(isValidAtomFeed('<?xmlfoo?><feed></feed>'), false));
  check('14k. Negative: nested/unclosed <feed><feed></feed> rejected', () => assert.strictEqual(isValidAtomFeed('<feed><feed></feed>'), false));
  check('14l. Negative: <?xml?> missing mandatory version rejected', () => assert.strictEqual(isValidAtomFeed('<?xml?><feed></feed>'), false));
  check('14m. Negative: <?xml encoding="UTF-8"?> missing/out-of-order version rejected', () => assert.strictEqual(isValidAtomFeed('<?xml encoding="UTF-8"?><feed></feed>'), false));
  check('14n. Negative: <?xml foo?> arbitrary declaration content rejected', () => assert.strictEqual(isValidAtomFeed('<?xml foo?><feed></feed>'), false));
  check('14o. Negative: <?xml version="2.0"?> non-1.x version rejected', () => assert.strictEqual(isValidAtomFeed('<?xml version="2.0"?><feed></feed>'), false));
  check('14p. Negative: whitespace before XML declaration rejected', () => assert.strictEqual(isValidAtomFeed(' <?xml version="1.0"?><feed></feed>'), false));
  check('15f. Positive: <?xml version="1.0"?> minimal valid declaration', () => assert.strictEqual(isValidAtomFeed('<?xml version="1.0"?><feed></feed>'), true));
  check('15g. Positive: <?xml version=\'1.0\'?> single-quoted version', () => assert.strictEqual(isValidAtomFeed("<?xml version='1.0'?><feed></feed>"), true));
  check('15h. Positive: <?xml version="1.0" encoding="UTF-8"?> version+encoding', () => assert.strictEqual(isValidAtomFeed('<?xml version="1.0" encoding="UTF-8"?><feed></feed>'), true));
  check('15i. Positive: <?xml version="1.0" encoding="UTF-8" standalone="yes"?> full declaration', () => assert.strictEqual(isValidAtomFeed('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><feed></feed>'), true));
  check('15j. Positive: leading whitespace before root with no declaration', () => assert.strictEqual(isValidAtomFeed('  <feed></feed>'), true));

  console.log('');
  console.log('========================================');
  console.log('XML WHITESPACE STRICTNESS (only [ \\t\\r\\n] is XML whitespace — U+000B/U+000C/U+00A0 are not)');
  console.log('========================================');
  check('30. Negative: U+000B in place of the declaration separator rejected', () => assert.strictEqual(isValidAtomFeed('<?xmlversion="1.0"?><feed></feed>'), false));
  check('31. Negative: U+000C in place of the declaration separator rejected', () => assert.strictEqual(isValidAtomFeed('<?xmlversion="1.0"?><feed></feed>'), false));
  check('32. Negative: U+00A0 in place of the declaration separator rejected', () => assert.strictEqual(isValidAtomFeed('<?xml version="1.0"?><feed></feed>'), false));
  check('33. Negative: U+000B before root (no declaration) rejected', () => assert.strictEqual(isValidAtomFeed('<feed></feed>'), false));
  check('34. Negative: U+000C before root (no declaration) rejected', () => assert.strictEqual(isValidAtomFeed('<feed></feed>'), false));
  check('35. Negative: U+00A0 before root (no declaration) rejected', () => assert.strictEqual(isValidAtomFeed(' <feed></feed>'), false));
  check('36. Negative: U+000B between feed and attribute rejected', () => assert.strictEqual(isValidAtomFeed('<feedxmlns="http://www.w3.org/2005/Atom"></feed>'), false));
  check('37. Negative: U+000C between feed and attribute rejected', () => assert.strictEqual(isValidAtomFeed('<feedxmlns="http://www.w3.org/2005/Atom"></feed>'), false));
  check('38. Negative: U+00A0 between feed and attribute rejected', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), false));
  check('39. Negative: U+000B after closing root rejected', () => assert.strictEqual(isValidAtomFeed('<feed></feed>'), false));
  check('40. Negative: U+000C after closing root rejected', () => assert.strictEqual(isValidAtomFeed('<feed></feed>'), false));
  check('41. Negative: U+00A0 after closing root rejected', () => assert.strictEqual(isValidAtomFeed('<feed></feed> '), false));
  check('42. Positive: real tab as declaration separator still accepted', () => assert.strictEqual(isValidAtomFeed('<?xml\tversion="1.0"?><feed></feed>'), true));
  check('43. Positive: real CRLF before root (no declaration) still accepted', () => assert.strictEqual(isValidAtomFeed('\r\n<feed></feed>'), true));
  check('44. Positive: real tab between feed and attribute still accepted', () => assert.strictEqual(isValidAtomFeed('<feed\txmlns="http://www.w3.org/2005/Atom"></feed>'), true));
  check('45. Positive: real LF after closing root still accepted', () => assert.strictEqual(isValidAtomFeed('<feed></feed>\n'), true));

  console.log('');
  console.log('========================================');
  console.log('ROOT ATTRIBUTE WHITESPACE (entire attribute region validated, not just the first char after "feed")');
  console.log('========================================');
  check('50. Negative: U+000B after a valid leading space, before xmlns rejected', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x"></feed>'), false));
  check('51. Negative: U+000C after a valid leading space, before xmlns rejected', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x"></feed>'), false));
  check('52. Negative: U+00A0 after a valid leading space, before xmlns rejected', () => assert.strictEqual(isValidAtomFeed('<feed  xmlns="x"></feed>'), false));
  check('53. Negative: U+000B between two attributes rejected', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x"id="y"></feed>'), false));
  check('54. Negative: U+000C between two attributes rejected', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x"id="y"></feed>'), false));
  check('55. Negative: U+00A0 between two attributes rejected', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x" id="y"></feed>'), false));
  check('56. Negative: U+000B between last attribute and > rejected', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x"></feed>'), false));
  check('57. Negative: U+000C between last attribute and > rejected', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x"></feed>'), false));
  check('58. Negative: U+00A0 between last attribute and > rejected', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x" ></feed>'), false));
  check('59. Negative: nested <feed> with U+000B in its attribute region rejected', () => assert.strictEqual(isValidAtomFeed('<feed><feedxmlns="x"></feed>'), false));
  check('60. Negative: nested <feed> with U+000C in its attribute region rejected', () => assert.strictEqual(isValidAtomFeed('<feed><feedxmlns="x"></feed>'), false));
  check('61. Negative: nested <feed> with U+00A0 in its attribute region rejected', () => assert.strictEqual(isValidAtomFeed('<feed><feed xmlns="x"></feed>'), false));
  check('62. Positive: U+00A0 inside a quoted attribute value is content, not a separator, and is still valid', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x y"></feed>'), true));
  check('63. Positive: multiple real-space-separated attributes still valid', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x" id="y"></feed>'), true));
  check('64. Positive: real YouTube-shaped feed body still valid', () => assert.strictEqual(isValidAtomFeed(VALID_FEED), true));

  console.log('');
  console.log('========================================');
  console.log('ROOT ATTRIBUTE GRAMMAR (STag ::= "<feed" (S Attribute)* S? ">", Attribute ::= Name S? "=" S? AttValue)');
  console.log('========================================');
  // Built via String.fromCharCode (not raw literal bytes) so the exact codepoint under
  // test is unambiguous and auditable directly from the source.
  const U000B = String.fromCharCode(0x000B);
  const U000C = String.fromCharCode(0x000C);
  const U00A0 = String.fromCharCode(0x00A0);
  check('67. Negative: U+000B inside a quoted attribute value rejected', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x' + U000B + 'y"></feed>'), false));
  check('68. Negative: U+000C inside a quoted attribute value rejected', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x' + U000C + 'y"></feed>'), false));
  check('69. Negative: raw < inside a quoted attribute value rejected', () => assert.strictEqual(isValidAtomFeed('<feed x="a<b"></feed>'), false));
  check('70. Negative: bare attribute name with no "=value" rejected', () => assert.strictEqual(isValidAtomFeed('<feed foo></feed>'), false));
  check('71. Negative: unquoted attribute value rejected', () => assert.strictEqual(isValidAtomFeed('<feed foo=bar></feed>'), false));
  check('72. Negative: double "=" rejected', () => assert.strictEqual(isValidAtomFeed('<feed foo=="bar"></feed>'), false));
  check('73. Negative: orphan quoted value with no attribute name rejected', () => assert.strictEqual(isValidAtomFeed('<feed "bar"></feed>'), false));
  check('74. Positive: U+00A0 inside a quoted attribute value is a valid XML Char and still passes', () => assert.strictEqual(isValidAtomFeed('<feed xmlns="x' + U00A0 + 'y"></feed>'), true));
  check('75. Positive: whitespace-padded "=" and a single-quoted value still valid', () => assert.strictEqual(isValidAtomFeed('<feed xmlns = "x" id=\'y\'></feed>'), true));
  check('76. Positive: real YouTube-shaped feed body still valid under the full attribute grammar', () => assert.strictEqual(isValidAtomFeed(VALID_FEED), true));

  await checkAsync('16. HTTP 200 + empty body then valid feed', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return calls === 1 ? makeOkResponse('') : makeOkResponse(VALID_FEED); };
    const body = await fetchRSS({ fetch: fetchImpl, sleep: instantSleep });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 2);
  });

  await checkAsync('17. HTTP 200 + non-feed body then valid feed', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return calls === 1 ? makeOkResponse('<html>error page</html>') : makeOkResponse(VALID_FEED); };
    const body = await fetchRSS({ fetch: fetchImpl, sleep: instantSleep });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 2);
  });

  await checkAsync('18. HTTP 200 + invalid body 4 times in a row -> reject', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return makeOkResponse('not a feed'); };
    await assert.rejects(fetchRSS({ fetch: fetchImpl, sleep: instantSleep }), /after 4 attempts/);
    assert.strictEqual(calls, 4);
  });

  await checkAsync('28. Invalid XML declaration then valid feed — attempt 2 succeeds', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return calls === 1 ? makeOkResponse('<?xml foo?><feed></feed>') : makeOkResponse(VALID_FEED); };
    const body = await fetchRSS({ fetch: fetchImpl, sleep: instantSleep });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 2);
  });

  await checkAsync('29. Invalid XML declaration 4 times in a row -> reject, 4 fetches, 3 sleeps, no read/write', async () => {
    let calls = 0, sleeps = 0, readCalled = false, writeCalled = false;
    const fetchImpl = async () => { calls++; return makeOkResponse('<?xml version="2.0"?><feed></feed>'); };
    await assert.rejects(
      main({
        fetchRSS: () => fetchRSS({ fetch: fetchImpl, sleep: async () => { sleeps++; } }),
        readFileSync: () => { readCalled = true; return '{"videos":[]}'; },
        writeFileSync: () => { writeCalled = true; },
      }),
      /after 4 attempts/
    );
    assert.strictEqual(calls, 4);
    assert.strictEqual(sleeps, 3);
    assert.strictEqual(readCalled, false, 'readFileSync must not be called');
    assert.strictEqual(writeCalled, false, 'writeFileSync must not be called');
  });

  await checkAsync('46. Invalid-whitespace (U+000B) XML declaration then valid feed — attempt 2 succeeds', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return calls === 1 ? makeOkResponse('<?xmlversion="1.0"?><feed></feed>') : makeOkResponse(VALID_FEED); };
    const body = await fetchRSS({ fetch: fetchImpl, sleep: instantSleep });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 2);
  });

  await checkAsync('47. Invalid-whitespace (U+000B) XML declaration 4 times in a row -> reject, 4 fetches, 3 sleeps, no read/write', async () => {
    let calls = 0, sleeps = 0, readCalled = false, writeCalled = false;
    const fetchImpl = async () => { calls++; return makeOkResponse('<?xmlversion="1.0"?><feed></feed>'); };
    await assert.rejects(
      main({
        fetchRSS: () => fetchRSS({ fetch: fetchImpl, sleep: async () => { sleeps++; } }),
        readFileSync: () => { readCalled = true; return '{"videos":[]}'; },
        writeFileSync: () => { writeCalled = true; },
      }),
      /after 4 attempts/
    );
    assert.strictEqual(calls, 4);
    assert.strictEqual(sleeps, 3);
    assert.strictEqual(readCalled, false, 'readFileSync must not be called');
    assert.strictEqual(writeCalled, false, 'writeFileSync must not be called');
  });

  await checkAsync('65. Invalid root-attribute whitespace (U+000B between attributes) then valid feed — attempt 2 succeeds', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return calls === 1 ? makeOkResponse('<feed xmlns="x"id="y"></feed>') : makeOkResponse(VALID_FEED); };
    const body = await fetchRSS({ fetch: fetchImpl, sleep: instantSleep });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 2);
  });

  await checkAsync('66. Invalid root-attribute whitespace (U+000B between attributes) 4 times in a row -> reject, 4 fetches, 3 sleeps, no read/write', async () => {
    let calls = 0, sleeps = 0, readCalled = false, writeCalled = false;
    const fetchImpl = async () => { calls++; return makeOkResponse('<feed xmlns="x"id="y"></feed>'); };
    await assert.rejects(
      main({
        fetchRSS: () => fetchRSS({ fetch: fetchImpl, sleep: async () => { sleeps++; } }),
        readFileSync: () => { readCalled = true; return '{"videos":[]}'; },
        writeFileSync: () => { writeCalled = true; },
      }),
      /after 4 attempts/
    );
    assert.strictEqual(calls, 4);
    assert.strictEqual(sleeps, 3);
    assert.strictEqual(readCalled, false, 'readFileSync must not be called');
    assert.strictEqual(writeCalled, false, 'writeFileSync must not be called');
  });

  await checkAsync('77. Quoted U+000B in attribute value then valid feed — attempt 2 succeeds', async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; return calls === 1 ? makeOkResponse('<feed xmlns="x' + U000B + 'y"></feed>') : makeOkResponse(VALID_FEED); };
    const body = await fetchRSS({ fetch: fetchImpl, sleep: instantSleep });
    assert.strictEqual(body, VALID_FEED);
    assert.strictEqual(calls, 2);
  });

  await checkAsync('78. Quoted U+000B in attribute value 4 times in a row -> reject, 4 fetches, 3 sleeps, no read/write', async () => {
    let calls = 0, sleeps = 0, readCalled = false, writeCalled = false;
    const fetchImpl = async () => { calls++; return makeOkResponse('<feed xmlns="x' + U000B + 'y"></feed>'); };
    await assert.rejects(
      main({
        fetchRSS: () => fetchRSS({ fetch: fetchImpl, sleep: async () => { sleeps++; } }),
        readFileSync: () => { readCalled = true; return '{"videos":[]}'; },
        writeFileSync: () => { writeCalled = true; },
      }),
      /after 4 attempts/
    );
    assert.strictEqual(calls, 4);
    assert.strictEqual(sleeps, 3);
    assert.strictEqual(readCalled, false, 'readFileSync must not be called');
    assert.strictEqual(writeCalled, false, 'writeFileSync must not be called');
  });

  await checkAsync('79. Malformed root attribute (bare name) with an otherwise-valid entry, 4 times in a row -> reject, 4 fetches, 3 sleeps, no read/write', async () => {
    let calls = 0, sleeps = 0, readCalled = false, writeCalled = false;
    const malformedButHasValidEntry = '<feed foo><entry><yt:videoId>dQw4w9WgXcQ</yt:videoId><title>T</title><published>2026-01-01T00:00:00Z</published></entry></feed>';
    const fetchImpl = async () => { calls++; return makeOkResponse(malformedButHasValidEntry); };
    await assert.rejects(
      main({
        fetchRSS: () => fetchRSS({ fetch: fetchImpl, sleep: async () => { sleeps++; } }),
        readFileSync: () => { readCalled = true; return '{"videos":[]}'; },
        writeFileSync: () => { writeCalled = true; },
      }),
      /after 4 attempts/
    );
    assert.strictEqual(calls, 4);
    assert.strictEqual(sleeps, 3);
    assert.strictEqual(readCalled, false, 'readFileSync must not be called');
    assert.strictEqual(writeCalled, false, 'writeFileSync must not be called');
  });

  console.log('');
  console.log('========================================');
  console.log('LOGGING CORRECTNESS (exact retry/no-retry/sleep-count pattern across 4 failed attempts)');
  console.log('========================================');

  async function assertLoggingPattern(label, fetchImpl, expectFinalErrorSubstring) {
    await checkAsync(label, async () => {
      const cap = captureConsole();
      let sleeps = 0;
      try {
        await assert.rejects(
          fetchRSS({ fetch: fetchImpl, sleep: async () => { sleeps++; } }),
          /after 4 attempts/
        );
        const retryLines = cap.captured.warn.filter(l => l.includes('Retrying'));
        const noMoreLines = cap.captured.warn.filter(l => l.includes('No attempts remaining'));
        assert.strictEqual(retryLines.length, 3, `expected exactly 3 "Retrying" lines, got ${retryLines.length}: ${JSON.stringify(retryLines)}`);
        assert.strictEqual(noMoreLines.length, 1, `expected exactly 1 "No attempts remaining" line, got ${noMoreLines.length}`);
        assert.ok(noMoreLines[0].includes('Attempt 4/4'), `"No attempts remaining" line must be attempt 4/4, got: ${noMoreLines[0]}`);
        assert.ok(!noMoreLines[0].includes('Retrying'), 'attempt 4 line must not contain "Retrying"');
        assert.ok(retryLines.every(l => !l.includes('Attempt 4/4')), 'attempt 4 must never appear in a "Retrying" line');
        assert.strictEqual(sleeps, 3, `expected exactly 3 sleeps for 4 failed attempts, got ${sleeps}`);
        const errorLines = cap.captured.error.filter(l => l.includes('after 4 attempts'));
        assert.ok(errorLines.length >= 1, 'final error must be logged via console.error');
        assert.ok(errorLines[0].includes(expectFinalErrorSubstring), `final error must contain "${expectFinalErrorSubstring}", got: ${errorLines[0]}`);
      } finally {
        cap.restore();
      }
    });
  }

  await assertLoggingPattern('22. Logging: 404 x4 — 3 retries, attempt 4 says "No attempts remaining", 3 sleeps',
    async () => makeErrResponse(404, 'Not Found'), '404');

  await assertLoggingPattern('23. Logging: 500 x4 — 3 retries, attempt 4 says "No attempts remaining", 3 sleeps',
    async () => makeErrResponse(500, 'Internal Server Error'), '500');

  await assertLoggingPattern('24. Logging: network exception x4 — 3 retries, attempt 4 says "No attempts remaining", 3 sleeps',
    async () => { throw new Error('ECONNRESET'); }, 'ECONNRESET');

  await assertLoggingPattern('25. Logging: invalid content x4 — 3 retries, attempt 4 says "No attempts remaining", 3 sleeps',
    async () => makeOkResponse('not a feed'), 'invalid content');

  console.log('');
  console.log('========================================');
  console.log('WRITE PROTECTION (no readFileSync/writeFileSync on total failure)');
  console.log('========================================');

  await checkAsync('19. No readFileSync/writeFileSync when HTTP/network retries exhausted', async () => {
    let readCalled = false, writeCalled = false;
    await assert.rejects(
      main({
        fetchRSS: async () => { throw new Error('RSS fetch failed after 4 attempts: 500 Internal Server Error'); },
        readFileSync: () => { readCalled = true; return '{"videos":[]}'; },
        writeFileSync: () => { writeCalled = true; },
      }),
      /after 4 attempts/
    );
    assert.strictEqual(readCalled, false, 'readFileSync must not be called');
    assert.strictEqual(writeCalled, false, 'writeFileSync must not be called');
  });

  await checkAsync('20. No readFileSync/writeFileSync when invalid-content retries exhausted', async () => {
    let readCalled = false, writeCalled = false;
    await assert.rejects(
      main({
        fetchRSS: async () => { throw new Error('RSS fetch failed after 4 attempts: RSS fetch returned invalid content: Invalid or empty Atom feed body'); },
        readFileSync: () => { readCalled = true; return '{"videos":[]}'; },
        writeFileSync: () => { writeCalled = true; },
      }),
      /invalid content/
    );
    assert.strictEqual(readCalled, false, 'readFileSync must not be called');
    assert.strictEqual(writeCalled, false, 'writeFileSync must not be called');
  });

  console.log('');
  console.log('========================================');
  console.log('PENDING VIDEO METADATA (status/approvedAt invariant)');
  console.log('========================================');

  await checkAsync('80. main() writes a new video with status "pending" and approvedAt === null', async () => {
    let written = null;
    await main({
      fetchRSS: async () => VALID_FEED,
      readFileSync: () => JSON.stringify({ videos: [] }),
      writeFileSync: (_path, content) => { written = content; },
    });
    assert.ok(written, 'writeFileSync must have been called');
    const data = JSON.parse(written);
    assert.strictEqual(data.videos.length, 1);
    assert.strictEqual(data.videos[0].status, 'pending');
    assert.strictEqual(data.videos[0].approvedAt, null, 'a pending video must not carry a non-null approvedAt');
  });

  console.log('');
  console.log('========================================');
  console.log('GUARD (require does not auto-run main / no network)');
  console.log('========================================');
  await checkAsync('21. require(./sync-youtube.js) does not run main() or touch network', async () => {
    const { execFileSync } = require('child_process');
    const scriptPath = path.join(__dirname, 'sync-youtube.js');
    const out = execFileSync(process.execPath, ['-e', `require(${JSON.stringify(scriptPath)}); console.log('REQUIRE_OK_NO_MAIN_RUN');`], { timeout: 5000, encoding: 'utf-8' });
    assert.ok(out.includes('REQUIRE_OK_NO_MAIN_RUN'));
    assert.ok(!out.includes('Fetching AMZ YouTube RSS feed'), 'main() must NOT have run just from require()');
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
}

// ─────────────────────────────────────────────────────────────────────────
// R25.06B regression: strict yt_<ID> fallback regex, verified via literal
// text extraction from the real committed source of all 3 files (this
// inline regex is not — and per R25.06B scope must not become — an exported
// function, so extraction remains the correct verification method here,
// as established across R25.06B-REV1/REV2/REV3).
// Vectors recovered verbatim from the R25.06B-REV2 "EVIDENCE CORRECTION
// ONLY" round of this engagement — 1 positive + 13 negative, byte-checked
// with no duplicates (see R25.15-REV3 report).
// ─────────────────────────────────────────────────────────────────────────
function runR25_06B_Regression() {
  const repoRoot = path.resolve(__dirname, '..');
  const files = {
    'admin.html': fs.readFileSync(path.join(repoRoot, 'admin.html'), 'utf8'),
    'scripts/sync-youtube.js': fs.readFileSync(path.join(repoRoot, 'scripts', 'sync-youtube.js'), 'utf8'),
    'scripts/video-discover.js': fs.readFileSync(path.join(repoRoot, 'scripts', 'video-discover.js'), 'utf8'),
  };

  const lineRe = /v\.id\.match\((\/\^[\s\S]*?\$\/)\)/;
  const regexes = {};
  for (const [name, src] of Object.entries(files)) {
    const m = src.match(lineRe);
    if (!m) {
      console.log(`R25.06B regression: FAIL — could not locate v.id.match(...) pattern in ${name}`);
      process.exit(1);
    }
    const body = m[1].slice(1, m[1].lastIndexOf('/'));
    regexes[name] = new RegExp(body);
  }

  function runFallback(re, idValue) {
    const idMatch = typeof idValue === 'string' ? idValue.match(re) : null;
    return idMatch ? idMatch[1] : null;
  }

  const positive = ['yt_dQw4w9WgXcQ'];
  const positiveExpected = 'dQw4w9WgXcQ';
  const negative = [
    'dQw4w9WgXcQ',
    'abc_yt_dQw4w9WgXcQ',
    'yt_dQw4w9WgXcQ_extra',
    'yt_dQw4w9WgXc',
    'yt_dQw4w9WgXcQ1',
    ' yt_dQw4w9WgXcQ',
    'yt_dQw4w9WgXcQ ',
    'yt_',
    null,
    undefined,
    12345,
    {},
    [],
  ];

  assert.strictEqual(positive.length, 1);
  assert.strictEqual(negative.length, 13);
  // Defensive re-verification: no byte-identical duplicate between positive and negative.
  negative.forEach(v => assert.notStrictEqual(v, positive[0]));

  let total = 0, ok = 0;
  for (const [name, re] of Object.entries(regexes)) {
    for (const input of positive) {
      total++;
      const result = runFallback(re, input);
      if (result === positiveExpected) ok++;
      else console.log(`R25.06B regression FAIL: [${name}] positive input=${JSON.stringify(input)} got=${JSON.stringify(result)} expected=${JSON.stringify(positiveExpected)}`);
    }
    for (const input of negative) {
      total++;
      const result = runFallback(re, input);
      if (result === null) ok++;
      else console.log(`R25.06B regression FAIL: [${name}] negative input=${JSON.stringify(input)} got=${JSON.stringify(result)} expected=null`);
    }
  }

  assert.strictEqual(total, 42, `expected exactly 42 assertions, got ${total}`);

  if (ok === 42) {
    console.log('R25.06B regression: 42/42 passed');
    passCount += 42;
  } else {
    console.log(`R25.06B regression: ${ok}/42 passed`);
    failCount += (42 - ok);
    failures.push({ label: 'R25.06B regression', error: `${ok}/42 passed` });
  }
}

run().catch(err => {
  console.error('FATAL test runner error:', err);
  process.exit(1);
});
