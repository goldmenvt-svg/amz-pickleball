'use strict';

/*
 * AMZ PreToolUse safety hook.
 * Conservative scanner (not a full shell parser) for Bash / PowerShell / Edit / Write.
 * Pure classification functions are exported for testing; only require.main runs stdin/stdout glue.
 */

const os = require('os');

// ===================== Constants =====================

const MAX_COMMAND_LENGTH = 4000;
const MAX_FILE_PATH_LENGTH = 1024;
const MAX_SEGMENTS = 20;
const MAX_WRAPPER_DEPTH = 6;
const MAX_PACKAGE_JSON_SIZE = 10 * 1024;

const RULE = {
  TAMPER: 'AMZ-SAFETY-CONTROL-TAMPER',
  GIT_PUSH: 'AMZ-GIT-PUSH',
  PROD_DEPLOY: 'AMZ-PROD-DEPLOY',
  PUBLISH: 'AMZ-PACKAGE-PUBLISH',
  DELETE: 'AMZ-DESTRUCTIVE-DELETE',
  SECRET: 'AMZ-SECRET-ACCESS',
  EGRESS: 'AMZ-EXTERNAL-EGRESS',
  COMPLEX: 'AMZ-COMPLEX-WRAPPER',
  UNKNOWN: 'AMZ-UNKNOWN-COMMAND',
  TOO_LONG: 'AMZ-COMMAND-TOO-LONG',
};

const DENY_MESSAGES = {
  [RULE.TAMPER]: 'Blocked: this action targets an AMZ AI safety-control file, setting, or nested Claude Code session. Requires explicit Owner approval outside Claude Code.',
  [RULE.GIT_PUSH]: 'Blocked: git push requires explicit Owner authorization.',
  [RULE.PROD_DEPLOY]: 'Blocked: production deploy (Vercel/Firebase) requires explicit Owner action outside Claude Code.',
  [RULE.PUBLISH]: 'Blocked: package publish requires explicit Owner authorization.',
  [RULE.DELETE]: 'Blocked: recursive/forced delete requires explicit Owner authorization.',
  [RULE.SECRET]: 'Blocked: this command appears to access a protected secret/data file.',
  [RULE.EGRESS]: 'Blocked: this command appears to send protected data to an external destination.',
};

const ASK_MESSAGES = {
  [RULE.TAMPER]: 'Needs approval: this action may affect an AMZ AI safety-control file or a nested Claude Code session.',
  [RULE.GIT_PUSH]: 'Needs approval: git alias/wrapper could not be resolved with confidence.',
  [RULE.PROD_DEPLOY]: 'Needs approval: this Firebase/Vercel command is ambiguous.',
  [RULE.SECRET]: 'Needs approval: this command may access a protected secret/data file.',
  [RULE.EGRESS]: 'Needs approval: this command sends data to an external network destination.',
  [RULE.DELETE]: 'Needs approval: this delete command is not clearly safe.',
  [RULE.COMPLEX]: 'Needs approval: command structure is too complex for automatic safety classification.',
  [RULE.UNKNOWN]: 'Needs approval: could not classify this command.',
  [RULE.TOO_LONG]: 'Needs approval: command exceeds length limit for automatic classification.',
};

const SECRET_BASENAME_EXACT = new Set(['id_rsa', 'id_ed25519']);
const SECRET_SUFFIXES = ['.pem', '.key'];
const SECRET_PREFIXES_REL = ['.env', 'secrets/'];

// ===================== Generic helpers =====================

function deferResult() {
  return { decision: 'defer' };
}

function denyResult(ruleId, override) {
  return Object.assign({ decision: 'deny', ruleId, safeMessage: DENY_MESSAGES[ruleId] || 'Blocked by AMZ safety policy.' }, override || {});
}

function askResult(ruleId, override) {
  return Object.assign({ decision: 'ask', ruleId, safeMessage: ASK_MESSAGES[ruleId] || 'Needs approval.' }, override || {});
}

const DECISION_RANK = { deny: 2, ask: 1, defer: 0 };
const RULE_PRIORITY = [
  RULE.TAMPER, RULE.SECRET, RULE.EGRESS, RULE.GIT_PUSH, RULE.PROD_DEPLOY,
  RULE.PUBLISH, RULE.DELETE, RULE.COMPLEX, RULE.UNKNOWN, RULE.TOO_LONG,
];

function worseOf(a, b) {
  if (!a) return b;
  if (!b) return a;
  const ra = DECISION_RANK[a.decision] || 0;
  const rb = DECISION_RANK[b.decision] || 0;
  if (ra !== rb) return ra > rb ? a : b;
  if (a.decision === 'defer') return a;
  const pa = RULE_PRIORITY.indexOf(a.ruleId);
  const pb = RULE_PRIORITY.indexOf(b.ruleId);
  return pa <= pb ? a : b;
}

// ===================== Path normalization =====================

function normalizeSlashes(s) {
  return s.replace(/\\/g, '/');
}

function msysToWindowsDrive(s) {
  let m = /^\/([A-Za-z])\/(.*)$/.exec(s);
  if (m) return m[1].toUpperCase() + ':/' + m[2];
  m = /^\/([A-Za-z])$/.exec(s);
  if (m) return m[1].toUpperCase() + ':/';
  return s;
}

function collapseDotSegments(p) {
  const isAbsWin = /^[A-Za-z]:\//.test(p);
  const isAbsPosix = !isAbsWin && p.startsWith('/');
  const prefix = isAbsWin ? p.slice(0, 3) : (isAbsPosix ? '/' : '');
  const rest = isAbsWin ? p.slice(3) : (isAbsPosix ? p.slice(1) : p);
  const parts = rest.split('/').filter((x) => x.length > 0);
  const stack = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') stack.pop();
      else if (!prefix) stack.push('..');
      continue;
    }
    stack.push(part);
  }
  return prefix + stack.join('/');
}

function looksUnresolvedVar(raw) {
  if (/%[A-Za-z_][A-Za-z0-9_]*%/.test(raw)) return true;
  if (/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(raw)) return true;
  if (/\$[A-Za-z_][A-Za-z0-9_]*/.test(raw)) return true;
  if (/^~($|[\\/])/.test(raw)) return true;
  return false;
}

// normalizePathString: pure, no filesystem I/O. Returns {ok:true, canonical, comparisonPath} or {ok:false, ambiguous:true}
function normalizePathString(raw, cwd) {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, ambiguous: true };
  if (raw.indexOf('\0') !== -1) return { ok: false, ambiguous: true };
  if (looksUnresolvedVar(raw)) return { ok: false, ambiguous: true };
  let s = raw.trim();
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    s = s.slice(1, -1);
  }
  s = normalizeSlashes(s);
  s = msysToWindowsDrive(s);
  const isAbsolute = /^[A-Za-z]:\//.test(s) || s.startsWith('/');
  if (!isAbsolute) {
    if (typeof cwd !== 'string' || cwd.length === 0) return { ok: false, ambiguous: true };
    let cwdN = normalizeSlashes(cwd);
    cwdN = msysToWindowsDrive(cwdN);
    s = cwdN.replace(/\/$/, '') + '/' + s;
  }
  s = collapseDotSegments(s);
  if (s.length > 1 && s.endsWith('/') && !/^[A-Za-z]:\/$/.test(s)) s = s.slice(0, -1);
  return { ok: true, canonical: s, comparisonPath: s.toLowerCase() };
}

function normalizeHomeCandidate(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  let s = normalizeSlashes(raw);
  s = msysToWindowsDrive(s);
  s = collapseDotSegments(s);
  if (s.length > 1 && s.endsWith('/') && !/^[A-Za-z]:\/$/.test(s)) s = s.slice(0, -1);
  if (s.length === 0) return null;
  return { canonical: s, comparisonPath: s.toLowerCase() };
}

