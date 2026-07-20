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
const MAX_TOTAL_SEGMENTS = 40;
const MAX_WRAPPER_DEPTH = 6;
const MAX_GIT_ALIAS_DEPTH = 6;
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
// guessed at. `$'...'` (ANSI-C quoting) needs its own boundary state: unlike a plain `'...'`, an
// escaped quote (`\'`) inside it does NOT end the region, so it cannot share the plain single-quote
// toggle. `$"..."` (locale quoting) reuses the plain double-quote toggle below unmodified - its
// escaping/boundary rules are identical to a regular `"..."`, only the leading `$` differs, and that
// `$` is just an ordinary character to this boundary scan (handled generically, not a quote opener).
function scanPosixWord(s) {
  let i = 0;
  let inS = false;
  let inD = false;
  let inAnsiC = false;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (inAnsiC) {
      if (c === '\\') { i += (i + 1 < n) ? 2 : 1; continue; }
      if (c === "'") { inAnsiC = false; i += 1; continue; }
      i += 1; continue;
    }
    if (!inS && !inD && /\s/.test(c)) break;
    if (c === '\\' && !inS) {
      if (i + 1 >= n) return { ambiguous: true };
      i += 2;
      continue;
    }
    if (!inS && !inD && c === '$' && s[i + 1] === "'") { inAnsiC = true; i += 2; continue; }
    if (c === "'" && !inD) { inS = !inS; i += 1; continue; }
    if (c === '"' && !inS) { inD = !inD; i += 1; continue; }
    i += 1;
  }
  if (inS || inD || inAnsiC) return { ambiguous: true };
  return { word: s.slice(0, i), endIndex: i };
}

// Resolve ANSI-C `$'...'` escape content (already boundary-extracted, backslash sequences not yet
// resolved) into its literal value. Covers the common C-style escapes plus `\xHH` hex and `\NNN`
// octal byte escapes (the required fixture set includes `\x2e`); any other/unrecognized backslash
// sequence is not confidently resolvable here and reported ambiguous rather than guessed at -
// real bash supports a few more forms (`\uHHHH`, `\cX`) this scanner does not attempt.
function cookAnsiCContent(content) {
  let out = '';
  const n = content.length;
  let i = 0;
  while (i < n) {
    const c = content[i];
    if (c !== '\\' || i + 1 >= n) { out += c; i += 1; continue; }
    const e = content[i + 1];
    if (e === 'n') { out += '\n'; i += 2; continue; }
    if (e === 't') { out += '\t'; i += 2; continue; }
    if (e === 'r') { out += '\r'; i += 2; continue; }
    if (e === 'a') { out += '\x07'; i += 2; continue; }
    if (e === 'b') { out += '\b'; i += 2; continue; }
    if (e === 'f') { out += '\f'; i += 2; continue; }
    if (e === 'v') { out += '\v'; i += 2; continue; }
    if (e === 'e' || e === 'E') { out += '\x1b'; i += 2; continue; }
    if (e === '\\') { out += '\\'; i += 2; continue; }
    if (e === "'") { out += "'"; i += 2; continue; }
    if (e === '"') { out += '"'; i += 2; continue; }
    if (e === 'x') {
      const hex = /^[0-9A-Fa-f]{1,2}/.exec(content.slice(i + 2));
      if (!hex) return { ambiguous: true };
      out += String.fromCharCode(parseInt(hex[0], 16));
      i += 2 + hex[0].length;
      continue;
    }
    if (/[0-7]/.test(e)) {
      const oct = /^[0-7]{1,3}/.exec(content.slice(i + 1));
      if (!oct) return { ambiguous: true };
      out += String.fromCharCode(parseInt(oct[0], 8) & 0xff);
      i += 1 + oct[0].length;
      continue;
    }
    return { ambiguous: true };
  }
  return { ok: true, cooked: out };
}