// getHomeCandidates: injectable env + os.homedir for testability
function getHomeCandidates(env, osHomedirFn) {
  const raws = [];
  try {
    if (typeof osHomedirFn === 'function') {
      const h = osHomedirFn();
      if (h) raws.push(h);
    }
  } catch (e) { /* ignore */ }
  if (env && env.USERPROFILE) raws.push(env.USERPROFILE);
  if (env && env.HOME) raws.push(env.HOME);
  if (env && env.HOMEDRIVE && env.HOMEPATH) raws.push(env.HOMEDRIVE + env.HOMEPATH);
  const seen = new Set();
  const result = [];
  for (const r of raws) {
    const norm = normalizeHomeCandidate(r);
    if (!norm) continue;
    if (seen.has(norm.comparisonPath)) continue;
    seen.add(norm.comparisonPath);
    result.push(norm);
  }
  return result;
}

function buildProtectedPathEntries(ctx) {
  const entries = [];
  const repoRoot = normalizePathString(ctx.repoRoot, ctx.cwd);
  if (repoRoot.ok) {
    const r = repoRoot.comparisonPath;
    entries.push({ path: r + '/.claude/settings.json', glob: false });
    entries.push({ path: r + '/.claude/settings.local.json', glob: false });
    entries.push({ path: r + '/.claude/hooks', glob: true });
    entries.push({ path: r + '/.git/hooks', glob: true });
    entries.push({ path: r + '/.git/config', glob: false });
  }
  const homeCandidates = getHomeCandidates(ctx.env, ctx.osHomedir);
  for (const h of homeCandidates) {
    entries.push({ path: h.comparisonPath + '/.claude/settings.json', glob: false });
  }
  return entries;
}

function matchesProtectedEntry(cmpPath, entry) {
  if (!entry.glob) return cmpPath === entry.path;
  return cmpPath === entry.path || cmpPath.startsWith(entry.path + '/');
}

function checkTamperPath(rawPath, ctx) {
  if (typeof rawPath !== 'string' || rawPath.length === 0) return null;
  const norm = normalizePathString(rawPath, ctx.cwd);
  if (!norm.ok) {
    if (/\.claude[\\/]settings(\.local)?\.json$/i.test(rawPath) || /\.claude[\\/]hooks[\\/]/i.test(rawPath)) {
      return askResult(RULE.TAMPER);
    }
    return null;
  }
  const entries = buildProtectedPathEntries(ctx);
  for (const e of entries) {
    if (matchesProtectedEntry(norm.comparisonPath, e)) return denyResult(RULE.TAMPER);
  }
  // No home candidate could be resolved, but the target still has the exact shape of a
  // home-relative settings file outside the repo -> cannot confirm/deny, ask rather than silently pass.
  const homeCandidates = getHomeCandidates(ctx.env, ctx.osHomedir);
  const repoRoot = normalizePathString(ctx.repoRoot, ctx.cwd);
  const insideRepo = repoRoot.ok && (norm.comparisonPath === repoRoot.comparisonPath || norm.comparisonPath.startsWith(repoRoot.comparisonPath + '/'));
  if (homeCandidates.length === 0 && !insideRepo && /\/\.claude\/settings\.json$/.test(norm.comparisonPath)) {
    return askResult(RULE.TAMPER);
  }
  return null;
}

// ===================== Secret pattern matching =====================

function isSecretPath(rawArg, ctx) {
  if (typeof rawArg !== 'string' || rawArg.length === 0) return false;
  const norm = normalizePathString(rawArg, ctx.cwd);
  const repoRoot = normalizePathString(ctx.repoRoot, ctx.cwd);
  let rel = null;
  if (norm.ok && repoRoot.ok) {
    if (norm.comparisonPath === repoRoot.comparisonPath) rel = '';
    else if (norm.comparisonPath.startsWith(repoRoot.comparisonPath + '/')) rel = norm.comparisonPath.slice(repoRoot.comparisonPath.length + 1);
  }
  const bareForm = rawArg.trim().replace(/^["']|["']$/g, '');
  const bareLower = normalizeSlashes(bareForm).toLowerCase();
  const basename = bareLower.split('/').pop();

  if (SECRET_BASENAME_EXACT.has(basename)) return true;
  for (const suf of SECRET_SUFFIXES) if (basename.endsWith(suf)) return true;
  if (basename === '.env' || /^\.env\./.test(basename)) return true;
  if (bareLower.indexOf('secrets/') !== -1) return true;
  if (rel !== null) {
    if (rel === 'data/players.json') return true;
    if (rel === '.env' || /^\.env\./.test(rel.split('/').pop())) return true;
    if (rel.indexOf('secrets/') === 0 || rel.indexOf('/secrets/') !== -1) return true;
  }
  if (bareLower === 'data/players.json' || bareLower.endsWith('/data/players.json')) return true;
  return false;
}

// ===================== Tokenizing helpers =====================

function tokenizeArgs(s) {
  const tokens = [];
  let cur = '';
  let inS = false;
  let inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) { inS = !inS; continue; }
    if (c === '"' && !inS) { inD = !inD; continue; }
    if (!inS && !inD && /\s/.test(c)) {
      if (cur.length) { tokens.push(cur); cur = ''; }
      continue;
    }
    cur += c;
  }
  if (cur.length) tokens.push(cur);
  return tokens;
}

// Quote/escape-aware POSIX word scanner: returns the raw text (including quotes/escapes) of the
// first shell word in `s` - i.e. up to the first *unquoted* whitespace or end of string. A quote
// left open, or a trailing backslash with nothing to escape, is reported ambiguous rather than
// guessed at.
function scanPosixWord(s) {
  let i = 0;
  let inS = false;
  let inD = false;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (!inS && !inD && /\s/.test(c)) break;
    if (c === '\\' && !inS) {
      if (i + 1 >= n) return { ambiguous: true };
      i += 2;
      continue;
    }
    if (c === "'" && !inD) { inS = !inS; i += 1; continue; }
    if (c === '"' && !inS) { inD = !inD; i += 1; continue; }
    i += 1;
  }
  if (inS || inD) return { ambiguous: true };
  return { word: s.slice(0, i), endIndex: i };
}

// Strip leading `VAR=value` POSIX environment-variable assignments (possibly several) before the
// real command, e.g. `FOO=bar BAZ="q u x" git push` -> `git push`. Quote-aware: the value portion
// may contain quoted/escaped spaces like any other shell word (`A="x y" cmd`, `A=x\ y cmd`). Only
// a bare, unquoted `NAME=` prefix counts as an assignment; a word that doesn't start that way (or
// whose quoting can't be resolved) stops the strip immediately rather than guessing. Non-POSIX
// dialects have no such prefix syntax, so their segments pass through unchanged.
const MAX_LEADING_ASSIGNMENTS = 10;

function stripLeadingAssignments(segment, dialect) {
  let s = segment.trim();
  if (dialect !== 'posix') return { seg: s, ambiguous: false };
  let guard = 0;
  while (s.length > 0 && guard < MAX_LEADING_ASSIGNMENTS) {
    const w = scanPosixWord(s);
    if (w.ambiguous) return { ambiguous: true };
    if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(w.word)) break;
    const remainder = s.slice(w.endIndex);
    const ws = /^\s+/.exec(remainder);
    if (!ws) { s = ''; break; }
    s = remainder.slice(ws[0].length);
    guard += 1;
  }
  // Fail-closed at the cap: if a further assignment-shaped word still remains after stripping
  // MAX_LEADING_ASSIGNMENTS, do not silently treat it as the executable (wrong) and do not let it
  // fall through to defer (unsafe) - this exceeds what the conservative scanner will resolve with
  // confidence, so it must ask instead.
  if (guard >= MAX_LEADING_ASSIGNMENTS && s.length > 0) {
    const w2 = scanPosixWord(s);
    if (w2.ambiguous) return { ambiguous: true };
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w2.word)) return { ambiguous: true };
  }
  return { seg: s, ambiguous: false };
}

function extractBinaryAndRest(segment, dialect) {
  const stripped = stripLeadingAssignments(segment, dialect);
  if (stripped.ambiguous) return { ambiguous: true };
  const trimmed = stripped.seg.trim();
  if (!trimmed) return null;
  let m = /^"([^"]+)"\s*(.*)$/.exec(trimmed) || /^'([^']+)'\s*(.*)$/.exec(trimmed);
  let first;
  let rest;
  if (m) {
    first = m[1];
    rest = m[2];
  } else {
    const idx = trimmed.search(/\s/);
    if (idx === -1) { first = trimmed; rest = ''; } else { first = trimmed.slice(0, idx); rest = trimmed.slice(idx + 1); }
    // The executable-name token was not a single clean whole-token quote pair (that branch is
    // handled above). Any embedded quote (concatenation like gi't'), or a dialect-specific escape
    // character (POSIX backslash, CMD caret, PowerShell backtick) inside it means the literal
    // token text is not the real executable name. Semantic un-escaping is out of scope for a
    // conservative scanner, so this must ask rather than compare the raw (wrong) token and defer.
    if (/['"]/.test(first)) return { ambiguous: true };
    // A clean absolute Windows path (drive letter + backslash-separated segments, no embedded
    // quotes/whitespace) is a legitimate literal even under POSIX dialect (e.g. a Bash tool call
    // naming `C:\Windows\System32\cmd.exe` as a wrapper) - backslash there is a path separator,
    // not a POSIX escape, so it must not be flagged ambiguous like `g\it` would be.
    const isCleanWindowsAbsPath = /^[A-Za-z]:\\[^\s"'\\]+(\\[^\s"'\\]+)*\\?$/.test(first);
    if (dialect === 'posix' && first.indexOf('\\') !== -1 && !isCleanWindowsAbsPath) return { ambiguous: true };
    if (dialect === 'cmd' && first.indexOf('^') !== -1) return { ambiguous: true };
    if (dialect === 'powershell' && first.indexOf('`') !== -1) return { ambiguous: true };
  }
  return { first, rest: rest.trim() };
}

function basenameOf(p) {
  const norm = p.replace(/\\/g, '/');
  const parts = norm.split('/');
  let b = parts[parts.length - 1];
  b = b.replace(/\.(exe|cmd|bat)$/i, '');
  return b.toLowerCase();
}

function unquoteOnce(s) {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))) {
    return t.slice(1, -1);
  }
  return t;
}

// ===================== Complex-construct / quoting checks =====================

function hasComplexMarkers(s, dialect) {
  if (s.indexOf('$(') !== -1) return true;
  if (s.indexOf('<<') !== -1) return true;
  if (s.indexOf('<(') !== -1 || s.indexOf('>(') !== -1) return true;
  if (dialect === 'posix') {
    if ((s.match(/`/g) || []).length > 0) return true;
  }
  if (dialect === 'powershell') {
    if (s.indexOf('@(') !== -1) return true;
    if (s.indexOf('{') !== -1 || s.indexOf('}') !== -1) return true;
    if (/\binvoke-expression\b/i.test(s) || /(^|\s)iex(\s|$)/i.test(s)) return true;
    if (s.indexOf("@'") !== -1 || s.indexOf('@"') !== -1) return true;
    // dangling backtick at end of string, or backtick immediately followed by whitespace (ambiguous per R3 mục 7)
    if (/`\s/.test(s) || /`$/.test(s)) return true;
  }
  return false;
}

function hasUnbalancedQuotes(s, dialect) {
  if (dialect === 'cmd') {
    const dq = (s.match(/"/g) || []).length;
    if (dq % 2 !== 0) return true;
    if (/\^$/.test(s)) return true;
    return false;
  }
  if (dialect === 'powershell') {
    // backtick escapes next char; ignore escaped quote for balance purposes
    let sq = 0;
    let dq = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '`') { i++; continue; }
      if (s[i] === "'") sq++;
      if (s[i] === '"') dq++;
    }
    return sq % 2 !== 0 || dq % 2 !== 0;
  }
  // posix
  let sq = 0;
  let dq = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === "'") sq++;
    if (s[i] === '"') dq++;
  }
  return sq % 2 !== 0 || dq % 2 !== 0;
}

// POSIX line continuation: a backslash immediately followed by a newline, outside quotes, is
// removed entirely (the two physical lines become one logical line) - e.g. `git \` + newline +
// `push` must normalize to `git push` before segmentation, or the executable token is silently
// mangled and the command falls through to defer instead of being classified correctly.
function normalizeBackslashNewline(s) {
  let out = '';
  let inS = false;
  let inD = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" && !inD) { inS = !inS; out += c; continue; }
    if (c === '"' && !inS) { inD = !inD; out += c; continue; }
    if (c === '\\' && !inS) {
      if (s[i + 1] === '\n') { i += 1; continue; }
      if (s[i + 1] === '\r' && s[i + 2] === '\n') { i += 2; continue; }
    }
    out += c;
  }
  return out;
}

// ===================== Segmentation =====================

function segmentTopLevel(s, dialect) {
  const segments = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (dialect === 'powershell' && c === '`' && !inSingle) {
      cur += c + (s[i + 1] || '');
      i += 2;
      continue;
    }
    if (dialect === 'posix' && c === '\\' && !inSingle) {
      cur += c + (s[i + 1] || '');
      i += 2;
      continue;
    }
    if (c === "'" && !inDouble && dialect !== 'cmd') { inSingle = !inSingle; cur += c; i += 1; continue; }
    if (c === '"' && !inSingle) { inDouble = !inDouble; cur += c; i += 1; continue; }
    if (!inSingle && !inDouble) {
      const two = s.slice(i, i + 2);
      if (two === '&&' || two === '||') { segments.push(cur); cur = ''; i += 2; continue; }
      if (c === ';' || c === '|' || c === '\n') { segments.push(cur); cur = ''; i += 1; continue; }
      // Single top-level `&` is a command separator (background operator in POSIX, also a
      // separator in CMD). Already excluded from `&&` above, so this only ever fires on a lone
      // `&` - a construct like `true & git push` must not be treated as one opaque segment that
      // silently defers just because it contains an unrecognized `&`.
      if (c === '&' && (dialect === 'cmd' || dialect === 'posix')) { segments.push(cur); cur = ''; i += 1; continue; }
    }
    cur += c;
    i += 1;
  }
  segments.push(cur);
  return { segments: segments.map((x) => x.trim()).filter((x) => x.length > 0), balanced: !inSingle && !inDouble };
}

// ===================== Wrapper stripping =====================

// Known plain wrappers, recognized by normalized basename (so absolute paths like
// `/bin/bash` or `C:\Windows\System32\cmd.exe` are recognized the same as the bare name) rather
// than a regex anchored to literal text at the start of the string. A binary in this set with an
// option shape the scanner doesn't specifically support is `ambiguous` (ask), never treated as an
// unrecognized-but-safe executable that falls through to defer - see each case below.
const KNOWN_PLAIN_WRAPPER_BINS = new Set(['env', 'command', 'timeout', 'time', 'nice', 'nohup', 'stdbuf', 'bash', 'sh', 'cmd', 'powershell', 'pwsh', 'corepack']);

// Skip `count` leading raw "words" (simple whitespace-delimited, quote-aware) from `s`, returning
// the remaining raw substring with its original quoting intact. Used to peel off a small number of
// known flags (e.g. `--package vercel`) before a wrapper/package-runner payload without rejoining
// tokens, which would lose quoting.
function skipLeadingRawWords(s, count) {
  let cur = s;
  for (let n = 0; n < count; n++) {
    const t = cur.trim();
    const m = /^"([^"]*)"\s*(.*)$/.exec(t) || /^'([^']*)'\s*(.*)$/.exec(t);
    if (m) { cur = m[2]; continue; }
    const idx = t.search(/\s/);
    cur = idx === -1 ? '' : t.slice(idx + 1);
  }
  return cur;
}