// Cook a single raw POSIX word (already isolated at word boundaries, e.g. via scanPosixWord) into
// its semantic value: single-quotes are fully literal (no escapes inside), double-quotes allow
// backslash to escape `$` `` ` `` `"` `\` and newline (any other backslash sequence inside double
// quotes keeps the backslash literally, matching real bash), and outside any quotes a backslash
// escapes the very next character unconditionally (including a literal space). Returns
// {ok:true, cooked} or {ambiguous:true} if a quote is left open or a trailing backslash has
// nothing to escape - this is the actual semantic value, used where "does this raw token literally
// equal .env" is the wrong question to ask (e.g. `.e\nv` cooks to `.env`).
function cookPosixWord(raw) {
  let out = '';
  let inS = false;
  let inD = false;
  const n = raw.length;
  let i = 0;
  while (i < n) {
    const c = raw[i];
    if (inS) {
      if (c === "'") { inS = false; i += 1; continue; }
      out += c; i += 1; continue;
    }
    if (inD) {
      if (c === '"') { inD = false; i += 1; continue; }
      if (c === '\\' && i + 1 < n && /[$`"\\\n]/.test(raw[i + 1])) { out += raw[i + 1]; i += 2; continue; }
      out += c; i += 1; continue;
    }
    if (c === '$' && raw[i + 1] === "'") {
      // ANSI-C quoting `$'...'`: the quote pair contributes nothing to the output (unlike a bare
      // `$`), and its content is escape-processed by cookAnsiCContent, not the outer quote rules.
      let j = i + 2;
      let content = '';
      let closed = false;
      while (j < n) {
        if (raw[j] === '\\' && j + 1 < n) { content += raw[j] + raw[j + 1]; j += 2; continue; }
        if (raw[j] === "'") { closed = true; j += 1; break; }
        content += raw[j]; j += 1;
      }
      if (!closed) return { ambiguous: true };
      const ansi = cookAnsiCContent(content);
      if (!ansi.ok) return { ambiguous: true };
      out += ansi.cooked;
      i = j;
      continue;
    }
    if (c === '$' && raw[i + 1] === '"') {
      // Locale-translated string `$"..."`: with no gettext translation resolved (never attempted
      // here), the untranslated string is cooked exactly like a plain `"..."` - only the leading `$`
      // (the quote marker) is dropped rather than copied into the output.
      inD = true;
      i += 2;
      continue;
    }
    if (c === "'") { inS = true; i += 1; continue; }
    if (c === '"') { inD = true; i += 1; continue; }
    if (c === '\\') {
      if (i + 1 >= n) return { ambiguous: true };
      out += raw[i + 1]; i += 2; continue;
    }
    out += c; i += 1;
  }
  if (inS || inD) return { ambiguous: true };
  return { ok: true, cooked: out };
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
  if (dialect !== 'posix') return { seg: s, ambiguous: false, assignments: [] };
  let guard = 0;
  const assignments = [];
  while (s.length > 0 && guard < MAX_LEADING_ASSIGNMENTS) {
    const w = scanPosixWord(s);
    if (w.ambiguous) return { ambiguous: true };
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(w.word);
    if (!m) break;
    // Security-sensitive assignments (e.g. GIT_CONFIG_KEY_0/VALUE_0) must not be discarded
    // without a trace - collect name+cooked-value so the caller can inspect them once the
    // effective binary is known (see collectGitConfigEnvAliases / classifyGit).
    const cookedValue = cookPosixWord(m[2]);
    assignments.push({ name: m[1], value: cookedValue.ok ? cookedValue.cooked : m[2], ambiguous: !cookedValue.ok });
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
  return { seg: s, ambiguous: false, assignments };
}

// Merge assignment lists collected at successive wrapper hops, e.g.
// `A=1 env B=2 bash -lc 'C=3 cmd'` - `outer` assignments (declared further from the leaf) are
// visible to everything the wrapper chain runs, but a same-named assignment declared at a more
// nested hop (`inner`, closer to the leaf) shadows it, exactly like a real process environment.
function mergeAssignments(outer, inner) {
  const map = new Map();
  for (const a of outer || []) map.set(a.name, a);
  for (const a of inner || []) map.set(a.name, a);
  return Array.from(map.values());
}

function extractBinaryAndRest(segment, dialect) {
  const stripped = stripLeadingAssignments(segment, dialect);
  if (stripped.ambiguous) return { ambiguous: true };
  const trimmed = stripped.seg.trim();
  if (!trimmed) return null;
  let m = /^"([^"]+)"\s*(.*)$/.exec(trimmed) || /^'([^']+)'\s*(.*)$/.exec(trimmed);
  let first;
  let rest;
  let quoted = false;
  if (m) {
    first = m[1];
    rest = m[2];
    quoted = true;
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
  return { first, rest: rest.trim(), quoted };
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
      // `>|` (noclobber-override redirect) is one atomic operator, not a `>` followed by a pipe -
      // must not split here or the redirection scanner never sees the operator as a whole.
      if (c === '|' && s[i - 1] === '>') { cur += c; i += 1; continue; }
      // `>&`/`<&` (fd-duplication, e.g. `2>&1`, `1>&2`, `<&3`) is one atomic redirection operator -
      // the `&` here is glued directly to the preceding redirection char with no separating
      // whitespace, so it is never the background/separator operator. Splitting here would hand
      // the redirection scanner a truncated `2>` with no visible target, misreading a harmless fd
      // duplication as an unresolvable redirection instead of correctly ignoring it.
      if (c === '&' && (s[i - 1] === '>' || s[i - 1] === '<')) { cur += c; i += 1; continue; }
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
const KNOWN_PLAIN_WRAPPER_BINS = new Set([
  'env', 'command', 'timeout', 'time', 'nice', 'nohup', 'stdbuf', 'bash', 'sh', 'cmd', 'powershell',
  'pwsh', 'corepack', 'dash', 'zsh', 'ksh', 'ash', 'fish', 'csh', 'tcsh', 'busybox', 'setsid', 'script',
  'winpty', 'builtin', 'call', 'start',
]);

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

function tryStripWrapperOptions(wrapperBin, rest, dialect) {
  switch (wrapperBin) {
    case 'env': {
      // `env -i` clears the entire inherited environment before running the payload. Accurately
      // modeling exactly which assignments survive (only ones re-declared after -i) vs which are
      // erased (everything inherited, e.g. a GIT_CONFIG_* triple from an outer wrapper) is not
      // something this scanner attempts - fail closed with ask rather than silently trusting (or
      // silently dropping) inherited assignment context either way.
      if (/^-i(\s|$)/.test(rest)) return { ambiguous: true };
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
      // `time -p cmd` (POSIX-style) or bare `time cmd` - a leftover flag the scanner doesn't
      // recognize (payload still starting with `-`) is an unsupported option shape, not the
      // command itself.
      let r = rest;
      if (/^-p(\s|$)/.test(r)) r = r.replace(/^-p\s*/, '');
      if (r.length === 0 || /^-/.test(r)) return { ambiguous: true };
      return { seg: r };
    }
    case 'nice': {
      const m = /^(?:-n\s*\S+\s+|-\S+\s+)*(.+)$/.exec(rest);
      if (m && m[1] && !/^-/.test(m[1])) return { seg: m[1] };
      return { ambiguous: true };
    }
    case 'nohup': {
      // `nohup -- cmd` (explicit end-of-options marker) or bare `nohup cmd`.
      let r = rest;
      if (/^--(\s|$)/.test(r)) r = r.replace(/^--\s*/, '');
      if (r.length === 0 || /^-/.test(r)) return { ambiguous: true };
      return { seg: r };
    }
    case 'stdbuf': {
      const m = /^(?:-\S+\s+)+(.+)$/.exec(rest);
      if (m && m[1] && !/^-/.test(m[1])) return { seg: m[1] };
      return { ambiguous: true };
    }
    case 'corepack': {
      // `corepack -- cmd` (explicit end-of-options marker) or bare `corepack cmd`.
      let r = rest;
      if (/^--(\s|$)/.test(r)) r = r.replace(/^--\s*/, '');
      if (r.length === 0 || /^-/.test(r)) return { ambiguous: true };
      return { seg: r };
    }
    case 'bash':
    case 'sh':
    case 'dash':
    case 'zsh':
    case 'ksh':
    case 'ash':
    case 'fish':
    case 'csh':
    case 'tcsh': {
      // fish/csh/tcsh have their own command grammar (differs from POSIX in places - variable
      // syntax, quoting edge cases), but a simple `-c '<command>'` payload is stripped and re-
      // segmented as `posix` dialect here like the other shells, matching this scanner's existing
      // treatment of dash/zsh/ksh (also not truly POSIX-identical) - correct for the plain command
      // forms this scanner resolves with confidence; anything shell-specific inside the payload that
      // doesn't parse as POSIX falls through to the normal ambiguous/ask handling downstream.
      const m = /^(?:(?:--noprofile|--norc|--posix)\s+)*(?:-lc|-c)\s+(?:--\s+)?(.+)$/i.exec(rest);
      if (m) return { seg: unquoteOnce(m[1]), dialect: 'posix' };
      return { ambiguous: true };
    }
    case 'busybox': {
      // `busybox <applet> -c <command>` - busybox is a multi-call binary; only the shell applets
      // (sh/bash/ash/dash) with a recognized -c/-lc option shape are stripped with confidence.
      const m = /^(sh|bash|ash|dash)\s+(?:(?:--noprofile|--norc|--posix)\s+)*(?:-lc|-c)\s+(?:--\s+)?(.+)$/i.exec(rest);
      if (m) return { seg: unquoteOnce(m[2]), dialect: 'posix' };
      return { ambiguous: true };
    }
    case 'setsid':
    case 'winpty': {
      // Transparent process wrappers: `setsid|winpty [--] cmd [args...]`.
      let r = rest;
      if (/^--(\s|$)/.test(r)) r = r.replace(/^--\s*/, '');
      if (r.length === 0 || /^-/.test(r)) return { ambiguous: true };
      return { seg: r };
    }
    case 'builtin': {
      // `builtin <name> [args...]` forces bash to run <name> as a builtin, bypassing any function/
      // alias override of the same name. `builtin eval <words...>` is `eval` invoked as a builtin -
      // eval concatenates and re-parses its arguments as a new command line, so (only when every
      // argument cooks unambiguously, with no dynamic/glob marker) the payload can be resolved
      // here with confidence rather than falling back to the blanket ask bare `eval` still gets
      // (a genuinely dynamic `eval` is exactly what UNSUPPORTED_GRAMMAR_BINS protects against).
      const evalMatch = /^eval\s+(.+)$/i.exec(rest);
      if (evalMatch) {
        const td = tokenizeDialectWords(evalMatch[1], 'posix');
        if (!td.ok || td.tokens.length === 0) return { ambiguous: true };
        for (const t of td.tokens) {
          if (t.ambiguous || t.hasDynamicExpansion || t.hasUnquotedGlob) return { ambiguous: true };
        }
        return { seg: td.tokens.map((t) => t.cooked).join(' ') };
      }
      if (rest.length === 0 || /^-/.test(rest)) return { ambiguous: true };
      return { seg: rest };
    }
    case 'script': {
      // Only `script [-q|--quiet]* (-c|--command) <command> [typescript-file]` is stripped with
      // confidence - an interactive session (no -c) or unrecognized flag ordering must ask.
      const m = /^(?:-q\s+|--quiet\s+)*(?:-c|--command)\s+(.+)$/i.exec(rest);
      if (!m) return { ambiguous: true };
      const w = scanPosixWord(m[1]);
      if (w.ambiguous || !w.word) return { ambiguous: true };
      return { seg: unquoteOnce(w.word), dialect: 'posix' };
    }
    case 'call': {
      // `call <target> [args...]` re-invokes another batch file/command from within CMD - only
      // meaningful under the CMD dialect. A dynamic target (`call %CMD%`) is caught naturally by
      // re-segmentation (the existing CMD unresolved-`%VAR%` executable check runs on the payload).
      if (dialect !== 'cmd') return { ambiguous: true };
      if (rest.length === 0 || /^-/.test(rest)) return { ambiguous: true };
      return { seg: rest, dialect: 'cmd' };
    }
    case 'start': {
      // `start ["title"] [/options] [command [args]]` - real cmd.exe has a well-known ambiguity
      // where a leading quoted string could be a window title OR the command itself (if quoted for
      // spaces); this scanner does not attempt to disambiguate that. Only a small set of known
      // boolean options followed by an unquoted command is stripped with confidence.
      if (dialect !== 'cmd') return { ambiguous: true };
      let r = rest;
      const startFlagRe = /^\/(wait|b|min|max|normal|low|high|realtime|abovenormal|belownormal|separate|shared)\b\s*/i;
      let guard = 0;
      while (guard < 6) {
        const m = startFlagRe.exec(r);
        if (!m) break;
        r = r.slice(m[0].length);
        guard += 1;
      }
      if (r.length === 0 || r[0] === '"') return { ambiguous: true };
      return { seg: r, dialect: 'cmd' };
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
    while (guard < 6) {
      const w = /^(\S+)/.exec(raw);
      if (!w) break;
      const word = w[1];
      if (word === '-y' || word === '--yes' || word === '--') { raw = skipLeadingRawWords(raw, 1); guard += 1; continue; }
      if (word === '--package' || word === '-p') { raw = skipLeadingRawWords(raw, 2); guard += 1; continue; }
      if (word.indexOf('--package=') === 0) { raw = skipLeadingRawWords(raw, 1); guard += 1; continue; }
      if (word.indexOf('-p') === 0 && word !== '-p' && word.length > 2) { raw = skipLeadingRawWords(raw, 1); guard += 1; continue; }
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
  return tryStripWrapperOptions(wrapperBin, rest, dialect);
}

// Single-hop resolution: strip at most one leading-assignment-run and at most one wrapper layer
// from `segment`. Unlike the old design, this does NOT recurse to a final leaf binary - a wrapper
// payload is shell content in its own right (may contain `;`/`&&`/`|`/multiple commands) and must
// be re-segmented from scratch by the caller (classifySegment), not treated as one opaque argument
// string. See classifySegment/classifyCommandString for the recursive re-segmentation loop.
function resolveOneHop(segment, dialect) {
  const assign = stripLeadingAssignments(segment, dialect);
  if (assign.ambiguous) return { ambiguous: true };
  const afterAssign = assign.seg;
  const stripped = tryStripWrapper(afterAssign, dialect);
  if (stripped) {
    if (stripped.ambiguous) return { ambiguous: true };
    const nextDialect = stripped.dialect || dialect;
    // Assignments declared before the wrapper binary itself (e.g. the `GIT_CONFIG_*` triple in
    // `GIT_CONFIG_COUNT=1 ... env git p`) are visible to whatever the wrapper runs - must be
    // carried out with the wrapped payload, not dropped here, or the caller has no way to know
    // they existed by the time the payload is re-classified.
    return { wrapped: true, payload: stripped.seg, dialect: nextDialect, packageRunner: !!stripped.packageRunner, assignments: assign.assignments || [] };
  }
  return { segment: afterAssign, dialect, assignments: assign.assignments || [] };
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

// Cooked POSIX tokenizer: splits `s` into words at unquoted whitespace (via scanPosixWord, which
// already correctly treats an escaped quote as not ending its enclosing quoted region) and cooks
// each word to its semantic value (quotes stripped, escapes resolved). Dangerous nested-Claude
// flag values must be decided from these cooked tokens, not a raw-string regex - a raw regex on
// `--permission-mode "bypassPermissions"` (quoted, space form) never matches the literal text
// `--permission-mode bypassPermissions` because of the stray quote characters in between.
function tokenizeCookedPosix(s) {
  const tokens = [];
  let rem = s;
  while (true) {
    rem = rem.replace(/^\s+/, '');
    if (rem.length === 0) break;
    const w = scanPosixWord(rem);
    if (w.ambiguous) return { ambiguous: true };
    const cooked = cookPosixWord(w.word);
    if (!cooked.ok) return { ambiguous: true };
    tokens.push(cooked.cooked);
    rem = rem.slice(w.endIndex);
  }
  return { ok: true, tokens };
}

function classifyNestedClaude(rest) {
  const cookedResult = tokenizeCookedPosix(rest);
  // Can't cook the argument list with confidence - the nested-Claude invariant already requires
  // at least ask for anything not specifically resolved to a known-dangerous flag, so this simply
  // falls through to that same floor rather than a distinct branch.
  const tokens = cookedResult.ok ? cookedResult.tokens : [];

  if (tokens.indexOf('--dangerously-skip-permissions') !== -1) return denyResult(RULE.TAMPER);
  if (tokens.indexOf('--bare') !== -1) return denyResult(RULE.TAMPER);
  if (tokens.indexOf('--safe-mode') !== -1) return denyResult(RULE.TAMPER);

  const permissionModeValue = getFlagValue(tokens, '--permission-mode');
  if (permissionModeValue === 'bypassPermissions') return denyResult(RULE.TAMPER);

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

// GIT_CONFIG_COUNT / GIT_CONFIG_KEY_n / GIT_CONFIG_VALUE_n / GIT_CONFIG_PARAMETERS are real git
// environment variables that inject arbitrary config values without touching any config file -
// e.g. GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=alias.p GIT_CONFIG_VALUE_0=push makes `git p` behave
// exactly like `git -c alias.p=push p`. Builds the same shape of alias map `-c` already produces,
// plus a flag for "these env vars were present at all" (used for the ask-floor even when they
// don't resolve to a specific known-dangerous alias).
const GIT_CONFIG_ENV_RE = /^GIT_CONFIG_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/i;

// GIT_CONFIG_PARAMETERS is a space-separated list of git's own single-quote-shell-encoded
// `key=value` pairs (e.g. `'alias.p=push' 'alias.q=pull'`) - the same quoting convention as a
// POSIX shell word, so the existing cooked-word tokenizer parses it correctly for the common case.
// Anything the tokenizer can't resolve with confidence (unbalanced quoting, a token that isn't
// `key=value`) is reported as a parse failure so the caller fails closed to ask, not defer.
function parseGitConfigParameters(value) {
  const t = tokenizeCookedPosix(value);
  if (!t.ok) return { ok: false };
  const aliasMap = {};
  for (const tok of t.tokens) {
    const eq = tok.indexOf('=');
    if (eq === -1) return { ok: false };
    const key = tok.slice(0, eq);
    const val = tok.slice(eq + 1);
    const am = /^alias\.(.+)$/i.exec(key);
    if (am) aliasMap[am[1]] = val;
  }
  return { ok: true, aliasMap };
}

function collectGitConfigEnvAliases(assignments) {
  const list = assignments || [];
  const hasGitConfigEnv = list.some((a) => GIT_CONFIG_ENV_RE.test(a.name));
  const byName = {};
  for (const a of list) byName[a.name] = a.value;
  const aliasMap = {};
  let parametersAmbiguous = false;
  const countRaw = byName.GIT_CONFIG_COUNT;
  const count = countRaw !== undefined ? parseInt(countRaw, 10) : NaN;
  if (Number.isInteger(count) && count >= 0 && count <= 50) {
    for (let idx = 0; idx < count; idx++) {
      const key = byName['GIT_CONFIG_KEY_' + idx];
      const value = byName['GIT_CONFIG_VALUE_' + idx];
      if (typeof key === 'string' && typeof value === 'string') {
        const am = /^alias\.(.+)$/i.exec(key);
        if (am) aliasMap[am[1]] = value;
      }
    }
  }
  if (typeof byName.GIT_CONFIG_PARAMETERS === 'string') {
    const parsed = parseGitConfigParameters(byName.GIT_CONFIG_PARAMETERS);
    if (parsed.ok) {
      for (const k of Object.keys(parsed.aliasMap)) aliasMap[k] = parsed.aliasMap[k];
    } else {
      parametersAmbiguous = true;
    }
  }
  return { aliasMap, hasGitConfigEnv, parametersAmbiguous };
}

// Parse a leading run of git global options from `tokens`, collecting any `-c alias.x=y` and
// `--config-env=alias.x=ENVVAR` entries into an alias map along the way. Shared between top-level
// command parsing and re-parsing an alias-expanded token stream, since an alias value can itself
// start with global options (`alias.p = -c alias.q=push q`) that must not be mistaken for the
// subcommand - see resolveGitAlias.
function parseGitGlobalOptions(tokens, assignments) {
  let i = 0;
  const aliasMap = {};
  const unresolvedAliasNames = [];
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
    if (t === '--config-env' || /^--config-env=/.test(t)) {
      // `git --config-env=<key>=<envvar>` reads the config value FROM the named environment
      // variable rather than a literal - must be resolved via the collected leading assignments,
      // not silently skipped like an unrecognized global flag.
      let spec;
      if (t === '--config-env') { spec = tokens[i + 1]; i += 2; } else { spec = t.slice('--config-env='.length); i += 1; }
      if (typeof spec === 'string') {
        const eq = spec.indexOf('=');
        if (eq !== -1) {
          const key = spec.slice(0, eq);
          const envName = spec.slice(eq + 1);
          const am = /^alias\.(.+)$/i.exec(key);
          if (am) {
            const envAssign = (assignments || []).find((a) => a.name === envName);
            if (envAssign && !envAssign.ambiguous) aliasMap[am[1]] = envAssign.value;
            else unresolvedAliasNames.push(am[1]);
          }
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
  return { index: i, aliasMap, unresolvedAliasNames };
}

// Recursively resolve `startToken` through `aliasMap` (mutated in place as nested alias values are
// discovered), following real git alias-chaining semantics: each hop's expansion may itself start
// with global options (skipped via parseGitGlobalOptions) and its own trailing tokens, which are
// prepended - in resolution order, innermost first - to the tokens the caller already had. Returns
// `{subcommand, tail}` on success, `{shellAlias}` if a hop resolves to a `!`-prefixed shell alias
// (which is not a plain subcommand rewrite and must be evaluated as its own shell command by the
// caller), or `{ambiguous:true}` on a cycle, exceeding MAX_GIT_ALIAS_DEPTH, or an unresolved
// `--config-env` reference inside an alias body - never silently falls through to defer.
function resolveGitAlias(startToken, aliasMap, assignments) {
  let token = startToken;
  const visited = new Set();
  let tail = [];
  let hops = 0;
  while (token !== undefined && Object.prototype.hasOwnProperty.call(aliasMap, token)) {
    if (visited.has(token)) return { ambiguous: true };
    visited.add(token);
    hops += 1;
    if (hops > MAX_GIT_ALIAS_DEPTH) return { ambiguous: true };
    const val = String(aliasMap[token]).trim();
    if (val.startsWith('!')) return { shellAlias: val };
    // Real git splits an alias command-line value using its own internal quoting/escaping parser
    // (always POSIX-like backslash-escape rules, regardless of whatever outer dialect the top-level
    // command came from) - `p\ush` (a literal backslash, e.g. from a single-quoted top-level value
    // where the outer shell already preserved it literally) is git's own escaped form of `push`.
    const bodyResult = tokenizeCookedPosix(val);
    if (!bodyResult.ok) return { ambiguous: true };
    const bodyTokens = bodyResult.tokens;
    const g = parseGitGlobalOptions(bodyTokens, assignments);
    if (g.unresolvedAliasNames.length > 0) return { ambiguous: true };
    for (const k of Object.keys(g.aliasMap)) {
      if (!Object.prototype.hasOwnProperty.call(aliasMap, k)) aliasMap[k] = g.aliasMap[k];
    }
    const nextToken = bodyTokens[g.index];
    const rest = bodyTokens.slice(g.index + 1);
    tail = rest.concat(tail);
    token = nextToken;
  }
  if (token === undefined) return { ambiguous: true };
  return { subcommand: token, tail };
}

// `git submodule foreach [-q|--recursive]* <command>` runs `<command>` (a single shell-command-
// string argument, exactly as if passed to `sh -c`) once per submodule - a dynamic command runner
// that must never silently defer just because the payload isn't recognized.
function classifyGitSubmodule(subTokens, subMeta, ctx) {
  // The sub-subcommand token's identity ("foreach" vs anything else) can't be trusted for a
  // decision if its escape/quote structure was unresolvable or it contains a dynamic/glob
  // construct (`git submodule "$SUB" ...`) - floor to ask rather than comparing possibly-wrong
  // cooked text, which would otherwise silently defer.
  if (subTokens.length > 0 && tokenNeedsFloor(subMeta && subMeta[0])) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: git submodule subcommand could not be resolved with confidence (dynamic or glob token).' });
  }
  if (subTokens[0] !== 'foreach') return deferResult();
  let i = 1;
  while (subTokens[i] === '--recursive' || subTokens[i] === '-q' || subTokens[i] === '--quiet') i += 1;
  const cmdToken = subTokens[i];
  const askFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a command via git submodule foreach for each submodule.' });
  if (cmdToken === undefined) return askFloor;
  const inner = classifyCommandString(cmdToken, 'posix', ctx, 0, { segments: 0 });
  return inner.decision === 'defer' ? askFloor : inner;
}

// `git bisect run <cmd> [args...]` runs `<cmd>` (its own separate argv, not one quoted string) at
// each bisection step - same dynamic-runner invariant as submodule foreach: always at least ask,
// deny if the payload resolves to something specifically protected, never silently defer.
function classifyGitBisect(subTokens, subMeta, ctx) {
  if (subTokens.length > 0 && tokenNeedsFloor(subMeta && subMeta[0])) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: git bisect subcommand could not be resolved with confidence (dynamic or glob token).' });
  }
  if (subTokens[0] !== 'run') return deferResult();
  const askFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a command via git bisect run at each step.' });
  const payloadTokens = subTokens.slice(1);
  if (payloadTokens.length === 0) return askFloor;
  const rawPayload = payloadTokens.join(' ');
  const inner = classifyCommandString(rawPayload, 'posix', ctx, 0, { segments: 0 });
  return inner.decision === 'defer' ? askFloor : inner;
}

// git rebase/filter-branch/difftool/mergetool can each run an arbitrary command via a filter/tool
// option (`--exec`/`-x`, `--tree-filter`, `--extcmd`, ...) - this scanner does not attempt to parse
// every possible option shape these subcommands accept, so ANY invocation of one floors to at least
// ask (never a silent defer), and only resolves to deny/a specific decision when a known command-
// valued flag's payload is confidently extracted and itself resolves via classifyCommandString.
const GIT_COMMAND_RUNNER_FLAGS = {
  rebase: { long: ['--exec'], glued: ['-x'] },
  'filter-branch': { long: ['--setup', '--env-filter', '--tree-filter', '--index-filter', '--parent-filter', '--msg-filter', '--commit-filter'] },
  difftool: { long: ['--extcmd', '--tool-cmd'] },
  mergetool: { long: ['--extcmd', '--tool-cmd'] },
};

function classifyGitCommandRunner(subcommand, subTokens, ctx) {
  const spec = GIT_COMMAND_RUNNER_FLAGS[subcommand];
  if (!spec) return null;
  const askFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this git command can run an arbitrary command via a filter/tool option.' });
  const longFlags = spec.long || [];
  const gluedFlags = spec.glued || [];
  const resolvePayload = (val) => {
    if (typeof val !== 'string') return askFloor;
    const inner = classifyCommandString(val, 'posix', ctx, 0, { segments: 0 });
    return inner.decision === 'defer' ? askFloor : inner;
  };
  for (let idx = 0; idx < subTokens.length; idx++) {
    const t = subTokens[idx];
    if (longFlags.indexOf(t) !== -1) return resolvePayload(subTokens[idx + 1]);
    const eqMatch = longFlags.find((f) => t.indexOf(f + '=') === 0);
    if (eqMatch) return resolvePayload(t.slice(eqMatch.length + 1));
    for (const g of gluedFlags) {
      if (t === g) return resolvePayload(subTokens[idx + 1]);
      if (t.indexOf(g) === 0 && t.length > g.length) return resolvePayload(t.slice(g.length));
    }
  }
  return askFloor;
}

function classifyGit(rest, ctx, assignments, dialect) {
  const td = dialectTokenStrings(rest, dialect);
  if (!td.ok) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: git command arguments could not be resolved with confidence.' });
  }
  const tokens = td.tokens;
  const meta = td.meta;
  const parsed = parseGitGlobalOptions(tokens, assignments);
  const i = parsed.index;
  const aliasMap = parsed.aliasMap;
  const unresolvedAliasNames = parsed.unresolvedAliasNames;

  const envCfg = collectGitConfigEnvAliases(assignments);
  for (const k of Object.keys(envCfg.aliasMap)) {
    if (!Object.prototype.hasOwnProperty.call(aliasMap, k)) aliasMap[k] = envCfg.aliasMap[k];
  }

  let subcommand = tokens[i];
  let subRestTokens = tokens.slice(i + 1);
  let subRestMeta = meta.slice(i + 1);

  if (subcommand === undefined) {
    return envCfg.hasGitConfigEnv ? askResult(RULE.TAMPER) : deferResult();
  }

  // The subcommand token's identity can't be trusted for a security decision if its escape/quote
  // structure was unresolvable, or part of its text is left to runtime shell/environment/glob
  // expansion this scanner never performs (`git "$CMD"`, `git ${CMD}`) - floor to ask rather than
  // comparing possibly-wrong cooked text (which would otherwise silently defer).
  if (tokenNeedsFloor(meta[i])) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: git subcommand could not be resolved with confidence (dynamic or glob token).' });
  }

  if (unresolvedAliasNames.indexOf(subcommand) !== -1) {
    // `--config-env` named an env var we have no value for - can't rule out it resolves to
    // something dangerous, so ask rather than silently defer.
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: git alias source could not be resolved with confidence.' });
  }

  if (Object.prototype.hasOwnProperty.call(aliasMap, subcommand)) {
    const resolved = resolveGitAlias(subcommand, aliasMap, assignments);
    if (resolved.ambiguous) {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: git alias chain could not be resolved with confidence.' });
    }
    if (resolved.shellAlias) {
      // A `!`-prefixed alias value runs its payload as a shell command in its own right - resolve
      // it the same way any other nested shell command is resolved, and prefer deny over a bare
      // ask when the payload confidently resolves to a protected action (e.g. `!git push`).
      const shellCmd = resolved.shellAlias.slice(1).trim();
      if (shellCmd.length === 0) return askResult(RULE.COMPLEX);
      const inner = classifyCommandString(shellCmd, 'posix', ctx, 0, { segments: 0 });
      if (inner.decision === 'deny') return inner;
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this git alias runs a shell command that could not be fully resolved.' });
    }
    subcommand = resolved.subcommand;
    // Alias-body tail tokens come from git's own static config value (already resolved, cooked via
    // tokenizeCookedPosix at alias-expansion time), not from live shell input - there is no further
    // dynamic/glob concern to carry for them, so they get "already resolved" placeholder metadata.
    const tailMeta = resolved.tail.map(() => ({ ambiguous: false, hasDynamicExpansion: false, hasUnquotedGlob: false }));
    subRestTokens = resolved.tail.concat(subRestTokens);
    subRestMeta = tailMeta.concat(subRestMeta);
  }

  if (subcommand === 'push' || subcommand === 'send-pack') return denyResult(RULE.GIT_PUSH);

  if (subcommand === 'config') return classifyGitConfig(subRestTokens, subRestMeta);
  if (subcommand === 'remote') return classifyGitRemote(subRestTokens, subRestMeta);
  if (subcommand === 'submodule') return classifyGitSubmodule(subRestTokens, subRestMeta, ctx);
  if (subcommand === 'bisect') return classifyGitBisect(subRestTokens, subRestMeta, ctx);
  const runnerHit = classifyGitCommandRunner(subcommand, subRestTokens, ctx);
  if (runnerHit) return runnerHit;

  // git commit is a recognized ASK family (shared baseline: Bash(git commit *)) that a wrapper
  // can hide from the literal-prefix matcher - always ask here too, direct or wrapped.
  if (subcommand === 'commit') return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this git command requires manual approval.' });

  // GIT_CONFIG_* env assignments were present but didn't resolve through to a specifically
  // dangerous subcommand above - arbitrary config injection is still at least ask, never defer.
  if (envCfg.hasGitConfigEnv) return askResult(RULE.TAMPER);

  return deferResult();
}

const SENSITIVE_CONFIG_KEY = /^(alias\..+|core\.hookspath|remote\..+\.url|remote\..+\.pushurl)$/i;

function classifyGitConfig(rawTokens, rawMeta) {
  // Consume --file/-f <path> as a flag+value pair before anything else, so the value token (e.g.
  // `.git/config`) is never mistaken for the config key or interferes with the read/write shape
  // checks below - this is the same arity mistake as the package-manager global-option bug.
  // Paired {value, meta} tracking throughout so a dynamic/glob unset-target or config-key token
  // (e.g. `git config "$KEY" value`) floors to ask instead of being compared as if it were reliable
  // cooked text (which would otherwise silently defer or, worse, miss a real SENSITIVE_CONFIG_KEY).
  const paired = rawTokens.map((t, idx) => ({ value: t, meta: rawMeta ? rawMeta[idx] : undefined }));
  const tokens = [];
  let i = 0;
  while (i < paired.length) {
    if (/^(--file|-f)$/i.test(paired[i].value)) { i += 2; continue; }
    tokens.push(paired[i]);
    i += 1;
  }
  const joined = tokens.map((p) => p.value).join(' ');
  if (/(^|\s)(--get-all|--get|--list|-l|--show-origin|--show-scope)(\s|$)/i.test(' ' + joined + ' ')) {
    return deferResult();
  }
  const unsetIdx = tokens.findIndex((p) => /^(--unset|--unset-all|--remove-section)$/i.test(p.value));
  if (unsetIdx !== -1) {
    const targetPair = tokens[unsetIdx + 1];
    if (targetPair && tokenNeedsFloor(targetPair.meta)) {
      return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: git config unset target could not be resolved with confidence.' });
    }
    const unsetTarget = targetPair ? targetPair.value : undefined;
    if (typeof unsetTarget === 'string' && SENSITIVE_CONFIG_KEY.test(unsetTarget.replace(/\*$/, ''))) return denyResult(RULE.TAMPER);
    if (typeof unsetTarget === 'string' && /^(alias|core\.hookspath|remote)/i.test(unsetTarget)) return denyResult(RULE.TAMPER);
    return askResult(RULE.TAMPER);
  }
  // write form: key + value present (non-flag tokens)
  const nonFlag = tokens.filter((p) => !p.value.startsWith('-'));
  if (nonFlag.length >= 2) {
    if (tokenNeedsFloor(nonFlag[0].meta)) {
      return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: git config key could not be resolved with confidence.' });
    }
    const key = nonFlag[0].value;
    if (SENSITIVE_CONFIG_KEY.test(key)) return denyResult(RULE.TAMPER);
    return askResult(RULE.TAMPER);
  }
  if (nonFlag.length === 1) return deferResult(); // read (query single key)
  return askResult(RULE.TAMPER);
}

function classifyGitRemote(tokens, meta) {
  // -v/--verbose (boolean, no value) must be consumed before the mutation-subcommand check, or
  // `git remote -v set-url ...` reads "-v" as the subcommand and silently defers.
  let i = 0;
  while (i < tokens.length && /^(-v|--verbose)$/i.test(tokens[i])) i += 1;
  const sub = tokens[i];
  if (sub === undefined) return deferResult();
  // The remote sub-subcommand token's identity can't be trusted for a decision if its escape/quote
  // structure was unresolvable, or it contains a dynamic/glob construct (`git remote "$CMD" ...`,
  // `git remote ${CMD} ...`) - floor to ask rather than comparing possibly-wrong cooked text, which
  // would otherwise silently defer instead of catching an exact `set-url`/`add`/etc. match.
  if (tokenNeedsFloor(meta && meta[i])) {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: git remote subcommand could not be resolved with confidence (dynamic or glob token).' });
  }
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

function classifyVercel(rest, dialect) {
  const td = dialectTokenStrings(rest, dialect);
  if (!td.ok) return askResult(RULE.PROD_DEPLOY, { safeMessage: 'Needs approval: this Vercel command could not be resolved with confidence.' });
  const tokens = td.tokens;
  const meta = td.meta;
  let i = 0;
  while (i < tokens.length) {
    if (VERCEL_BOOLEAN_FLAGS.has(tokens[i])) { i += 1; continue; }
    if (VERCEL_VALUE_FLAGS.has(tokens[i])) { i += 2; continue; }
    break;
  }
  // Subcommand/flag token dynamic or glob-affected - can't compare its cooked text with
  // confidence (Blocker F floor: never silently defer a deploy-family command).
  if (tokens[i] !== undefined && tokenNeedsFloor(meta[i])) {
    return askResult(RULE.PROD_DEPLOY, { safeMessage: 'Needs approval: this Vercel command could not be resolved with confidence.' });
  }
  if (tokens[i] === 'deploy') return denyResult(RULE.PROD_DEPLOY);
  if (tokens.indexOf('--prod') !== -1) return denyResult(RULE.PROD_DEPLOY);
  return askResult(RULE.PROD_DEPLOY, { safeMessage: 'Needs approval: this Vercel command requires manual approval.' });
}

const FIREBASE_VALUE_FLAGS = new Set(['--project', '--config']);

function classifyFirebase(rest, dialect) {
  const td = dialectTokenStrings(rest, dialect);
  if (!td.ok) return askResult(RULE.PROD_DEPLOY, { safeMessage: 'Needs approval: this Firebase command could not be resolved with confidence.' });
  const tokens = td.tokens;
  const meta = td.meta;
  let i = 0;
  while (i < tokens.length) {
    if (FIREBASE_VALUE_FLAGS.has(tokens[i])) { i += 2; continue; }
    if (tokens[i].startsWith('-')) { i += 1; continue; }
    break;
  }
  if (tokens[i] !== undefined && tokenNeedsFloor(meta[i])) {
    return askResult(RULE.PROD_DEPLOY, { safeMessage: 'Needs approval: this Firebase command could not be resolved with confidence.' });
  }
  const subcommand = tokens[i];
  if (subcommand === 'deploy') return denyResult(RULE.PROD_DEPLOY);
  return askResult(RULE.PROD_DEPLOY, { safeMessage: 'Needs approval: this Firebase command requires manual approval.' });
}

const PACKAGE_MANAGER_VALUE_FLAGS = { npm: new Set(['--prefix', '--userconfig']), pnpm: new Set(['-C']) };

function classifyPackageManager(bin, rest, ctx, dialect) {
  const td = dialectTokenStrings(rest, dialect);
  if (!td.ok) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: package manager command arguments could not be resolved with confidence.' });
  }
  const tokens = td.tokens;
  const meta = td.meta;
  let i = 0;
  let prefixPath = null;
  while (i < tokens.length) {
    const t = tokens[i];
    const flagSet = PACKAGE_MANAGER_VALUE_FLAGS[bin];
    if (flagSet) {
      if (flagSet.has(t)) {
        if (t === '--prefix' || t === '-C') prefixPath = tokens[i + 1];
        i += 2;
        continue;
      }
      // Equals-form (`--prefix=x`, `--userconfig=x`) of the same known value-flags - a single
      // token, not a flag+value pair, so it must not be mistaken for an unrecognized option.
      const eqMatch = Array.from(flagSet).find((f) => t.indexOf(f + '=') === 0);
      if (eqMatch) {
        if (eqMatch === '--prefix' || eqMatch === '-C') prefixPath = t.slice(eqMatch.length + 1);
        i += 1;
        continue;
      }
    }
    if (t.startsWith('-')) {
      // Unrecognized global option before the subcommand - whether it takes a value can't be
      // determined with confidence (that's exactly how a value like `custom.npmrc` gets
      // misread as the subcommand), so this must ask rather than guess either way.
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: package manager global option is not recognized.' });
    }
    break;
  }
  // Subcommand token dynamic/glob/ambiguous - can't compare its cooked text with confidence
  // (Blocker F floor: never silently defer a package-manager command on this basis).
  if (tokens[i] !== undefined && tokenNeedsFloor(meta[i])) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: package manager subcommand could not be resolved with confidence (dynamic or glob token).' });
  }
  const subcommand = tokens[i];
  if (subcommand === 'publish') return denyResult(RULE.PUBLISH);
  if (subcommand === 'exec' || subcommand === 'x') {
    // `npm exec [--] <cmd...>` / `npm x [--] <cmd...>` (an alias for exec) / `pnpm exec <cmd...>` /
    // `yarn exec <cmd...>` runs an arbitrary command through the package manager - same package-
    // runner semantics as npx/dlx: always at least ask, deny if the payload resolves to a
    // specifically protected action. `-c <command>` / `--call <command>` / `--call=<command>` pass
    // the command as a single string argument (like a package.json script body), not a positional
    // package/binary name, and must be resolved from that value rather than the raw trailing words.
    const askFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a package-runner command with an unresolved payload.' });
    const afterSub = tokens.slice(i + 1);
    const callIdx = afterSub.findIndex((t) => t === '-c' || t === '--call');
    if (callIdx !== -1) {
      const val = afterSub[callIdx + 1];
      if (typeof val !== 'string') return askFloor;
      const inner = classifyCommandString(val, 'posix', ctx, 0, { segments: 0 });
      return inner.decision === 'defer' ? askFloor : inner;
    }
    const eqCall = afterSub.find((t) => t.indexOf('--call=') === 0);
    if (eqCall) {
      const inner = classifyCommandString(eqCall.slice('--call='.length), 'posix', ctx, 0, { segments: 0 });
      return inner.decision === 'defer' ? askFloor : inner;
    }
    let rawPayload = skipLeadingRawWords(rest, i + 1).trim();
    if (/^--(\s|$)/.test(rawPayload)) rawPayload = rawPayload.replace(/^--\s*/, '');
    if (rawPayload.length === 0) return askFloor;
    const inner = classifyCommandString(rawPayload, 'posix', ctx, 0, { segments: 0 });
    return inner.decision === 'defer' ? askFloor : inner;
  }
  if (subcommand === 'explore') {
    // `npm explore <package> -- <command>` runs <command> inside the installed package's directory
    // - a dynamic command runner, same invariant as npm exec: always at least ask, deny on a
    // confidently-resolved protected payload.
    const askFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a command inside a package directory via npm explore.' });
    const afterSub = tokens.slice(i + 1);
    const dashIdx = afterSub.indexOf('--');
    if (dashIdx === -1) return askFloor;
    const rawPayload = skipLeadingRawWords(rest, i + 1 + dashIdx + 1).trim();
    if (rawPayload.length === 0) return askFloor;
    const inner = classifyCommandString(rawPayload, 'posix', ctx, 0, { segments: 0 });
    return inner.decision === 'defer' ? askFloor : inner;
  }
  if (subcommand === 'run' || subcommand === 'run-script') {
    const scriptName = tokens[i + 1];
    return classifyPackageScript(scriptName, prefixPath, ctx);
  }
  // start/stop/restart run a project-controlled package.json script exactly like `run <name>` (npm
  // additionally falls back to `node server.js` for a missing `start` script specifically, which
  // this scanner does not model - a missing/unreadable script already asks, which covers that case
  // too) - must never silently defer just because the script name isn't the literal "run".
  if (subcommand === 'start' || subcommand === 'stop' || subcommand === 'restart') {
    return classifyPackageScript(subcommand, prefixPath, ctx);
  }
  // `npm init <package-spec>` downloads and executes an npm-init-* package (like npx) - must ask at
  // minimum; bare `npm init` (no package spec) is ordinary project scaffolding and keeps its
  // existing (unclassified) policy.
  if (subcommand === 'init' && tokens[i + 1] !== undefined) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this may download and execute an npm init package with a specified package spec.' });
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
function classifyCodegraph(rest, dialect) {
  const td = dialectTokenStrings(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: codegraph command arguments could not be resolved with confidence.' });
  if (td.tokens[0] !== undefined && tokenNeedsFloor(td.meta[0])) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: codegraph subcommand could not be resolved with confidence.' });
  }
  if (td.tokens[0] === 'init') return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this initializes a CodeGraph index.' });
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

  // A script body is itself a full shell command string (may contain `&&`/`;`/multiple commands,
  // e.g. `"deploy": "npm run build && vercel --prod"`), not a single opaque segment - route it
  // through the same full re-segmentation as any other command string.
  const inner = classifyCommandString(scriptBody, 'posix', ctx, 0, { segments: 0 });
  if (inner.decision === 'deny') return inner;
  return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a package.json script.' });
}

function hasFlag(tokens, names) {
  const lower = tokens.map((t) => t.toLowerCase());
  return names.some((n) => lower.indexOf(n.toLowerCase()) !== -1);
}

function classifyPosixRm(rest, dialect) {
  const td = dialectTokenStrings(rest, dialect);
  // An unresolvable token never widens to "safe" here - the function already defaults to ask
  // (never defer) when no recursive flag is confidently found, so falling back to an empty token
  // list on ambiguity is still fail-closed, not a silent pass.
  const tokens = td.ok ? td.tokens : [];
  const hasRecursive = hasFlag(tokens, ['-r', '-R', '--recursive']) || tokens.some((t) => /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(t) && t.startsWith('-') && !t.startsWith('--'));
  if (hasRecursive) return denyResult(RULE.DELETE);
  return askResult(RULE.DELETE);
}

// rmdir/rd/del/erase/Remove-Item/ri are recognized both as CMD builtins (/s /q flags) and as
// PowerShell aliases for Remove-Item (-Recurse -Force flags) — the same token can mean either
// depending on which shell actually executes it, so flag-syntax is checked for both forms
// regardless of which tool_name/dialect the segment arrived through (conservative: either shape denies).
function classifyDeleteAlias(rest, dialect) {
  const td = dialectTokenStrings(rest, dialect);
  const tokens = td.ok ? td.tokens : [];
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

// Cook a raw argument token into its semantic value before path checks, dialect-aware, so an
// escape sequence like `.e\nv` (POSIX: backslash escapes the literal `n`, semantic value `.env`),
// `.e^nv` (CMD caret) or `` .e`nv `` (PowerShell backtick) all resolve to their real semantic value
// instead of comparing the wrong raw string. Returns {ok:true, cooked} or {ambiguous:true} if the
// escape/quote structure can't be resolved with confidence - callers must ask rather than silently
// use the raw (possibly wrong) token.
function cookArgForPath(raw, dialect) {
  return cookDialectTarget(raw, dialect);
}

// A path-argument token whose escape/quote structure is unresolvable, or that contains an unquoted
// glob character or dynamic (env-var) expansion, is never safe to compare against isSecretPath -
// the real path it resolves to at runtime could be anything, including a protected secret. Returns
// an ask/deny result if the token must floor, or null if it's safe to use `.cooked` for a decision.
function secretPathTokenFloor(tokenMeta) {
  if (!tokenMeta || tokenMeta.ambiguous) return askResult(RULE.COMPLEX);
  if (tokenMeta.hasUnquotedGlob || tokenMeta.hasDynamicExpansion) {
    return askResult(RULE.SECRET, { safeMessage: 'Needs approval: this command reads a file whose path contains an unresolved shell glob or expansion character.' });
  }
  return null;
}

function classifySecretPrimitive(bin, rest, segment, dialect, ctx) {
  if (bin === '.' || bin === 'source') {
    const td = tokenizeDialectWords(rest, dialect);
    const first = td.tokens[0];
    if (first) {
      const floor = secretPathTokenFloor(first);
      if (floor) return floor;
      if (isSecretPath(first.cooked, ctx)) return denyResult(RULE.SECRET);
      return askResult(RULE.COMPLEX);
    }
    return null;
  }
  if (SECRET_READ_PRIMITIVES.has(bin)) {
    const td = tokenizeDialectWords(rest, dialect);
    const tokens = td.tokens.filter((t) => t.raw && t.raw[0] !== '-');
    if (tokens.length === 0) return null;
    for (const t of tokens) {
      const floor = secretPathTokenFloor(t);
      if (floor) return floor;
      if (isSecretPath(t.cooked, ctx)) return denyResult(RULE.SECRET);
    }
    return null;
  }
  if (SECRET_COPY_PRIMITIVES.has(bin)) {
    const td = tokenizeDialectWords(rest, dialect);
    const tokens = td.tokens.filter((t) => t.raw && t.raw[0] !== '-');
    // Every source argument (every positional token except the last, which is the destination -
    // see classifyShellMutationTamper's TAMPER_SRC_DEST_BINARIES handling) is a potential secret-
    // read source for `cp`/`copy`/`copy-item`, not only the first (`cp a b c dest` has three
    // sources). A single lone token (no clear destination position) is still checked as a source.
    const sources = tokens.length > 1 ? tokens.slice(0, -1) : tokens;
    for (const t of sources) {
      const floor = secretPathTokenFloor(t);
      if (floor) return floor;
      if (isSecretPath(t.cooked, ctx)) return denyResult(RULE.SECRET);
    }
    return null;
  }
  // Input redirection from a secret path (`< .env`) is handled exhaustively (all redirections in
  // the segment, not just the first) by the global scanner (classifyGlobalRedirection /
  // scanRedirections), which always runs before classifyEffectiveBinary reaches this function - no
  // narrower single-match fallback is needed or maintained here.
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

// Known dynamic-execution primitives: the scanner does not try to be a full parser of their own
// flag grammar (xargs/parallel/find's own options, PowerShell's -ArgumentList/-ScriptBlock
// syntax) - these binaries are never treated as "unrecognized-but-safe" (never defer). Where the
// payload is a plain positional command string (sudo/doas/xargs/parallel), it is re-classified so
// a clearly protected action (e.g. `xargs git push`) still denies; PowerShell's flag-based cmdlets
// and `find -exec/-ok` are flagged present without attempting to extract their payload.
const DYNAMIC_EXEC_ASK_BINS = new Set(['xargs', 'parallel', 'sudo', 'doas']);
const POWERSHELL_DYNAMIC_EXEC_BINS = new Set(['start-process', 'invoke-command']);
const FIND_EXEC_FLAGS = new Set(['-exec', '-execdir', '-ok', '-okdir']);

function classifyDynamicExecPrimitive(bin, rest, dialect, ctx) {
  const askFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this command can dynamically execute another program.' });
  if (bin === 'find') {
    const tokens = tokenizeArgs(rest);
    if (tokens.some((t) => FIND_EXEC_FLAGS.has(t))) return askFloor;
    return null;
  }
  if (POWERSHELL_DYNAMIC_EXEC_BINS.has(bin)) return askFloor;
  if (!DYNAMIC_EXEC_ASK_BINS.has(bin)) return null;
  const trimmed = rest.trim();
  if (trimmed.length === 0 || /^-/.test(trimmed)) return askFloor;
  const inner = classifyCommandString(trimmed, dialect, ctx, 0, { segments: 0 });
  return inner.decision === 'defer' ? askFloor : inner;
}

const EGRESS_BINARIES = new Set(['curl', 'wget', 'invoke-webrequest', 'iwr', 'invoke-restmethod', 'irm', 'scp', 'sftp']);
const UPLOAD_FLAGS = ['-d', '--data', '--data-binary', '--data-raw', '-f', '--form', '-t', '--upload-file', '--post-file', '--body-file', '-infile'];

function classifyEgress(bin, rest, dialect) {
  if (!EGRESS_BINARIES.has(bin)) return null;
  const td = dialectTokenStrings(rest, dialect);
  // Every branch below already resolves to ask/deny (never defer) - an unresolvable token list
  // simply keeps that same fail-closed default rather than needing a distinct ambiguous path.
  const tokens = td.ok ? td.tokens : [];
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

// `cp`/`copy`/`copy-item` have a source/destination split (every positional argument except the
// last is a source, the last is the destination) - the destination gets tamper-target policy here,
// while every source is separately evaluated for secret-read policy by classifySecretPrimitive
// (SECRET_COPY_PRIMITIVES), which runs after this returns null. `mv`/`move`/`move-item`/`ren`/
// `rename` only ever have a destination (no source-secret concern). Everything else in the mutation
// family (rm-family deletes, and PowerShell content writers whose real target is usually named by a
// `-Path`/`-Destination` flag this scanner does not fully parse) falls back to the older uniform
// policy: every non-flag argument is a potential tamper target.
// Project build/recipe runners execute arbitrary project-controlled recipe/build files (Makefile,
// Justfile, Rakefile, build.gradle, pom.xml, ...) this scanner does not parse - always at least ask.
const PROJECT_RUNNER_ASK_BINS = new Set(['make', 'nmake', 'just', 'task', 'rake', 'ant', 'gradle', 'gradlew', 'mvn']);

const TAMPER_SRC_DEST_BINARIES = new Set(['cp', 'copy', 'copy-item']);
const TAMPER_DEST_ONLY_BINARIES = new Set(['mv', 'move', 'ren', 'rename', 'move-item']);
const TAMPER_UNIFORM_BINARIES = new Set(['rm', 'rmdir', 'del', 'erase', 'remove-item', 'ri', 'set-content', 'add-content', 'out-file']);
const TAMPER_MUTATION_BINARIES = new Set([
  ...TAMPER_SRC_DEST_BINARIES, ...TAMPER_DEST_ONLY_BINARIES, ...TAMPER_UNIFORM_BINARIES,
]);

// A destination/tamper-target token whose escape/quote structure is unresolvable, or that contains
// an unquoted glob or unresolved dynamic expansion, is never safe to compare against checkTamperPath
// with confidence - it could resolve to a protected file just as easily as anywhere else.
function checkTamperToken(tokenMeta, ctx) {
  if (!tokenMeta || tokenMeta.ambiguous) return askResult(RULE.COMPLEX);
  if (tokenMeta.hasUnquotedGlob || tokenMeta.hasDynamicExpansion) {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this command writes to a path containing an unresolved shell glob or expansion character.' });
  }
  const r = checkTamperPath(tokenMeta.cooked, ctx);
  if (r) return r;
  if (/claude\.md$/i.test(tokenMeta.cooked.replace(/\\/g, '/'))) return askResult(RULE.TAMPER);
  return null;
}

function classifyShellMutationTamper(bin, rest, segment, dialect, ctx) {
  if (!TAMPER_MUTATION_BINARIES.has(bin)) return null;
  const td = tokenizeDialectWords(rest, dialect);
  const tokens = td.tokens.filter((t) => t.raw && t.raw[0] !== '-');

  if (TAMPER_SRC_DEST_BINARIES.has(bin)) {
    // A single (or no) positional argument leaves no clear destination position - classifySecretPrimitive
    // still evaluates that lone token as a source.
    if (tokens.length < 2) return null;
    return checkTamperToken(tokens[tokens.length - 1], ctx);
  }

  if (TAMPER_DEST_ONLY_BINARIES.has(bin)) {
    if (tokens.length === 0) return null;
    return checkTamperToken(tokens[tokens.length - 1], ctx);
  }

  for (const t of tokens) {
    const hit = checkTamperToken(t, ctx);
    if (hit) return hit;
  }
  return null;
}

// Quote/escape-aware POSIX word scanner used elsewhere for command words; redirection targets need
// the equivalent for CMD (only `"` quotes, `^` escapes next char) and PowerShell (`'`/`"` quotes,
// backtick escapes next char) dialects too, since a redirection target is just "the next shell
// word" in whichever dialect the segment belongs to.
function scanDialectWord(s, dialect) {
  if (dialect === 'posix') return scanPosixWord(s);
  let i = 0;
  let inS = false;
  let inD = false;
  const n = s.length;
  while (i < n) {
    const c = s[i];
    if (!inS && !inD && /\s/.test(c)) break;
    if (dialect === 'cmd' && c === '^' && !inD) {
      if (i + 1 >= n) return { ambiguous: true };
      i += 2;
      continue;
    }
    if (dialect === 'powershell' && c === '`' && !inS) {
      if (i + 1 >= n) return { ambiguous: true };
      i += 2;
      continue;
    }
    if (dialect === 'cmd' && c === '"') { inD = !inD; i += 1; continue; }
    if (dialect === 'powershell' && c === "'" && !inD) { inS = !inS; i += 1; continue; }
    if (dialect === 'powershell' && c === '"' && !inS) { inD = !inD; i += 1; continue; }
    i += 1;
  }
  if (inS || inD) return { ambiguous: true };
  return { word: s.slice(0, i), endIndex: i };
}

// Cook a redirection target word into its semantic value, dialect-aware - reuses the same POSIX
// cooker as argument paths (cookArgForPath) so `.clau\de/settings.json` and `.clau'de'/settings.json`
// resolve identically whether they appear as a command argument or a redirection target.
function cookDialectTarget(rawWord, dialect) {
  if (dialect === 'posix') return cookPosixWord(rawWord);
  if (dialect === 'cmd') {
    let out = '';
    let inD = false;
    const n = rawWord.length;
    for (let i = 0; i < n; i++) {
      const c = rawWord[i];
      if (c === '^' && !inD) {
        if (i + 1 >= n) return { ambiguous: true };
        out += rawWord[i + 1];
        i += 1;
        continue;
      }
      if (c === '"') { inD = !inD; continue; }
      out += c;
    }
    if (inD) return { ambiguous: true };
    return { ok: true, cooked: out };
  }
  if (dialect === 'powershell') {
    let out = '';
    let inS = false;
    let inD = false;
    const n = rawWord.length;
    for (let i = 0; i < n; i++) {
      const c = rawWord[i];
      if (inS) {
        if (c === "'") { inS = false; continue; }
        out += c;
        continue;
      }
      if (inD) {
        if (c === '"') { inD = false; continue; }
        if (c === '`') {
          if (i + 1 >= n) return { ambiguous: true };
          out += rawWord[i + 1];
          i += 1;
          continue;
        }
        out += c;
        continue;
      }
      if (c === "'") { inS = true; continue; }
      if (c === '"') { inD = true; continue; }
      if (c === '`') {
        if (i + 1 >= n) return { ambiguous: true };
        out += rawWord[i + 1];
        i += 1;
        continue;
      }
      out += c;
    }
    if (inS || inD) return { ambiguous: true };
    return { ok: true, cooked: out };
  }
  return { ok: true, cooked: rawWord };
}

// Whether `rawWord` is a single whole-token quote pair (e.g. `"git"`, `'git'`) with nothing outside
// it - the same shape `extractBinaryAndRest` already treats as a non-glob-expanded literal for the
// executable token. Used to decide whether a wildcard-looking token should still be trusted as a
// literal (fully quoted) or must be treated as filesystem-dependent (not fully quoted).
function isWholeTokenQuoted(rawWord, dialect) {
  if (dialect === 'cmd') return /^"[^"]*"$/.test(rawWord);
  return /^"[^"]*"$/.test(rawWord) || /^'[^']*'$/.test(rawWord);
}

// Whether `rawWord` contains a shell pathname-expansion (glob) metacharacter OUTSIDE of any quoted
// region, dialect-aware. POSIX/CMD both glob-expand `*`/`?` (POSIX also `[...]`) when unquoted;
// which real file (if any) such a token resolves to depends on the filesystem at execution time,
// which this scanner never inspects - the caller must treat this as "result is filesystem-
// dependent", not attempt to compare the literal/cooked text as if it were the real target.
function detectUnquotedGlob(rawWord, dialect) {
  const globRe = dialect === 'cmd' ? /[*?]/ : /[*?[\]]/;
  let inS = false;
  let inD = false;
  const n = rawWord.length;
  for (let i = 0; i < n; i++) {
    const c = rawWord[i];
    if (dialect === 'posix') {
      if (c === '\\' && !inS) { i += 1; continue; }
      if (c === "'" && !inD) { inS = !inS; continue; }
      if (c === '"' && !inS) { inD = !inD; continue; }
    } else if (dialect === 'cmd') {
      if (c === '^' && !inD) { i += 1; continue; }
      if (c === '"') { inD = !inD; continue; }
    } else if (dialect === 'powershell') {
      if (c === '`') { i += 1; continue; }
      if (c === "'" && !inD) { inS = !inS; continue; }
      if (c === '"' && !inS) { inD = !inD; continue; }
    }
    if (!inS && !inD && globRe.test(c)) return true;
  }
  return false;
}

// Whether `rawWord` contains a dynamic (runtime-resolved) expansion construct this scanner never
// evaluates, dialect-aware. POSIX/PowerShell: a `$` outside single quotes (double quotes do NOT
// block `$var`/`$(...)`/backtick expansion in POSIX, matching real shell semantics - only single
// quotes make it literal) or a backtick outside single quotes. CMD: `%VAR%` / `!VAR!` anywhere
// (delayed expansion tokens are not neutralized by double-quoting in cmd.exe). PowerShell also
// treats an unquoted `@(` as dynamic (array subexpression).
function detectDynamicExpansion(rawWord, dialect) {
  if (dialect === 'cmd') {
    return /%[A-Za-z_][A-Za-z0-9_]*%/.test(rawWord) || /![A-Za-z_][A-Za-z0-9_]*!/.test(rawWord);
  }
  if (dialect === 'powershell') {
    let inS = false;
    const n = rawWord.length;
    for (let i = 0; i < n; i++) {
      const c = rawWord[i];
      if (c === '`' && !inS) { i += 1; continue; }
      if (c === "'") { inS = !inS; continue; }
      if (!inS && (c === '$' || (c === '@' && rawWord[i + 1] === '('))) return true;
    }
    return false;
  }
  // posix
  let inS = false;
  const n = rawWord.length;
  let i = 0;
  while (i < n) {
    const c = rawWord[i];
    if (c === '\\' && !inS) { i += (i + 1 < n) ? 2 : 1; continue; }
    if (!inS && c === '$' && rawWord[i + 1] === "'") {
      // ANSI-C quote `$'...'`: escape-processed to a fixed literal, no further expansion of any
      // kind occurs inside it in real bash - skip the whole region rather than flagging it dynamic
      // just because of the leading `$` quote marker.
      let j = i + 2;
      while (j < n) {
        if (rawWord[j] === '\\' && j + 1 < n) { j += 2; continue; }
        if (rawWord[j] === "'") { j += 1; break; }
        j += 1;
      }
      i = j;
      continue;
    }
    if (!inS && c === '$' && rawWord[i + 1] === '"') {
      // Locale-quote marker `$"` - only the leading `$` is the marker itself (not a variable sigil);
      // its content still undergoes ordinary double-quote-style scanning below, so just skip past
      // the marker and let a real `$var`/backtick inside still be detected.
      i += 1;
      continue;
    }
    if (c === "'") { inS = !inS; i += 1; continue; }
    if (!inS && (c === '$' || c === '`')) return true;
    i += 1;
  }
  return false;
}

// Whether `rawWord` begins with an unquoted tilde-expansion prefix (`~`, `~/x`, `~+`, `~+/x`, `~-`,
// `~-/x`, `~user`, `~user/x`) - POSIX-only (this scanner does not model CMD/PowerShell home-
// directory syntax the same way). Tilde expansion only ever applies at the very start of a word and
// only when the `~` itself is not quoted - a token starting with `'~'` or `"~"` is not affected.
function detectTildeExpansion(rawWord) {
  return /^~(?:[+-]|[A-Za-z0-9_.-]*)(?:$|\/)/.test(rawWord);
}

// Best-effort classification of *which* expansion construct(s) appear in `rawWord`, dialect-aware -
// purely descriptive metadata for audit/introspection; the actual ask/deny/exact decision is driven
// by the authoritative hasUnquotedGlob/hasDynamicExpansion booleans, not by this list.
function computeExpansionKinds(rawWord, dialect) {
  const kinds = [];
  if (dialect !== 'posix') {
    if (dialect === 'cmd' || dialect === 'powershell') {
      if (detectDynamicExpansion(rawWord, dialect)) kinds.push('parameter');
    }
    if (detectUnquotedGlob(rawWord, dialect)) kinds.push('glob');
    return kinds;
  }
  if (rawWord.indexOf("$'") !== -1) kinds.push('ansiCQuote');
  if (rawWord.indexOf('$"') !== -1) kinds.push('localeQuote');
  if (detectTildeExpansion(rawWord)) kinds.push('tilde');
  if (/\$\(\(/.test(rawWord)) kinds.push('arithmeticExpansion');
  else if (rawWord.indexOf('$(') !== -1 || /`[^`]*`/.test(rawWord)) kinds.push('commandSubstitution');
  if (/\$\{!/.test(rawWord)) kinds.push('indirectParameter');
  else if (/\$\{[A-Za-z_][A-Za-z0-9_]*:[-=+?]/.test(rawWord)) kinds.push('parameterOperator');
  else if (/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(rawWord) || /\$[A-Za-z_][A-Za-z0-9_]*/.test(rawWord)) kinds.push('parameter');
  if (detectUnquotedGlob(rawWord, dialect)) kinds.push('glob');
  return kinds;
}

// Build the full path/word-token metadata object for one already-boundary-extracted raw word -
// shared by the general word tokenizer (tokenizeDialectWords) and the redirection-target scanner
// (scanRedirections), so a command argument and a redirection target are annotated identically.
// `exact` means "safe to use for a confident deny-level literal comparison": not ambiguous, no
// unquoted glob, and no dynamic (environment/command/tilde) expansion left unresolved. A construct
// this scanner CAN fully resolve to a fixed literal (ANSI-C `$'...'`, untranslated `$"..."`) is
// exact; anything depending on runtime shell/filesystem state is not, regardless of what its cooked
// text happens to look like.
function buildPathToken(rawWord, dialect) {
  const cooked = cookDialectTarget(rawWord, dialect);
  const escapeChar = dialect === 'cmd' ? '^' : (dialect === 'powershell' ? '`' : '\\');
  const hasUnquotedGlob = detectUnquotedGlob(rawWord, dialect);
  const hasDynamicExpansion = detectDynamicExpansion(rawWord, dialect) || (dialect === 'posix' && detectTildeExpansion(rawWord));
  const ambiguous = !cooked.ok;
  return {
    raw: rawWord,
    cooked: cooked.ok ? cooked.cooked : null,
    exact: !ambiguous && !hasUnquotedGlob && !hasDynamicExpansion,
    ambiguous,
    fullyQuoted: isWholeTokenQuoted(rawWord, dialect),
    hadEscape: rawWord.indexOf(escapeChar) !== -1,
    hasUnquotedGlob,
    hasDynamicExpansion,
    expansionKinds: computeExpansionKinds(rawWord, dialect),
  };
}

// Dialect-aware word tokenizer: splits `raw` into shell words (quote/escape-boundary-aware, via
// scanDialectWord) and annotates each with the metadata a security decision needs - the raw text,
// the semantically-cooked value (quotes stripped, escapes resolved, NO environment/glob expansion
// performed), and flags for whether the token is safe to compare literally at all. A word whose
// quoting/escaping can't be resolved with confidence stops tokenization (ambiguous:true on that
// token, `ok:false` on the result) rather than guessing past it.
function tokenizeDialectWords(raw, dialect) {
  const tokens = [];
  let rem = raw;
  let guard = 0;
  while (guard < 200) {
    rem = rem.replace(/^\s+/, '');
    if (rem.length === 0) break;
    const w = scanDialectWord(rem, dialect);
    if (w.ambiguous) {
      tokens.push({ raw: rem, cooked: null, exact: false, fullyQuoted: false, hadEscape: false, hasUnquotedGlob: false, hasDynamicExpansion: false, expansionKinds: [], ambiguous: true });
      return { ok: false, tokens };
    }
    tokens.push(buildPathToken(w.word, dialect));
    rem = rem.slice(w.endIndex);
    guard += 1;
  }
  return { ok: true, tokens };
}

// Convenience string-array view over tokenizeDialectWords for classifiers that only need cooked
// token identity comparisons (e.g. `tokens[i] === 'push'`), plus the full per-token metadata for
// callers that additionally need to floor-to-ask on a specific (usually the subcommand-determining)
// token's hasDynamicExpansion/hasUnquotedGlob/ambiguous flags rather than trusting its cooked text.
// `ok:false` (any token unresolvable) means the caller must not use `tokens` for a decision at all.
function dialectTokenStrings(raw, dialect) {
  const t = tokenizeDialectWords(raw, dialect);
  if (!t.ok) return { ok: false, tokens: [], meta: t.tokens };
  return { ok: true, tokens: t.tokens.map((x) => x.cooked), meta: t.tokens };
}

// A token is not safe to use for a security-relevant identity comparison (subcommand name, flag
// name, alias name) if its quoting/escaping couldn't be resolved, or if part of its text is left to
// runtime shell/environment/glob expansion this scanner never performs - in all three cases the
// cooked text is not reliably "what the command will actually see".
function tokenNeedsFloor(tokenMeta) {
  return !tokenMeta || tokenMeta.ambiguous || tokenMeta.hasDynamicExpansion || tokenMeta.hasUnquotedGlob;
}

// Try to match a redirection operator starting exactly at position i of s. Longer/more specific
// forms are tried first so e.g. `>>` is never seen as just `>`. A single leading fd digit only
// counts when it sits at a real word boundary (start of string, or preceded by whitespace/`;&|(`)
// - otherwise a glued digit sequence like `abc123>file` would be misread as fd 123 rather than the
// literal command name `abc123`.
function matchRedirOperatorAt(s, i) {
  const rest = s.slice(i);
  if (/^&>>/.test(rest)) return { opLength: 3, operator: '&>>', fd: null, direction: 'out' };
  if (/^&>/.test(rest)) return { opLength: 2, operator: '&>', fd: null, direction: 'out' };
  let fd = null;
  let opStart = 0;
  const fdMatch = /^([0-9])/.exec(rest);
  if (fdMatch) {
    const before = i > 0 ? s[i - 1] : undefined;
    const boundaryOk = before === undefined || /[\s;&|(]/.test(before);
    if (boundaryOk) { fd = fdMatch[1]; opStart = 1; }
  }
  const afterFd = rest.slice(opStart);
  if (/^>>/.test(afterFd)) return { opLength: opStart + 2, operator: (fd || '') + '>>', fd, direction: 'out' };
  if (/^>\|/.test(afterFd)) return { opLength: opStart + 2, operator: (fd || '') + '>|', fd, direction: 'out' };
  if (/^<>/.test(afterFd)) return { opLength: opStart + 2, operator: (fd || '') + '<>', fd, direction: 'inout' };
  if (/^>/.test(afterFd)) return { opLength: opStart + 1, operator: (fd || '') + '>', fd, direction: 'out' };
  if (/^</.test(afterFd)) return { opLength: opStart + 1, operator: (fd || '') + '<', fd, direction: 'in' };
  return null;
}

// Enumerate every redirection operator in `s` (not just the first), skipping anything inside a
// quoted region or escaped by the dialect's escape character, and returning the raw+cooked target
// for each. A duplicate-fd form (`2>&1`, `1>&-`) is recognized and skipped entirely - it duplicates
// a file descriptor, it is never a file path, and must never be reported as a redirection target.
function scanRedirections(s, dialect) {
  const results = [];
  const n = s.length;
  let i = 0;
  let inS = false;
  let inD = false;
  while (i < n) {
    const c = s[i];
    if (!inS && !inD) {
      if (dialect === 'posix' && c === '\\') { i += (i + 1 < n) ? 2 : 1; continue; }
      if (dialect === 'cmd' && c === '^') { i += (i + 1 < n) ? 2 : 1; continue; }
      if (dialect === 'powershell' && c === '`') { i += (i + 1 < n) ? 2 : 1; continue; }
    }
    if (c === "'" && !inD && dialect !== 'cmd') { inS = !inS; i += 1; continue; }
    if (c === '"' && !inS) { inD = !inD; i += 1; continue; }
    if (inS || inD) { i += 1; continue; }

    const op = matchRedirOperatorAt(s, i);
    if (!op) { i += 1; continue; }

    let j = i + op.opLength;
    const wsSkip = /^\s*/.exec(s.slice(j))[0];
    j += wsSkip.length;

    if (op.direction === 'out' && s[j] === '&') {
      const afterAmp = s[j + 1];
      if (afterAmp !== undefined && /[0-9-]/.test(afterAmp)) {
        // fd duplication/close (`2>&1`, `1>&2`, `3>&-`, `>&-`) - not a file path, skip entirely.
        let k = j + 1;
        while (k < n && /[0-9-]/.test(s[k])) k += 1;
        i = k;
        continue;
      }
      // Bash `>&word` (with or without a space) is shorthand for `&> word` - duplicate stdout+
      // stderr to a file, NOT fd-duplication. The `&` is part of the operator; the real target
      // begins right after it (optionally preceded by more whitespace).
      j += 1;
      const wsSkip2 = /^\s*/.exec(s.slice(j))[0];
      j += wsSkip2.length;
    }

    if (j >= n) {
      results.push({ operator: op.operator, fd: op.fd, direction: op.direction, rawTarget: null, cookedTarget: null, ambiguous: true });
      i = j;
      continue;
    }

    const wordScan = scanDialectWord(s.slice(j), dialect);
    if (wordScan.ambiguous) {
      results.push({ operator: op.operator, fd: op.fd, direction: op.direction, rawTarget: null, cookedTarget: null, ambiguous: true });
      i = n;
      break;
    }
    if (!wordScan.word || wordScan.word.length === 0) {
      results.push({ operator: op.operator, fd: op.fd, direction: op.direction, rawTarget: '', cookedTarget: null, ambiguous: true });
      i = j;
      continue;
    }
    const targetToken = buildPathToken(wordScan.word, dialect);
    results.push({
      operator: op.operator,
      fd: op.fd,
      direction: op.direction,
      rawTarget: targetToken.raw,
      cookedTarget: targetToken.cooked,
      exact: targetToken.exact,
      hasUnquotedGlob: targetToken.hasUnquotedGlob,
      hasDynamicExpansion: targetToken.hasDynamicExpansion,
      expansionKinds: targetToken.expansionKinds,
      ambiguous: targetToken.ambiguous,
    });
    i = j + wordScan.endIndex;
  }
  return results;
}

// Global redirection check: must run before ANY binary-specific dispatch (git/claude/package
// manager/deploy classifiers all `return` early), otherwise `git status > .claude/settings.json`,
// `claude --version > .claude/settings.json`, `npm view x > .claude/settings.json` never reach
// redirection inspection at all - the binary-specific classifier answers first and the redirection
// is silently ignored. Same rationale for input redirection from a secret file
// (`git hash-object < .env`, `npm view x < .env`, `vercel status < .env`, `claude -p x < .env`).
// Every redirection in the segment is checked (not just the first) - `git status > /tmp/harmless >
// .claude/settings.json` opens BOTH targets, and the second one being protected must still deny
// even though it is not the first match a naive single-regex scan would find.
function classifyGlobalRedirection(segment, ctx, dialect) {
  const redirs = scanRedirections(segment, dialect);
  for (const r of redirs) {
    if (r.ambiguous) {
      return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: redirection target could not be resolved with confidence.' });
    }
    const target = r.cookedTarget;
    // A target that is not `exact` (unquoted glob, or a dynamic construct this scanner does not
    // fully resolve - `${P:-...}`, `${!P}`, bare `$VAR`, tilde expansion, etc.) means the real file
    // it resolves to depends on filesystem/environment state never inspected here - the cooked
    // literal text is not a reliable basis for either a confident deny or a silent pass, so this
    // floors to ask instead of comparing it as if it were the real target. A construct that WAS
    // fully resolved to a fixed literal (ANSI-C `$'...'`, untranslated `$"..."`) is `exact` and
    // falls through to the normal comparison below, so it can still deny on an exact match.
    if (!r.exact) {
      return askResult(r.direction === 'in' ? RULE.SECRET : RULE.TAMPER, {
        safeMessage: r.direction === 'in'
          ? 'Needs approval: input redirection source could not be resolved with confidence (unresolved glob or expansion).'
          : 'Needs approval: output redirection target could not be resolved with confidence (unresolved glob or expansion).',
      });
    }
    if (r.direction === 'out' || r.direction === 'inout') {
      const tamperHit = checkTamperPath(target, ctx);
      if (tamperHit) return tamperHit;
      if (/claude\.md$/i.test(target.replace(/\\/g, '/'))) return askResult(RULE.TAMPER);
      // Target contains an unresolved shell variable (`${HOME}`, `$P`, `%VAR%`) or `~` - the real
      // destination can't be determined without resolving shell state, which this scanner never
      // does. It could point at a protected file just as easily as anywhere else, so this is at
      // least ask, never a silent defer.
      if (looksUnresolvedVar(target)) {
        return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: output redirection target could not be resolved with confidence.' });
      }
    }
    if (r.direction === 'in' || r.direction === 'inout') {
      if (isSecretPath(target, ctx)) return denyResult(RULE.SECRET);
      if (looksUnresolvedVar(target)) {
        return askResult(RULE.SECRET, { safeMessage: 'Needs approval: input redirection source could not be resolved with confidence.' });
      }
    }
  }
  return null;
}

// Unsupported POSIX shell grammar this conservative scanner will never attempt to parse: grouping/
// subshell openers and dangling closers ((...), {...}, function-definition parens/braces),
// negation, and keyword-leading segments from compound commands (if/for/while/case/etc). Any of
// these must ask, never defer - a protected action hidden inside one is not something the scanner
// can rule out, and `ask` from this segment already outranks `defer` from any sibling segment via
// worseOf, so the aggregate decision for the whole command line is never weaker than ask.
const UNSUPPORTED_GRAMMAR_BINS = new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', '!', 'eval', 'exec']);

// CMD compound-statement / scope keywords this conservative scanner will never attempt to parse
// (`if`/`for` conditionals, `setlocal`/`endlocal` variable scoping) - mirrors UNSUPPORTED_GRAMMAR_BINS
// for the POSIX dialect, so a protected action hidden inside one (`if 1==1 git push`, `for %A in
// (*) do git push`) asks rather than silently falling through to defer as an "unrecognized" binary.
const CMD_UNSUPPORTED_GRAMMAR_BINS = new Set(['if', 'for', 'setlocal', 'endlocal', 'else', 'goto']);

// ===================== Segment / command classification =====================

function classifyEffectiveBinary(segment, dialect, ctx, assignments) {
  // Must run before any binary-specific dispatch below - see classifyGlobalRedirection.
  const globalRedir = classifyGlobalRedirection(segment, ctx, dialect);
  if (globalRedir) return globalRedir;

  const be = extractBinaryAndRest(segment, dialect);
  if (be && be.ambiguous) return askResult(RULE.COMPLEX);
  if (!be) return deferResult();

  // Unsupported shell grammar (see UNSUPPORTED_GRAMMAR_BINS doc comment) - checked before any
  // binary dispatch too, since these tokens are not real executable names at all.
  if (/[(){}]/.test(be.first)) return askResult(RULE.COMPLEX);
  if (be.first.startsWith('$')) return askResult(RULE.COMPLEX);
  // CMD unresolved-variable executable target (`%COMSPEC%`, `!VAR!` delayed expansion) - the real
  // executable can't be determined without resolving CMD environment state, which this scanner
  // never does.
  if (dialect === 'cmd' && (/%[A-Za-z_][A-Za-z0-9_]*%/.test(be.first) || /![A-Za-z_][A-Za-z0-9_]*!/.test(be.first))) {
    return askResult(RULE.COMPLEX);
  }
  // POSIX executable token containing an unquoted shell glob metacharacter (`*`, `?`, `[`, `]`) -
  // the real executable depends on filesystem glob expansion this scanner never performs, so it
  // must never be compared literally (which would silently defer for e.g. `g?t push`). A whole-
  // token-quoted literal (`"/usr/bin/g?t"`) is not glob-expanded by the shell at all and is exempt
  // - it falls through to be treated as an ordinary (if unrecognized) literal executable name.
  if (dialect === 'posix' && !be.quoted && /[*?[\]]/.test(be.first)) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: executable name contains unresolved shell glob characters.' });
  }
  // CMD executable token containing an unquoted `*`/`?` wildcard - same filesystem-dependent-result
  // rationale as the POSIX case above (CMD does not support `[...]` globbing).
  if (dialect === 'cmd' && !be.quoted && /[*?]/.test(be.first)) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: executable name contains unresolved shell glob characters.' });
  }
  const binRaw = basenameOf(be.first);
  if (dialect === 'posix' && UNSUPPORTED_GRAMMAR_BINS.has(binRaw)) return askResult(RULE.COMPLEX);
  if (dialect === 'cmd' && CMD_UNSUPPORTED_GRAMMAR_BINS.has(binRaw)) return askResult(RULE.COMPLEX);
  // `wsl`/`wsl.exe` runs a command inside a full Linux subsystem with its own independent grammar
  // and quoting rules this scanner does not attempt to parse - always ask rather than try (and
  // risk getting wrong) a full WSL command-line parser.
  if (binRaw === 'wsl') {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a command inside WSL, which is not parsed by this scanner.' });
  }

  // Standalone script invariant: an executable literal ending in .sh/.ps1/.bat/.cmd is never
  // content-inspected or treated as a known-safe unrecognized executable - always ask. Checked
  // against `be.first` (before basenameOf, which strips .bat/.cmd as no-op Windows suffixes) so
  // the extension is never lost before this check runs.
  if (/\.(sh|ps1|bat|cmd)$/i.test(be.first)) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a standalone script file.' });
  }

  const bin = binRaw;
  const rest = be.rest;

  if (bin === 'claude') return classifyNestedClaude(rest);
  if (bin === 'git') return classifyGit(rest, ctx, assignments || [], dialect);
  // `git-push`/`git-send-pack` are the real standalone binaries git's own subcommands dispatch
  // to internally (present on PATH alongside `git` itself on most POSIX installs) - invoking them
  // directly bypasses the `bin === 'git'` dispatch entirely unless handled here too.
  if (bin === 'git-push' || bin === 'git-send-pack') return denyResult(RULE.GIT_PUSH);

  if (TAMPER_MUTATION_BINARIES.has(bin)) {
    const t = classifyShellMutationTamper(bin, rest, segment, dialect, ctx);
    if (t) return t;
  }

  if (bin === 'vercel') return classifyVercel(rest, dialect);
  if (bin === 'firebase' || bin === 'firebase-tools') return classifyFirebase(rest, dialect);
  if (bin === 'npm' || bin === 'pnpm' || bin === 'yarn') return classifyPackageManager(bin, rest, ctx, dialect);
  if (bin === 'codegraph') return classifyCodegraph(rest, dialect);

  if (bin === 'rm' && dialect !== 'powershell') return classifyPosixRm(rest, dialect);
  if (['rmdir', 'rd', 'del', 'erase', 'remove-item', 'ri', 'rm'].indexOf(bin) !== -1) return classifyDeleteAlias(rest, dialect);

  // Project build/recipe runners (make/nmake/just/task/rake/ant/gradle/gradlew/mvn) execute
  // arbitrary project-controlled recipe/build files this scanner does not parse in R8 - always ask,
  // never a silent defer just because the binary itself isn't independently recognized as dangerous.
  if (PROJECT_RUNNER_ASK_BINS.has(bin)) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a project build/recipe runner whose recipe file is not inspected.' });
  }

  const secretHit = classifySecretPrimitive(bin, rest, segment, dialect, ctx);
  if (secretHit) return secretHit;

  const dynamicExecHit = classifyDynamicExecPrimitive(bin, rest, dialect, ctx);
  if (dynamicExecHit) return dynamicExecHit;

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

// classifySegment resolves at most one wrapper hop, then either classifies the leaf binary or
// recurses into classifyCommandString to re-segment the wrapper's payload from scratch (a payload
// like `echo ok; git push` is shell content in its own right, not a single opaque argument).
// `depth` bounds recursion (MAX_WRAPPER_DEPTH); `budget` is a mutable {segments} counter shared
// across the whole recursive classification of one top-level command, bounding total segments
// processed across all wrapper layers combined (MAX_TOTAL_SEGMENTS), not just per-layer.
function classifySegment(rawSegment, dialect, ctx, depth, budget, inheritedAssignments) {
  if (depth > MAX_WRAPPER_DEPTH) return askResult(RULE.COMPLEX);
  if (hasComplexMarkers(rawSegment, dialect)) return askResult(RULE.COMPLEX);
  if (hasUnbalancedQuotes(rawSegment, dialect)) return askResult(RULE.COMPLEX);
  const resolved = resolveOneHop(rawSegment, dialect);
  if (resolved.ambiguous) return askResult(RULE.COMPLEX);
  if (resolved.wrapped) {
    // Assignments declared before this wrapper hop are visible to the payload it runs (real
    // environment-inheritance semantics); a same-named assignment declared at the payload's own
    // level (resolved one hop further down) must still win over this one - see mergeAssignments.
    const effectiveAssignments = mergeAssignments(inheritedAssignments, resolved.assignments);
    const inner = classifyCommandString(resolved.payload, resolved.dialect, ctx, depth + 1, budget, effectiveAssignments);
    // Package-runner invariant (npx / pnpm dlx / yarn dlx): always at least ask, regardless of
    // payload. A protected-action payload already denies/asks on its own merits and passes
    // through unchanged; only an otherwise-unrecognized payload (which would defer) is floored.
    if (resolved.packageRunner && inner.decision === 'defer') {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a package-runner command with an unresolved payload.' });
    }
    return inner;
  }
  const effectiveAssignments = mergeAssignments(inheritedAssignments, resolved.assignments);
  return classifyEffectiveBinary(resolved.segment, resolved.dialect, ctx, effectiveAssignments);
}

function classifyCommandString(raw, initialDialect, ctx, depth, budget, inheritedAssignments) {
  const effectiveDepth = depth || 0;
  const effectiveBudget = budget || { segments: 0 };
  if (effectiveDepth > MAX_WRAPPER_DEPTH) return askResult(RULE.COMPLEX);
  if (raw.length > MAX_COMMAND_LENGTH) return askResult(RULE.TOO_LONG);
  const normalized = initialDialect === 'posix' ? normalizeBackslashNewline(raw) : raw;
  const seg = segmentTopLevel(normalized, initialDialect);
  if (!seg.balanced) return askResult(RULE.COMPLEX);
  if (seg.segments.length > MAX_SEGMENTS) return askResult(RULE.COMPLEX);
  effectiveBudget.segments += seg.segments.length;
  if (effectiveBudget.segments > MAX_TOTAL_SEGMENTS) return askResult(RULE.COMPLEX);
  if (seg.segments.length === 0) return deferResult();
  let worst = null;
  for (const s of seg.segments) {
    const r = classifySegment(s, initialDialect, ctx, effectiveDepth, effectiveBudget, inheritedAssignments);
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
  resolveOneHop,
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
  scanRedirections,
  classifyGlobalRedirection,
  parseGitGlobalOptions,
  resolveGitAlias,
  mergeAssignments,
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