function tryStripWrapperOptions(wrapperBin, rest) {
  switch (wrapperBin) {
    case 'env': {
      const m = /^-i\s+(.+)$/.exec(rest);
      if (m) return { seg: m[1] };
      if (rest.length === 0) return { ambiguous: true };
      if (/^-/.test(rest)) return { ambiguous: true };
      return { seg: rest };
    }
    case 'command': {
      const m = /^-p\s+(.+)$/.exec(rest);
      if (m) return { seg: m[1] };
      if (rest.length === 0) return { ambiguous: true };
      if (/^-/.test(rest)) return { ambiguous: true };
      return { seg: rest };
    }
    case 'timeout': {
      const m = /^(?:-\S+\s+)*[0-9.]+[smhd]?\s+(.+)$/.exec(rest);
      if (m) return { seg: m[1] };
      return { ambiguous: true };
    }
    case 'time': {
      if (rest.length === 0) return { ambiguous: true };
      return { seg: rest };
    }
    case 'nice': {
      const m = /^(?:-n\s*\S+\s+|-\S+\s+)*(.+)$/.exec(rest);
      if (m && m[1]) return { seg: m[1] };
      return { ambiguous: true };
    }
    case 'nohup': {
      if (rest.length === 0) return { ambiguous: true };
      return { seg: rest };
    }
    case 'stdbuf': {
      const m = /^(?:-\S+\s+)+(.+)$/.exec(rest);
      if (m && m[1]) return { seg: m[1] };
      return { ambiguous: true };
    }
    case 'corepack': {
      if (rest.length === 0) return { ambiguous: true };
      return { seg: rest };
    }
    case 'bash':
    case 'sh': {
      const m = /^(?:(?:--noprofile|--norc|--posix)\s+)*(?:-lc|-c)\s+(?:--\s+)?(.+)$/i.exec(rest);
      if (m) return { seg: unquoteOnce(m[1]), dialect: 'posix' };
      return { ambiguous: true };
    }
    case 'cmd': {
      if (/^\/k\b/i.test(rest)) return { ambiguous: true };
      let m = /^\/s\s+\/c\s+(.+)$/i.exec(rest);
      if (m) return { seg: unquoteOnce(m[1]), dialect: 'cmd' };
      m = /^\/c\s+(.+)$/i.exec(rest);
      if (m) return { seg: unquoteOnce(m[1]), dialect: 'cmd' };
      return { ambiguous: true };
    }
    case 'powershell':
    case 'pwsh': {
      const m = /^-(?:Command|c)\s+(.+)$/i.exec(rest);
      if (m) return { seg: unquoteOnce(m[1]), dialect: 'powershell' };
      return { ambiguous: true };
    }
    default:
      return { ambiguous: true };
  }
}

function tryStripWrapper(segment, dialect) {
  const be = extractBinaryAndRest(segment, dialect);
  if (!be) return null;
  if (be.ambiguous) return { ambiguous: true };
  const wrapperBin = basenameOf(be.first);
  const rest = be.rest;

  // npx / pnpm dlx / yarn dlx are package runners, not plain wrappers: the payload is arbitrary
  // and often not a binary the scanner recognizes at all. They are still stripped like a wrapper
  // so the payload can be classified (a deny-worthy payload like `vercel --prod` must still deny),
  // but tagged `packageRunner: true` so resolveEffective/classifySegment can apply the ask-floor
  // required for this family (never silently defer just because the payload is unrecognized). A
  // small set of known global flags (--yes/-y, --package/-p for npx; --silent/-s for pnpm/yarn)
  // are consumed first so they can't be mistaken for part of the payload or hide `dlx` itself.
  if (wrapperBin === 'npx') {
    let raw = rest;
    let guard = 0;
    while (guard < 4) {
      const w = /^(\S+)/.exec(raw);
      if (!w) break;
      if (w[1] === '-y' || w[1] === '--yes') { raw = skipLeadingRawWords(raw, 1); guard += 1; continue; }
      if (w[1] === '--package' || w[1] === '-p') { raw = skipLeadingRawWords(raw, 2); guard += 1; continue; }
      break;
    }
    if (raw.trim().length === 0) return { ambiguous: true };
    return { seg: raw.trim(), packageRunner: true };
  }
  if (wrapperBin === 'pnpm' || wrapperBin === 'yarn') {
    let raw = rest;
    let guard = 0;
    while (guard < 4) {
      const w = /^(\S+)/.exec(raw);
      if (!w) break;
      if (w[1] === '--silent' || w[1] === '-s') { raw = skipLeadingRawWords(raw, 1); guard += 1; continue; }
      break;
    }
    if (/^dlx\b/i.test(raw.trim())) {
      const m = /^dlx\s+(.+)$/i.exec(raw.trim());
      if (m) return { seg: m[1], packageRunner: true };
      return { ambiguous: true }; // bare "pnpm dlx"/"yarn dlx" with no payload - must not defer
    }
    return null; // not a dlx form - let normal pnpm/yarn dispatch (classifyPackageManager) handle it
  }

  if (!KNOWN_PLAIN_WRAPPER_BINS.has(wrapperBin)) return null;
  return tryStripWrapperOptions(wrapperBin, rest);
}

function resolveEffective(segment, dialect, depth, viaPackageRunner) {
  if (depth > MAX_WRAPPER_DEPTH) return { ambiguous: true };
  if (hasComplexMarkers(segment, dialect)) return { ambiguous: true };
  if (hasUnbalancedQuotes(segment, dialect)) return { ambiguous: true };
  // Assignment-stripping must happen before wrapper-stripping at each layer, not only once at the
  // end: `A="x y" env git push` / `A="x y" bash -lc "npm publish"` only resolve to their true
  // effective binary if the leading assignment is peeled off before `env`/`bash -lc` is recognized.
  const assign = stripLeadingAssignments(segment, dialect);
  if (assign.ambiguous) return { ambiguous: true };
  const afterAssign = assign.seg;
  const stripped = tryStripWrapper(afterAssign, dialect);
  if (stripped) {
    if (stripped.ambiguous) return { ambiguous: true };
    const nextDialect = stripped.dialect || dialect;
    const nextViaPR = !!viaPackageRunner || !!stripped.packageRunner;
    return resolveEffective(stripped.seg, nextDialect, depth + 1, nextViaPR);
  }
  return { segment: afterAssign, dialect, viaPackageRunner: !!viaPackageRunner };
}

// ===================== Rule-specific classifiers =====================

// Supports both `--flag value` (separate token) and `--flag=value` (single token) forms.
function getFlagValue(tokens, flagName) {
  const idx = tokens.indexOf(flagName);
  if (idx !== -1 && tokens[idx + 1] !== undefined) return tokens[idx + 1];
  const eqPrefix = flagName + '=';
  for (const t of tokens) {
    if (t.startsWith(eqPrefix)) return t.slice(eqPrefix.length);
  }
  return undefined;
}

function classifyNestedClaude(rest) {
  const tokens = tokenizeArgs(rest);
  const joined = ' ' + rest + ' ';
  if (/(^|\s)--dangerously-skip-permissions(\s|$)/.test(joined)) return denyResult(RULE.TAMPER);
  if (/(^|\s)--permission-mode(?:=|\s+)bypassPermissions(\s|$)/.test(joined)) return denyResult(RULE.TAMPER);
  if (/(^|\s)--bare(\s|$)/.test(joined)) return denyResult(RULE.TAMPER);
  if (/(^|\s)--safe-mode(\s|$)/.test(joined)) return denyResult(RULE.TAMPER);

  const settingSourcesValue = getFlagValue(tokens, '--setting-sources');
  if (settingSourcesValue !== undefined) {
    const sources = settingSourcesValue.split(',').map((x) => x.trim());
    if (sources.indexOf('project') === -1) return denyResult(RULE.TAMPER);
  }

  const settingsValue = getFlagValue(tokens, '--settings');
  if (settingsValue !== undefined) {
    let parsed = null;
    try { parsed = JSON.parse(settingsValue); } catch (e) { parsed = null; }
    if (parsed && typeof parsed === 'object') {
      if (parsed.disableAllHooks === true) return denyResult(RULE.TAMPER);
      if (parsed.permissions && parsed.permissions.defaultMode === 'bypassPermissions') return denyResult(RULE.TAMPER);
      if (Object.prototype.hasOwnProperty.call(parsed, 'hooks')) return denyResult(RULE.TAMPER);
      // Any override of permissions.deny/ask denies regardless of array content (even non-empty),
      // since it can replace the shared 19+27 baseline with a weaker set - not just the previously
      // handled empty-array case.
      if (parsed.permissions && Object.prototype.hasOwnProperty.call(parsed.permissions, 'deny')) return denyResult(RULE.TAMPER);
      if (parsed.permissions && Object.prototype.hasOwnProperty.call(parsed.permissions, 'ask')) return denyResult(RULE.TAMPER);
      return askResult(RULE.TAMPER);
    }
    return askResult(RULE.TAMPER);
  }

  // no dangerous flags detected -> still at least ask (nested Claude invariant)
  return askResult(RULE.TAMPER);
}

function classifyGit(rest, ctx) {
  const tokens = tokenizeArgs(rest);
  let i = 0;
  const aliasMap = {};
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '-c') {
      const val = tokens[i + 1];
      i += 2;
      if (typeof val === 'string') {
        const eq = val.indexOf('=');
        if (eq !== -1) {
          const key = val.slice(0, eq);
          const value = val.slice(eq + 1);
          const am = /^alias\.(.+)$/i.exec(key);
          if (am) aliasMap[am[1]] = value;
        }
      }
      continue;
    }
    if (t === '-C' || t === '--git-dir' || t === '--work-tree' || t === '--namespace') { i += 2; continue; }
    if (/^--(git-dir|work-tree|namespace)=/.test(t)) { i += 1; continue; }
    if (t === '--no-pager' || t === '-p' || t === '--paginate' || t === '--no-replace-objects') { i += 1; continue; }
    if (t.startsWith('-')) { i += 1; continue; }
    break;
  }
  let subcommand = tokens[i];
  let subRestTokens = tokens.slice(i + 1);

  if (subcommand && Object.prototype.hasOwnProperty.call(aliasMap, subcommand)) {
    const val = aliasMap[subcommand];
    if (val.trim().startsWith('!')) return askResult(RULE.COMPLEX);
    const resolvedTokens = tokenizeArgs(val);
    subcommand = resolvedTokens[0];
    subRestTokens = resolvedTokens.slice(1).concat(subRestTokens);
  } else if (subcommand === undefined) {
    return deferResult();
  }

  if (subcommand === 'push') return denyResult(RULE.GIT_PUSH);

  if (subcommand === 'config') return classifyGitConfig(subRestTokens);
  if (subcommand === 'remote') return classifyGitRemote(subRestTokens);

  // git commit is a recognized ASK family (shared baseline: Bash(git commit *)) that a wrapper
  // can hide from the literal-prefix matcher - always ask here too, direct or wrapped.
  if (subcommand === 'commit') return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this git command requires manual approval.' });

  return deferResult();
}

const SENSITIVE_CONFIG_KEY = /^(alias\..+|core\.hookspath|remote\..+\.url|remote\..+\.pushurl)$/i;

function classifyGitConfig(rawTokens) {
  // Consume --file/-f <path> as a flag+value pair before anything else, so the value token (e.g.
  // `.git/config`) is never mistaken for the config key or interferes with the read/write shape
  // checks below - this is the same arity mistake as the package-manager global-option bug.
  const tokens = [];
  let i = 0;
  while (i < rawTokens.length) {
    const t = rawTokens[i];
    if (/^(--file|-f)$/i.test(t)) { i += 2; continue; }
    tokens.push(t);
    i += 1;
  }
  const joined = tokens.join(' ');
  if (/(^|\s)(--get-all|--get|--list|-l|--show-origin|--show-scope)(\s|$)/i.test(' ' + joined + ' ')) {
    return deferResult();
  }
  let unsetTarget = null;
  const unsetIdx = tokens.findIndex((t) => /^(--unset|--unset-all|--remove-section)$/i.test(t));
  if (unsetIdx !== -1) {
    unsetTarget = tokens[unsetIdx + 1];
    if (typeof unsetTarget === 'string' && SENSITIVE_CONFIG_KEY.test(unsetTarget.replace(/\*$/, ''))) return denyResult(RULE.TAMPER);
    if (typeof unsetTarget === 'string' && /^(alias|core\.hookspath|remote)/i.test(unsetTarget)) return denyResult(RULE.TAMPER);
    return askResult(RULE.TAMPER);
  }
  // write form: key + value present (non-flag tokens)
  const nonFlag = tokens.filter((t) => !t.startsWith('-'));
  if (nonFlag.length >= 2) {
    const key = nonFlag[0];
    if (SENSITIVE_CONFIG_KEY.test(key)) return denyResult(RULE.TAMPER);
    return askResult(RULE.TAMPER);
  }
  if (nonFlag.length === 1) return deferResult(); // read (query single key)
  return askResult(RULE.TAMPER);
}

function classifyGitRemote(tokens) {
  // -v/--verbose (boolean, no value) must be consumed before the mutation-subcommand check, or
  // `git remote -v set-url ...` reads "-v" as the subcommand and silently defers.
  let i = 0;
  while (i < tokens.length && /^(-v|--verbose)$/i.test(tokens[i])) i += 1;
  const sub = tokens[i];
  if (sub === undefined) return deferResult();
  if (/^(set-url|add|remove|rename|rm)$/i.test(sub)) return denyResult(RULE.TAMPER);
  if (sub.startsWith('-')) return askResult(RULE.TAMPER); // unrecognized remote option shape
  return deferResult();
}

// Vercel/Firebase are recognized ASK families in the shared permission baseline (Bash(vercel *),
// Bash(firebase *)) covering any subcommand - but that literal-prefix rule only matches an
// unwrapped tool_input.command. Any non-deploy subcommand must still ask here, direct or wrapped,
// so a wrapper can't silently fall through to defer.
const VERCEL_BOOLEAN_FLAGS = new Set(['--yes', '-y', '--force', '-f']);
const VERCEL_VALUE_FLAGS = new Set(['--token', '--scope', '--cwd']);

function classifyVercel(rest) {
  const tokens = tokenizeArgs(rest);
  let i = 0;
  while (i < tokens.length) {
    if (VERCEL_BOOLEAN_FLAGS.has(tokens[i])) { i += 1; continue; }
    if (VERCEL_VALUE_FLAGS.has(tokens[i])) { i += 2; continue; }
    break;
  }
  if (tokens[i] === 'deploy') return denyResult(RULE.PROD_DEPLOY);
  if (tokens.indexOf('--prod') !== -1) return denyResult(RULE.PROD_DEPLOY);
  return askResult(RULE.PROD_DEPLOY, { safeMessage: 'Needs approval: this Vercel command requires manual approval.' });
}

const FIREBASE_VALUE_FLAGS = new Set(['--project', '--config']);

function classifyFirebase(rest) {
  const tokens = tokenizeArgs(rest);
  let i = 0;
  while (i < tokens.length) {
    if (FIREBASE_VALUE_FLAGS.has(tokens[i])) { i += 2; continue; }
    if (tokens[i].startsWith('-')) { i += 1; continue; }
    break;
  }
  const subcommand = tokens[i];
  if (subcommand === 'deploy') return denyResult(RULE.PROD_DEPLOY);
  return askResult(RULE.PROD_DEPLOY, { safeMessage: 'Needs approval: this Firebase command requires manual approval.' });
}

const PACKAGE_MANAGER_VALUE_FLAGS = { npm: new Set(['--prefix', '--userconfig']), pnpm: new Set(['-C']) };

function classifyPackageManager(bin, rest, ctx) {
  const tokens = tokenizeArgs(rest);
  let i = 0;
  let prefixPath = null;
  while (i < tokens.length) {
    const t = tokens[i];
    if (bin === 'npm' && t === '--prefix') { prefixPath = tokens[i + 1]; i += 2; continue; }
    if (bin === 'pnpm' && t === '-C') { prefixPath = tokens[i + 1]; i += 2; continue; }
    if (PACKAGE_MANAGER_VALUE_FLAGS[bin] && PACKAGE_MANAGER_VALUE_FLAGS[bin].has(t)) { i += 2; continue; }
    if (t.startsWith('-')) {
      // Unrecognized global option before the subcommand - whether it takes a value can't be
      // determined with confidence (that's exactly how a value like `custom.npmrc` gets
      // misread as the subcommand), so this must ask rather than guess either way.
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: package manager global option is not recognized.' });
    }
    break;
  }
  const subcommand = tokens[i];
  if (subcommand === 'publish') return denyResult(RULE.PUBLISH);
  if (subcommand === 'run' || subcommand === 'run-script') {
    const scriptName = tokens[i + 1];
    return classifyPackageScript(scriptName, prefixPath, ctx);
  }
  // test/build are a recognized ASK family (shared baseline has explicit Bash(npm test *) etc.
  // rules) that a wrapper can hide from the literal-prefix matcher - always ask here too.
  if (subcommand === 'test' || subcommand === 'build') {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a package manager test/build command.' });
  }
  // install/add/ci are a recognized ASK family (shared baseline: Bash(npm install *), Bash(npm i
  // *), Bash(npm ci *), Bash(pnpm install *), Bash(pnpm add *), Bash(yarn add *), Bash(yarn
  // install *)) that a wrapper can hide from the literal-prefix matcher - always ask here too.
  const INSTALL_SUBCOMMANDS = { npm: ['install', 'i', 'ci'], pnpm: ['install', 'add'], yarn: ['add', 'install'] };
  if (INSTALL_SUBCOMMANDS[bin] && INSTALL_SUBCOMMANDS[bin].indexOf(subcommand) !== -1) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this installs/adds package dependencies.' });
  }
  // Bare `yarn` (no subcommand, only optional flags) implicitly runs `yarn install` per real yarn
  // semantics - must ask like the explicit form, not silently defer for lack of a subcommand token.
  if (bin === 'yarn' && subcommand === undefined) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this installs/adds package dependencies.' });
  }
  return deferResult();
}

// codegraph init is a recognized ASK family (shared baseline: Bash(codegraph init *)) that a
// wrapper can hide from the literal-prefix matcher - always ask here too.
function classifyCodegraph(rest) {
  const tokens = tokenizeArgs(rest);
  if (tokens[0] === 'init') return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this initializes a CodeGraph index.' });
  return deferResult();
}

function classifyPackageScript(scriptName, prefixPath, ctx) {
  if (!scriptName) return askResult(RULE.COMPLEX);
  const baseDirRaw = prefixPath || '.';
  const baseDir = normalizePathString(baseDirRaw, ctx.cwd);
  const repoRoot = normalizePathString(ctx.repoRoot, ctx.cwd);
  if (!baseDir.ok || !repoRoot.ok) return askResult(RULE.COMPLEX);
  const inside = baseDir.comparisonPath === repoRoot.comparisonPath || baseDir.comparisonPath.startsWith(repoRoot.comparisonPath + '/');
  if (!inside) return askResult(RULE.COMPLEX);
  if (typeof ctx.readFileSafe !== 'function') return askResult(RULE.COMPLEX);
  const pkgPath = baseDir.canonical + '/package.json';
  const content = ctx.readFileSafe(pkgPath, MAX_PACKAGE_JSON_SIZE);
  if (content === null || content === undefined) return askResult(RULE.COMPLEX);
  let pkg;
  try { pkg = JSON.parse(content); } catch (e) { return askResult(RULE.COMPLEX); }
  const scripts = pkg && typeof pkg.scripts === 'object' && pkg.scripts !== null ? pkg.scripts : {};
  let scriptBody = scripts[scriptName];
  if (typeof scriptBody !== 'string') return askResult(RULE.COMPLEX);

  const hopMatch = /^(?:npm|pnpm|yarn)\s+run(?:-script)?\s+(\S+)/i.exec(scriptBody.trim());
  if (hopMatch) {
    const nextName = hopMatch[1];
    if (nextName === scriptName) return askResult(RULE.COMPLEX);
    const nextBody = scripts[nextName];
    if (typeof nextBody === 'string') scriptBody = nextBody;
  }

  const inner = classifySegment(scriptBody, 'posix', ctx);
  if (inner.decision === 'deny') return inner;
  return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a package.json script.' });
}

function hasFlag(tokens, names) {
  const lower = tokens.map((t) => t.toLowerCase());
  return names.some((n) => lower.indexOf(n.toLowerCase()) !== -1);
}

function classifyPosixRm(rest) {
  const tokens = tokenizeArgs(rest);
  const hasRecursive = hasFlag(tokens, ['-r', '-R', '--recursive']) || tokens.some((t) => /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(t) && t.startsWith('-') && !t.startsWith('--'));
  if (hasRecursive) return denyResult(RULE.DELETE);
  return askResult(RULE.DELETE);
}

// rmdir/rd/del/erase/Remove-Item/ri are recognized both as CMD builtins (/s /q flags) and as
// PowerShell aliases for Remove-Item (-Recurse -Force flags) — the same token can mean either
// depending on which shell actually executes it, so flag-syntax is checked for both forms
// regardless of which tool_name/dialect the segment arrived through (conservative: either shape denies).
function classifyDeleteAlias(rest) {
  const tokens = tokenizeArgs(rest);
  const lower = tokens.map((t) => t.toLowerCase());
  const hasCmdRecursive = lower.some((t) => t === '/s');
  const hasPsRecurse = lower.some((t) => /^-r(ecurse)?$/.test(t));
  const hasPsForce = lower.some((t) => /^-f(orce)?$/.test(t));
  const hasPosixRecursive = hasFlag(tokens, ['-r', '-R', '--recursive']) || tokens.some((t) => /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(t) && t.startsWith('-') && !t.startsWith('--'));
  if (hasCmdRecursive) return denyResult(RULE.DELETE);
  if (hasPsRecurse && hasPsForce) return denyResult(RULE.DELETE);
  if (hasPosixRecursive) return denyResult(RULE.DELETE);
  return askResult(RULE.DELETE);
}

const SECRET_READ_PRIMITIVES = new Set(['cat', 'head', 'tail', 'less', 'more', 'sed', 'awk', 'grep', 'type', 'get-content', 'gc', 'base64', 'xxd', 'strings']);
const SECRET_COPY_PRIMITIVES = new Set(['cp', 'copy', 'copy-item']);

function classifySecretPrimitive(bin, rest, segment, dialect, ctx) {
  if (bin === '.' || bin === 'source') {
    const tokens = tokenizeArgs(rest);
    if (tokens[0] && isSecretPath(tokens[0], ctx)) return denyResult(RULE.SECRET);
    if (tokens[0]) return askResult(RULE.COMPLEX);
    return null;
  }
  if (SECRET_READ_PRIMITIVES.has(bin)) {
    const tokens = tokenizeArgs(rest).filter((t) => !t.startsWith('-'));
    if (tokens.length === 0) return null;
    for (const t of tokens) {
      if (isSecretPath(t, ctx)) return denyResult(RULE.SECRET);
    }
    if (tokens.some((t) => t.indexOf('$') !== -1 || t === '*' || /\*$/.test(t))) return askResult(RULE.SECRET);
    return null;
  }
  if (SECRET_COPY_PRIMITIVES.has(bin)) {
    const tokens = tokenizeArgs(rest).filter((t) => !t.startsWith('-'));
    if (tokens[0] && isSecretPath(tokens[0], ctx)) return denyResult(RULE.SECRET);
    return null;
  }
  // input redirection `< secret-path`
  const redirMatch = /<\s*([^\s<>|&;]+)/.exec(segment);
  if (redirMatch && isSecretPath(redirMatch[1], ctx)) return denyResult(RULE.SECRET);

  // fast-read $(<file) narrow carve-out (checked before generic $( ambiguity in caller flow is NOT guaranteed;
  // this function is only reached for segments that passed hasComplexMarkers, so $( already excluded upstream.
  // Kept here only as defensive documentation of the design decision - see classifySegment.)
  return null;
}

const INLINE_INTERPRETERS = new Set(['node', 'python', 'python3', 'perl', 'ruby']);
const INLINE_FLAGS = new Set(['-e', '-p', '-c']);

function classifyInlineInterpreter(bin, rest, segment) {
  if (!INLINE_INTERPRETERS.has(bin)) return null;
  const tokens = tokenizeArgs(rest);
  const hasInlineFlag = tokens.some((t) => INLINE_FLAGS.has(t));
  if (!hasInlineFlag) return null;

  const patterns = [
    /readFileSync\s*\(\s*(['"`])([^'"`]+)\1/,
    /\bopen\s*\(\s*(['"])([^'"]+)\1/,
    /Path\s*\(\s*(['"])([^'"]+)\1\s*\)\s*\.\s*read_(?:text|bytes)\s*\(/,
    /ReadAll(?:Text|Bytes)\s*\(\s*(['"])([^'"]+)\1/,
  ];
  for (const re of patterns) {
    const m = re.exec(segment);
    if (m && m[2]) {
      // literal path extracted with a fake ctx (cwd irrelevant for suffix/basename patterns)
      if (isSecretPath(m[2], { cwd: undefined, repoRoot: undefined })) return denyResult(RULE.SECRET);
      return askResult(RULE.COMPLEX);
    }
    if (re.test(segment)) return askResult(RULE.COMPLEX); // matched call shape but dynamic argument
  }
  return askResult(RULE.COMPLEX);
}

const EGRESS_BINARIES = new Set(['curl', 'wget', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'scp', 'sftp']);
const UPLOAD_FLAGS = ['-d', '--data', '--data-binary', '--data-raw', '-f', '--form', '-t', '--upload-file', '--post-file', '--body-file', '-infile'];

function classifyEgress(bin, rest, dialect) {
  if (!EGRESS_BINARIES.has(bin)) return null;
  const tokens = tokenizeArgs(rest);
  const lowerTokens = tokens.map((t) => t.toLowerCase());
  const hasUploadFlag = lowerTokens.some((t) => UPLOAD_FLAGS.indexOf(t) !== -1) || rest.indexOf('@') !== -1 && /@[^\s]+/.test(rest);

  if (bin === 'scp' || bin === 'sftp') {
    const nonFlag = tokens.filter((t) => !t.startsWith('-'));
    const source = nonFlag[0];
    const dest = nonFlag[1];
    const looksRemoteDest = typeof dest === 'string' && /:/.test(dest) && !/^[A-Za-z]:[\\\/]/.test(dest);
    if (source && looksRemoteDest && /(\.env|\.pem|\.key|id_rsa|id_ed25519|secrets\/|players\.json)/i.test(source)) {
      return denyResult(RULE.EGRESS);
    }
    return askResult(RULE.EGRESS);
  }

  if (hasUploadFlag) {
    const dataArgMatch = /@([^\s'"]+)/.exec(rest);
    if (dataArgMatch && /(\.env|\.pem|\.key|id_rsa|id_ed25519|secrets\/|players\.json)/i.test(dataArgMatch[1])) {
      return denyResult(RULE.EGRESS);
    }
    return askResult(RULE.EGRESS);
  }

  // Recognized network-egress family: always ask, direct or wrapped, regardless of destination.
  // A wrapped form (`bash -lc "curl ..."`, `cmd /c curl ...`) never matches the shared
  // Bash(curl *)-style ask rule since that matches on the literal tool_input.command prefix; the
  // hook must not silently defer through a wrapper just because the resolved host is loopback.
  return askResult(RULE.EGRESS, { safeMessage: 'Needs approval: this network command requires manual approval regardless of destination.' });
}

const TAMPER_MUTATION_BINARIES = new Set(['rm', 'rmdir', 'del', 'erase', 'remove-item', 'ri', 'mv', 'move', 'ren', 'rename', 'cp', 'copy', 'copy-item', 'move-item', 'set-content', 'add-content', 'out-file']);

function classifyShellMutationTamper(bin, rest, segment, dialect, ctx) {
  if (!TAMPER_MUTATION_BINARIES.has(bin)) return null;
  const tokens = tokenizeArgs(rest).filter((t) => !t.startsWith('-'));
  for (const t of tokens) {
    const r = checkTamperPath(t, ctx);
    if (r) return r;
    if (/claude\.md$/i.test(t.replace(/\\/g, '/'))) return askResult(RULE.TAMPER);
  }
  return null;
}

function classifyRedirectionTamper(segment, ctx) {
  const m = />{1,2}\s*([^\s<>|&;]+)/.exec(segment);
  if (!m) return null;
  const target = m[1];
  const r = checkTamperPath(target, ctx);
  if (r) return r;
  if (/claude\.md$/i.test(target.replace(/\\/g, '/'))) return askResult(RULE.TAMPER);
  return null;
}

// Global redirection check: must run before ANY binary-specific dispatch (git/claude/package
// manager/deploy classifiers all `return` early), otherwise `git status > .claude/settings.json`,
// `claude --version > .claude/settings.json`, `npm view x > .claude/settings.json` never reach
// redirection inspection at all - the binary-specific classifier answers first and the redirection
// is silently ignored. Same rationale for input redirection from a secret file
// (`git hash-object < .env`, `npm view x < .env`, `vercel status < .env`, `claude -p x < .env`).
function classifyGlobalRedirection(segment, ctx) {
  const outTamper = classifyRedirectionTamper(segment, ctx);
  if (outTamper) return outTamper;
  const inMatch = /<\s*([^\s<>|&;]+)/.exec(segment);
  if (inMatch && isSecretPath(inMatch[1], ctx)) return denyResult(RULE.SECRET);
  return null;
}

// Unsupported POSIX shell grammar this conservative scanner will never attempt to parse: grouping/
// subshell openers and dangling closers ((...), {...}, function-definition parens/braces),
// negation, and keyword-leading segments from compound commands (if/for/while/case/etc). Any of
// these must ask, never defer - a protected action hidden inside one is not something the scanner
// can rule out, and `ask` from this segment already outranks `defer` from any sibling segment via
// worseOf, so the aggregate decision for the whole command line is never weaker than ask.
const UNSUPPORTED_GRAMMAR_BINS = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', '!', 'eval', 'exec']);

// ===================== Segment / command classification =====================

function classifyEffectiveBinary(segment, dialect, ctx) {
  // Must run before any binary-specific dispatch below - see classifyGlobalRedirection.
  const globalRedir = classifyGlobalRedirection(segment, ctx);
  if (globalRedir) return globalRedir;

  const be = extractBinaryAndRest(segment, dialect);
  if (be && be.ambiguous) return askResult(RULE.COMPLEX);
  if (!be) return deferResult();

  // Unsupported shell grammar (see UNSUPPORTED_GRAMMAR_BINS doc comment) - checked before any
  // binary dispatch too, since these tokens are not real executable names at all.
  if (/[(){}]/.test(be.first)) return askResult(RULE.COMPLEX);
  if (be.first.startsWith('$')) return askResult(RULE.COMPLEX);
  const binRaw = basenameOf(be.first);
  if (dialect === 'posix' && UNSUPPORTED_GRAMMAR_BINS.has(binRaw)) return askResult(RULE.COMPLEX);

  const bin = binRaw;
  const rest = be.rest;

  if (bin === 'claude') return classifyNestedClaude(rest);
  if (bin === 'git') return classifyGit(rest, ctx);

  if (TAMPER_MUTATION_BINARIES.has(bin)) {
    const t = classifyShellMutationTamper(bin, rest, segment, dialect, ctx);
    if (t) return t;
  }

  if (bin === 'vercel') return classifyVercel(rest);
  if (bin === 'firebase' || bin === 'firebase-tools') return classifyFirebase(rest);
  if (bin === 'npm' || bin === 'pnpm' || bin === 'yarn') return classifyPackageManager(bin, rest, ctx);
  if (bin === 'codegraph') return classifyCodegraph(rest);

  if (bin === 'rm' && dialect !== 'powershell') return classifyPosixRm(rest);
  if (['rmdir', 'rd', 'del', 'erase', 'remove-item', 'ri', 'rm'].indexOf(bin) !== -1) return classifyDeleteAlias(rest);

  const secretHit = classifySecretPrimitive(bin, rest, segment, dialect, ctx);
  if (secretHit) return secretHit;

  const egressHit = classifyEgress(bin, rest, dialect);
  if (egressHit) return egressHit;

  const inlineHit = classifyInlineInterpreter(bin, rest, segment);
  if (inlineHit) return inlineHit;

  // PowerShell invocation operator `&` — target must be a literal string/path to resolve;
  // a variable ($x) or bare subexpression ((...)) target cannot be resolved statically.
  if (dialect === 'powershell' && bin === '&') {
    const inner = extractBinaryAndRest(rest, dialect);
    if (!inner || inner.ambiguous) return askResult(RULE.COMPLEX);
    if (/^\$/.test(inner.first) || inner.first.startsWith('(')) return askResult(RULE.COMPLEX);
    return classifyEffectiveBinary(rest, dialect, ctx);
  }

  return deferResult();
}

function classifySegment(rawSegment, dialect, ctx) {
  if (hasComplexMarkers(rawSegment, dialect)) return askResult(RULE.COMPLEX);
  if (hasUnbalancedQuotes(rawSegment, dialect)) return askResult(RULE.COMPLEX);
  const resolved = resolveEffective(rawSegment, dialect, 0, false);
  if (resolved.ambiguous) return askResult(RULE.COMPLEX);
  const result = classifyEffectiveBinary(resolved.segment, resolved.dialect, ctx);
  // Package-runner invariant (npx / pnpm dlx / yarn dlx): always at least ask, regardless of
  // payload. A protected-action payload already denies/asks on its own merits and passes through
  // unchanged; only an otherwise-unrecognized payload (which would defer) is floored to ask.
  if (resolved.viaPackageRunner && result.decision === 'defer') {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a package-runner command with an unresolved payload.' });
  }
  return result;
}

function classifyCommandString(raw, initialDialect, ctx) {
  if (raw.length > MAX_COMMAND_LENGTH) return askResult(RULE.TOO_LONG);
  const normalized = initialDialect === 'posix' ? normalizeBackslashNewline(raw) : raw;
  const seg = segmentTopLevel(normalized, initialDialect);
  if (!seg.balanced) return askResult(RULE.COMPLEX);
  if (seg.segments.length > MAX_SEGMENTS) return askResult(RULE.COMPLEX);
  if (seg.segments.length === 0) return deferResult();
  let worst = null;
  for (const s of seg.segments) {
    const r = classifySegment(s, initialDialect, ctx);
    worst = worseOf(worst, r);
  }
  return worst || deferResult();
}

// ===================== File-op (Edit/Write) classification =====================

function classifyFileOp(toolInput, ctx) {
  if (!toolInput || typeof toolInput.file_path !== 'string') return askResult(RULE.UNKNOWN);
  const fp = toolInput.file_path;
  if (fp.length > MAX_FILE_PATH_LENGTH) return askResult(RULE.TOO_LONG);
  const tamper = checkTamperPath(fp, ctx);
  if (tamper) return tamper;
  return deferResult();
}

// ===================== Top-level dispatcher =====================

function classify(input, ctx) {
  try {
    if (!input || typeof input !== 'object') return askResult(RULE.UNKNOWN);
    const toolName = input.tool_name;
    if (toolName === 'Edit' || toolName === 'Write') {
      return classifyFileOp(input.tool_input, ctx);
    }
    if (toolName === 'Bash' || toolName === 'PowerShell') {
      const ti = input.tool_input;
      if (!ti || typeof ti.command !== 'string' || ti.command.length === 0) return askResult(RULE.UNKNOWN);
      const initialDialect = toolName === 'PowerShell' ? 'powershell' : 'posix';
      return classifyCommandString(ti.command, initialDialect, ctx);
    }
    return deferResult();
  } catch (e) {
    return askResult(RULE.UNKNOWN);
  }
}

// ===================== stdin/stdout glue (only when run as main) =====================

function buildOutput(result) {
  if (result.decision === 'deny' || result.decision === 'ask') {
    return JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: result.decision,
        permissionDecisionReason: result.safeMessage || 'Blocked by AMZ safety policy.',
      },
    });
  }
  return null; // defer -> no stdout
}

function readFileSafeReal(absPath, maxSize) {
  try {
    const fs = require('fs');
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size > maxSize) return null;
    return fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    return null;
  }
}

function main() {
  let raw = '';
  try {
    raw = require('fs').readFileSync(0, 'utf8');
  } catch (e) {
    raw = '';
  }
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    const out = buildOutput(askResult(RULE.UNKNOWN));
    if (out) process.stdout.write(out);
    process.exit(0);
    return;
  }
  const ctx = {
    cwd: input && typeof input.cwd === 'string' ? input.cwd : process.cwd(),
    repoRoot: process.env.CLAUDE_PROJECT_DIR || (input && input.cwd) || process.cwd(),
    env: process.env,
    osHomedir: os.homedir,
    readFileSafe: readFileSafeReal,
  };
  const result = classify(input, ctx);
  const out = buildOutput(result);
  if (out) process.stdout.write(out);
  process.exit(0);
}

module.exports = {
  RULE,
  DENY_MESSAGES,
  ASK_MESSAGES,
  normalizeSlashes,
  msysToWindowsDrive,
  collapseDotSegments,
  normalizePathString,
  normalizeHomeCandidate,
  getHomeCandidates,
  buildProtectedPathEntries,
  matchesProtectedEntry,
  checkTamperPath,
  isSecretPath,
  tokenizeArgs,
  extractBinaryAndRest,
  basenameOf,
  hasComplexMarkers,
  hasUnbalancedQuotes,
  segmentTopLevel,
  tryStripWrapper,
  resolveEffective,
  classifyNestedClaude,
  classifyGit,
  classifyGitConfig,
  classifyGitRemote,
  classifyVercel,
  classifyFirebase,
  classifyPackageManager,
  classifyCodegraph,
  classifyPackageScript,
  classifyPosixRm,
  classifyDeleteAlias,
  classifySecretPrimitive,
  classifyInlineInterpreter,
  classifyEgress,
  classifyShellMutationTamper,
  classifyRedirectionTamper,
  classifyEffectiveBinary,
  classifySegment,
  classifyCommandString,
  classifyFileOp,
  classify,
  buildOutput,
  deferResult,
  denyResult,
  askResult,
};

if (require.main === module) {
  main();
}
