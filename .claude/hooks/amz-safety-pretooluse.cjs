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
// R14 Section 10: bounds how many times a `!`-prefixed Git shell-alias body may itself be
// reclassified as a brand-new command string (crossing the "shell-alias boundary") - independent of,
// but combined with, MAX_WRAPPER_DEPTH (see classifyGitShellAliasInvocation), so a chain of nested
// shell aliases can never bypass the recursion bound the ordinary wrapper-hop path already enforces.
const MAX_GIT_SHELL_ALIAS_DEPTH = 4;
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

// Shared "unresolved dynamic-runner payload" normalizer: many classifiers (npx/dlx, npm exec/x/
// explore, git submodule foreach/bisect run, awk system(), dynamic-exec primitives, ...) recursively
// classify a payload and want their OWN specific ask-floor (e.g. "package-runner command with an
// unresolved payload") whenever the payload doesn't resolve to anything more specific. Before R9,
// an unrecognized payload always came back as a bare `defer`; under the R9 fail-closed default it
// now comes back as `ask AMZ-UNKNOWN-COMMAND` instead - both cases mean the SAME thing here ("this
// payload isn't independently resolved") and must both be replaced by the caller's more specific
// askFloor, not surfaced as the generic unknown-executable message.
function isUnresolvedPayloadResult(result) {
  return result.decision === 'defer' || (result.decision === 'ask' && result.ruleId === RULE.UNKNOWN);
}

function resolvedOrFloor(inner, askFloor) {
  return isUnresolvedPayloadResult(inner) ? askFloor : inner;
}

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

// ===================== R11 Blocker E: Windows-aware protected-path identity =====================

// A DOS-style path component silently has trailing ASCII dots/spaces stripped by the Win32 layer
// for a NORMAL path (not a `\\?\`-namespaced one, where this normalization is explicitly disabled -
// see normalizeProtectedPath). `.`/`..` are path-syntax markers, not filenames, and must never have
// this applied (stripping ".." down to "" would silently break parent-directory navigation).
function stripDosComponent(component) {
  if (component === '.' || component === '..') return component;
  return component.replace(/[. ]+$/, '');
}

// An 8.3 "short name" component shape (e.g. `SETTIN~1.JSO`, `CLAUDE~1`) - up to 8 chars, a `~`, one
// or more digits, and an optional up-to-3-char extension. This scanner never attempts to guess the
// real short-name mapping (that requires filesystem access); a component with this shape is only
// ever a signal to ask instead of comparing normally, never something to resolve or defer past.
const SHORT_83_COMPONENT_RE = /^[^.\/\\]{1,8}~[0-9]{1,5}(\.[^.\/\\]{0,3})?$/;

function hasShort83Component(pathStr) {
  return normalizeSlashes(pathStr).split('/').some((p) => p.length > 0 && SHORT_83_COMPONENT_RE.test(p));
}

// NTFS Alternate Data Stream suffix (`file:stream:$DATA` or `file::$DATA` for the default/nameless
// stream) on the FINAL path component only - a colon elsewhere (the drive-letter colon, `C:`) is not
// stream syntax. Returns {base, streamName} (streamName '' = default stream) or null if no stream
// suffix is present. `s` must already have backslashes normalized to forward slashes.
function splitNtfsStream(s) {
  const driveM = /^([A-Za-z]):(.*)$/.exec(s);
  const prefix = driveM ? driveM[1] + ':' : '';
  const body = driveM ? driveM[2] : s;
  const lastSlash = body.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : body.slice(0, lastSlash + 1);
  const last = lastSlash === -1 ? body : body.slice(lastSlash + 1);
  const m = /^([^:]+):([^:]*):\$DATA$/i.exec(last);
  if (!m) return null;
  return { base: prefix + dir + m[1], streamName: m[2] };
}

// normalizeProtectedPath: Win32-aware superset of normalizePathString. Handles device-namespace
// prefixes (`\\?\C:\...` / `\\?\UNC\server\share\...` / unknown `\\.\...`), a plain UNC network
// share, an NTFS alternate-data-stream suffix, DOS trailing-dot/trailing-space component collapsing,
// and flags an 8.3 short-name-shaped component. Returns
// {ok, canonical, comparisonPath, windowsNamespace, streamName, ambiguous} plus `short83`/`networkUnc`
// (additional metadata the spec's return shape doesn't preclude).
function normalizeProtectedPath(raw, ctx) {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, ambiguous: true, windowsNamespace: 'none', streamName: null };
  if (raw.indexOf('\0') !== -1) return { ok: false, ambiguous: true, windowsNamespace: 'none', streamName: null };
  // NOTE: the dynamic-variable check (looksUnresolvedVar) deliberately runs AFTER NTFS-stream
  // stripping below, not here - the literal `$DATA` stream-type marker (`file::$DATA`) would
  // otherwise be misread as an unresolved shell variable before it's ever recognized as ADS syntax.
  let s = raw.trim();
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    s = s.slice(1, -1);
  }

  let windowsNamespace = 'none';
  let skipDosNormalization = false;

  if (/^\\\\\?\\/.test(s)) {
    const rest = s.slice(4);
    const uncM = /^UNC\\(.+)$/i.exec(rest);
    if (uncM) {
      s = '//' + normalizeSlashes(uncM[1]);
      windowsNamespace = 'device-unc';
    } else {
      const driveM = /^([A-Za-z]):\\?(.*)$/.exec(rest);
      if (driveM) {
        s = driveM[1] + ':/' + normalizeSlashes(driveM[2]);
        windowsNamespace = 'device-drive';
      } else {
        return { ok: false, ambiguous: true, windowsNamespace: 'device-unknown', streamName: null };
      }
    }
    // `\\?\` explicitly disables the Win32 trailing-dot/trailing-space and 8.3 alias normalization -
    // a `\\?\C:\foo.` truly names a file literally ending in a dot, never collapsed to `foo`.
    skipDosNormalization = true;
  } else if (/^\\\\\.\\/.test(s)) {
    // DOS device namespace (physical drives, named devices, or a drive-letter alias) - never guess
    // at what this resolves to.
    return { ok: false, ambiguous: true, windowsNamespace: 'device-unknown', streamName: null };
  }

  const slashNorm = normalizeSlashes(s);

  if (windowsNamespace === 'none' && /^\/\/[^\/]/.test(slashNorm)) {
    return { ok: true, ambiguous: false, networkUnc: true, windowsNamespace: 'none', streamName: null, canonical: slashNorm, comparisonPath: slashNorm.toLowerCase() };
  }
  if (windowsNamespace === 'device-unc') {
    return { ok: true, ambiguous: false, networkUnc: true, windowsNamespace, streamName: null, canonical: slashNorm, comparisonPath: slashNorm.toLowerCase() };
  }

  const streamSplit = splitNtfsStream(slashNorm);
  const forNorm = streamSplit ? streamSplit.base : slashNorm;
  if (looksUnresolvedVar(forNorm)) {
    return { ok: false, ambiguous: true, windowsNamespace, streamName: streamSplit ? streamSplit.streamName : null };
  }
  const dosNormalized = skipDosNormalization ? forNorm : forNorm.split('/').map(stripDosComponent).join('/');

  const base = normalizePathString(dosNormalized, ctx.cwd);
  if (!base.ok) return { ok: false, ambiguous: true, windowsNamespace, streamName: streamSplit ? streamSplit.streamName : null };

  return {
    ok: true,
    ambiguous: false,
    canonical: base.canonical,
    comparisonPath: base.comparisonPath,
    windowsNamespace,
    streamName: streamSplit ? streamSplit.streamName : null,
    short83: !skipDosNormalization && hasShort83Component(raw),
    networkUnc: false,
  };
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
  const norm = normalizeProtectedPath(rawPath, ctx);
  if (!norm.ok) {
    if (norm.windowsNamespace === 'device-unknown') {
      return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this targets an unrecognized Windows device-namespace path (\\\\.\\...).' });
    }
    if (/\.claude[\\/]settings(\.local)?\.json$/i.test(rawPath) || /\.claude[\\/]hooks[\\/]/i.test(rawPath)) {
      return askResult(RULE.TAMPER);
    }
    return null;
  }
  // A plain UNC network share destination sends data over the network (SMB), the same egress
  // concern as the /dev/tcp redirection targets handled in classifyGlobalRedirection - never a local
  // filesystem write this scanner's protected-path list can meaningfully compare against.
  if (norm.networkUnc) {
    return askResult(RULE.EGRESS, { safeMessage: 'Needs approval: this writes to a network (UNC) share instead of a local path.' });
  }
  const entries = buildProtectedPathEntries(ctx);
  for (const e of entries) {
    if (matchesProtectedEntry(norm.comparisonPath, e)) return denyResult(RULE.TAMPER);
  }
  // An 8.3 short-name-shaped component inside/near the repo root cannot be ruled out as an alias for
  // a protected file's real short name without filesystem access - ask rather than silently compare
  // the long-name text and pass.
  if (norm.short83) {
    const repoRoot83 = normalizePathString(ctx.repoRoot, ctx.cwd);
    const insideRepo83 = repoRoot83.ok && (norm.comparisonPath === repoRoot83.comparisonPath || norm.comparisonPath.startsWith(repoRoot83.comparisonPath + '/'));
    if (insideRepo83) {
      return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this path contains an 8.3 short-name-shaped component near the repository and could not be confirmed safe.' });
    }
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
  let bareLower = normalizeSlashes(bareForm).toLowerCase();
  // R11 Blocker E: strip an NTFS alternate-data-stream suffix and per-component trailing dot/space
  // before the basename/suffix checks below, so `.env::$DATA` or `.env.` still match `.env` instead
  // of evading detection through a Windows path-identity alias.
  const streamSplit = splitNtfsStream(bareLower);
  if (streamSplit) bareLower = streamSplit.base;
  bareLower = bareLower.split('/').map(stripDosComponent).join('/');
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

// R12 Blocker H: an 8.3 short-name-shaped path component (see SHORT_83_COMPONENT_RE /
// hasShort83Component) inside/near the repository root or a home directory cannot be ruled out as an
// alias for a protected secret file's real short name without filesystem access this scanner never
// performs - e.g. `ENV~1` could well be Windows' own short name for `.env`. Only flags the ambiguity
// when the long-form path is actually near a secret-bearing location (repo root or a home candidate);
// an 8.3-shaped component somewhere completely unrelated (e.g. deep in an unrelated system directory)
// is not a plausible alias for one of THIS project's secrets and is left alone.
function hasSecretAmbiguous83(cookedPath, ctx) {
  if (typeof cookedPath !== 'string' || cookedPath.length === 0) return false;
  if (!hasShort83Component(cookedPath)) return false;
  const norm = normalizePathString(cookedPath, ctx.cwd);
  if (!norm.ok) return false;
  const repoRoot = normalizePathString(ctx.repoRoot, ctx.cwd);
  if (repoRoot.ok && (norm.comparisonPath === repoRoot.comparisonPath || norm.comparisonPath.startsWith(repoRoot.comparisonPath + '/'))) {
    return true;
  }
  const homeCandidates = getHomeCandidates(ctx.env, ctx.osHomedir);
  for (const h of homeCandidates) {
    if (norm.comparisonPath === h.comparisonPath || norm.comparisonPath.startsWith(h.comparisonPath + '/')) return true;
  }
  return false;
}

// R12 Blockers A + H: combined read-source path check shared by every classifier that reads a file's
// CONTENT (not merely lists/writes it) - a network target (dev/tcp, dev/udp, UNC share) asks EGRESS
// (never resolved/opened by this scanner); a known secret basename denies; an 8.3-ambiguous component
// near a secret-bearing location asks SECRET rather than silently comparing the long-name text and
// passing. Returns null when none apply (safe to defer as far as this check is concerned).
function classifyReadSourcePath(cooked, ctx) {
  const netHit = classifyNetworkPathToken(cooked);
  if (netHit) return netHit;
  if (isSecretPath(cooked, ctx)) return denyResult(RULE.SECRET);
  if (hasSecretAmbiguous83(cooked, ctx)) {
    return askResult(RULE.SECRET, { safeMessage: 'Needs approval: this path contains an 8.3 short-name-shaped component near a protected location and could not be confirmed safe.' });
  }
  return null;
}

// R12 Blocker A follow-up: token-aware variant of classifyReadSourcePath, used wherever the caller
// has the full `{cooked, ambiguous, hasUnquotedGlob, hasDynamicExpansion}` token metadata (a plain
// positional read-command operand) rather than just a cooked string (redirection targets, which
// classifyGlobalRedirection already order-checks for network-ness ahead of its OWN exact/dynamic
// floor). The network check runs BEFORE the unresolved-glob/dynamic-expansion floor here too - a
// target like `//server/$SHARE/file` still has its literal `//server/` prefix survive cooking (which
// never evaluates variables) even though the share segment itself is dynamic, so it must still ask
// EGRESS specifically, not fall through to the less specific SECRET ask a naive dynamic-expansion
// check-first ordering would produce.
function classifyReadSourceToken(tokenMeta, ctx) {
  if (!tokenMeta || tokenMeta.ambiguous) return askResult(RULE.COMPLEX);
  const netHit = classifyNetworkPathToken(tokenMeta.cooked);
  if (netHit) return netHit;
  if (tokenMeta.hasUnquotedGlob || tokenMeta.hasDynamicExpansion) {
    return askResult(RULE.SECRET, { safeMessage: 'Needs approval: this command reads a file whose path contains an unresolved shell glob or expansion character.' });
  }
  return classifyReadSourcePath(tokenMeta.cooked, ctx);
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
  const nonAliasConfigOverrides = [];
  // R12 Blocker D: repository/config-selector global options recorded (not resolved/compared, just
  // their presence) so the caller can floor the decision - a repository selected via -C/--git-dir/
  // --work-tree can carry a completely different (attacker-controlled) config this scanner never
  // reads, including its own command-bearing core.fsmonitor/core.pager/etc, and --namespace/--bare
  // change which refs/config git operates against in ways this scanner does not model either.
  const selectorHits = [];
  let hasNoLazyFetch = false; // R12 Blocker F
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
          // A non-alias `-c key=value` must not silently vanish from the decision - it can still
          // set a command-bearing config key (credential.helper, core.sshCommand, ...) that git
          // will later execute, or otherwise change behavior this scanner doesn't model - collected
          // here so the caller (classifyGit) can resolve/floor it instead of ignoring it entirely.
          if (!am) nonAliasConfigOverrides.push({ key, value });
        } else {
          // `-c key` with no `=value` (boolean-style config override, e.g. `-c core.bare`) - key
          // identity alone can't be resolved to a specific concern, but it must still not vanish.
          nonAliasConfigOverrides.push({ key: val, value: undefined });
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
    if (t === '-C' || t === '--git-dir' || t === '--work-tree') {
      selectorHits.push({ flag: t });
      i += 2;
      continue;
    }
    if (/^--(git-dir|work-tree)=/.test(t)) {
      selectorHits.push({ flag: t.slice(0, t.indexOf('=')) });
      i += 1;
      continue;
    }
    if (t === '--namespace') { selectorHits.push({ flag: t }); i += 2; continue; }
    if (/^--namespace=/.test(t)) { selectorHits.push({ flag: '--namespace' }); i += 1; continue; }
    if (t === '--exec-path') { i += 2; continue; }
    if (/^--exec-path=/.test(t)) { i += 1; continue; }
    if (t === '--no-lazy-fetch') { hasNoLazyFetch = true; i += 1; continue; }
    if (t === '--no-pager' || t === '-p' || t === '--paginate' || t === '--no-replace-objects') { i += 1; continue; }
    if (t === '--bare') { selectorHits.push({ flag: t }); i += 1; continue; }
    if (/^(--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-optional-locks|--html-path|--man-path|--info-path|--version|-v|--help|-h)$/.test(t)) { i += 1; continue; }
    // R10 Section 5: a leading global option this scanner does not specifically recognize must not
    // be silently treated as a zero-argument boolean flag and skipped - it might consume the very
    // next token as its value (in which case that token is NOT the subcommand), and this scanner has
    // no way to tell with confidence. Stop here and let the caller ask, rather than risk misreading
    // an option's value as the subcommand (which could silently defer on the wrong identity).
    if (t.startsWith('-')) return { index: i, aliasMap, unresolvedAliasNames, nonAliasConfigOverrides, selectorHits, hasNoLazyFetch, unknownGlobalOption: true };
    break;
  }
  return { index: i, aliasMap, unresolvedAliasNames, nonAliasConfigOverrides, selectorHits, hasNoLazyFetch };
}

// Recursively resolve `startToken` through `aliasMap` (mutated in place as nested alias values are
// discovered), following real git alias-chaining semantics: each hop's expansion may itself start
// with global options (skipped via parseGitGlobalOptions) and its own trailing tokens, which are
// prepended - in resolution order, innermost first - to the tokens the caller already had. Returns
// `{subcommand, tail, selectorHits, nonAliasConfigOverrides, hasNoLazyFetch}` on success,
// `{shellAlias, tail, selectorHits, nonAliasConfigOverrides, hasNoLazyFetch}` if a hop resolves to a
// `!`-prefixed shell alias (which is not a plain subcommand rewrite and must be evaluated as its own
// shell command by the caller - see classifyGitShellAliasInvocation), or `{ambiguous:true}` on a
// cycle, exceeding MAX_GIT_ALIAS_DEPTH, or an unresolved `--config-env` reference inside an alias
// body - never silently falls through to defer. R13 Blocker B: `selectorHits`/
// `nonAliasConfigOverrides`/`hasNoLazyFetch` accumulate across EVERY hop of the chain (never reset
// per-hop) so a repository selector, a safe/unsafe core.fsmonitor override, or a --no-lazy-fetch
// proof buried inside an alias BODY is never silently dropped just because it didn't appear on the
// top-level command line - the caller (classifyGit) merges these into the same floors it already
// computes for its own top-level `-c`/global options. R14 Blocker A: `tail` (tokens accumulated from
// EARLIER hops, e.g. `alias.a='b push'` contributes tail=['push'] before reaching `b`) is now
// returned on the shellAlias exit too - previously only the plain-subcommand exit preserved it,
// silently discarding real git argv the shell alias would actually receive. R14 Blocker B: merging a
// hop's freshly-parsed `g.aliasMap` into the accumulating `aliasMap` now ALWAYS overwrites an
// existing entry for the same name (last-hop-wins), never guarded by a "first definition wins" check
// - an alias body's own `-c alias.NAME=...`/`--config-env=alias.NAME=...` override is evaluated at
// THIS hop, strictly later (in real git's own re-application-of-config-during-expansion sense) than
// whatever the same name meant before this hop began, and must take precedence in BOTH directions
// (a body redefining a dangerous outer alias as safe, or vice versa) - see the required precedence
// fixtures in R14 Section 8/9.
function resolveGitAlias(startToken, aliasMap, assignments) {
  let token = startToken;
  const visited = new Set();
  let tail = [];
  let hops = 0;
  const selectorHits = [];
  const nonAliasConfigOverrides = [];
  let hasNoLazyFetch = false;
  while (token !== undefined && Object.prototype.hasOwnProperty.call(aliasMap, token)) {
    if (visited.has(token)) return { ambiguous: true };
    visited.add(token);
    hops += 1;
    if (hops > MAX_GIT_ALIAS_DEPTH) return { ambiguous: true };
    const val = String(aliasMap[token]).trim();
    if (val.startsWith('!')) return { shellAlias: val, tail, selectorHits, nonAliasConfigOverrides, hasNoLazyFetch };
    // Real git splits an alias command-line value using its own internal quoting/escaping parser
    // (always POSIX-like backslash-escape rules, regardless of whatever outer dialect the top-level
    // command came from) - `p\ush` (a literal backslash, e.g. from a single-quoted top-level value
    // where the outer shell already preserved it literally) is git's own escaped form of `push`.
    const bodyResult = tokenizeCookedPosix(val);
    if (!bodyResult.ok) return { ambiguous: true };
    const bodyTokens = bodyResult.tokens;
    const g = parseGitGlobalOptions(bodyTokens, assignments);
    if (g.unresolvedAliasNames.length > 0) return { ambiguous: true };
    if (g.unknownGlobalOption) return { ambiguous: true };
    for (const k of Object.keys(g.aliasMap)) {
      aliasMap[k] = g.aliasMap[k];
    }
    for (const hit of g.selectorHits || []) selectorHits.push(hit);
    for (const ov of g.nonAliasConfigOverrides || []) nonAliasConfigOverrides.push(ov);
    if (g.hasNoLazyFetch) hasNoLazyFetch = true;
    const nextToken = bodyTokens[g.index];
    const rest = bodyTokens.slice(g.index + 1);
    tail = rest.concat(tail);
    token = nextToken;
  }
  if (token === undefined) return { ambiguous: true };
  return { subcommand: token, tail, selectorHits, nonAliasConfigOverrides, hasNoLazyFetch };
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
  const sub = subTokens[0];
  // R10 Section 7 audit fix: every other git submodule subcommand (add/init/update/deinit/sync/
  // absorbgitdirs/set-branch/set-url) writes .gitmodules, working-tree files, or repo config - only
  // `status`/`summary` are genuinely read-only queries. Previously ANY non-"foreach" subcommand
  // (including `add`) silently deferred - a real fail-open gap, not something this scanner ever
  // proved safe.
  // R12 Blocker G: subcommand-name membership alone is not proof either - any option this scanner
  // doesn't specifically recognize still asks rather than silently deferring just because the
  // sub-subcommand matched "status"/"summary". Not required to recognize real git's own status/
  // summary flags (--cached, --recursive, ...) narrowly in R12 - a blanket ask on ANY dash-prefixed
  // token satisfies the invariant without guessing at option arity.
  if (sub === 'status' || sub === 'summary') {
    for (let idx = 1; idx < subTokens.length; idx++) {
      const t = subTokens[idx];
      if (typeof t === 'string' && t[0] === '-' && t !== '-' && t !== '--') {
        return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option for git submodule status/summary.' });
      }
    }
    return deferResult();
  }
  if (sub !== 'foreach') {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git submodule command can modify submodule configuration or working-tree content.' });
  }
  let i = 1;
  while (subTokens[i] === '--recursive' || subTokens[i] === '-q' || subTokens[i] === '--quiet') i += 1;
  const cmdToken = subTokens[i];
  const askFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a command via git submodule foreach for each submodule.' });
  if (cmdToken === undefined) return askFloor;
  const inner = classifyCommandString(cmdToken, 'posix', ctx, 0, { segments: 0 });
  return resolvedOrFloor(inner, askFloor);
}

// `git bisect run <cmd> [args...]` runs `<cmd>` (its own separate argv, not one quoted string) at
// each bisection step - same dynamic-runner invariant as submodule foreach: always at least ask,
// deny if the payload resolves to something specifically protected, never silently defer.
function classifyGitBisect(subTokens, subMeta, ctx) {
  if (subTokens.length > 0 && tokenNeedsFloor(subMeta && subMeta[0])) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: git bisect subcommand could not be resolved with confidence (dynamic or glob token).' });
  }
  const sub = subTokens[0];
  // R10 Section 7 audit fix: start/good/bad/skip/reset/replay all move HEAD to a different commit
  // (the same working-tree-mutation concern as a git checkout branch switch, which already asks) and
  // `replay <file>` re-executes bisect commands recorded in an arbitrary file - only `log` is a pure
  // read (prints the current bisect log). Previously every non-"run" subcommand silently deferred.
  // R12 Blocker G: same unsupported-option invariant as git submodule status/summary above - any
  // unrecognized option on "log" still asks, never a silent defer.
  if (sub === 'log') {
    for (let idx = 1; idx < subTokens.length; idx++) {
      const t = subTokens[idx];
      if (typeof t === 'string' && t[0] === '-' && t !== '-' && t !== '--') {
        return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option for git bisect log.' });
      }
    }
    return deferResult();
  }
  if (sub !== 'run') {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git bisect command can change working-tree state by checking out a different commit.' });
  }
  const askFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a command via git bisect run at each step.' });
  const payloadTokens = subTokens.slice(1);
  if (payloadTokens.length === 0) return askFloor;
  const rawPayload = payloadTokens.join(' ');
  const inner = classifyCommandString(rawPayload, 'posix', ctx, 0, { segments: 0 });
  return resolvedOrFloor(inner, askFloor);
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
    return resolvedOrFloor(inner, askFloor);
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

// `git -c key=value` config keys git itself later invokes as an external program - a `!`-prefixed
// value here is exactly as dangerous as a `!`-prefixed alias value (resolveGitAlias's shellAlias
// case), just reached through a different config key than `alias.*`. Matched case-insensitively,
// with `pager.*`/`difftool.*.cmd`/`mergetool.*.cmd`/`filter.*.{clean,smudge,process}` as wildcard
// families (the `*` names a pager/tool/filter, not a fixed key).
const GIT_COMMAND_BEARING_CONFIG_KEY_RES = [
  /^credential\.helper$/i,
  /^core\.sshcommand$/i,
  /^core\.editor$/i,
  /^sequence\.editor$/i,
  /^core\.pager$/i,
  /^pager\..+$/i,
  /^diff\.external$/i,
  /^difftool\..+\.cmd$/i,
  /^mergetool\..+\.cmd$/i,
  /^filter\..+\.(clean|smudge|process)$/i,
  /^core\.fsmonitor$/i,
  // R11 Blocker C additions: gpg.program/gpg.ssh.program name the external signing/verification
  // binary git invokes; log.showSignature forces the same signature-verification path as
  // --show-signature purely via config; diff.<driver>.textconv/.command define a named diff driver's
  // external program (the same risk as difftool.*.cmd, just reached through `diff.*` instead).
  /^gpg\.program$/i,
  /^gpg\.ssh\.program$/i,
  /^log\.showsignature$/i,
  /^diff\..+\.textconv$/i,
  /^diff\..+\.command$/i,
];

function isGitCommandBearingConfigKey(key) {
  return typeof key === 'string' && GIT_COMMAND_BEARING_CONFIG_KEY_RES.some((re) => re.test(key));
}

// Resolve a command-bearing config value: a `!`-prefixed value is a literal shell command (same
// convention as a `!`-prefixed git alias) and is recursively classified; anything else (a bare
// helper/program name, e.g. `credential.helper=store`) is not a shell command string this scanner
// can safely interpret, so it floors to ask rather than guessing whether the named program is safe.
function classifyGitConfigBearingValue(value, ctx) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (!v.startsWith('!')) {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git command sets a config value that can run an external program.' });
  }
  const cmdText = v.slice(1).trim();
  if (cmdText.length === 0) return askResult(RULE.TAMPER);
  const inner = classifyCommandString(cmdText, 'posix', ctx, 0, { segments: 0 });
  if (inner.decision === 'deny') return inner;
  return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git command sets a config value that runs a command this scanner could not fully resolve.' });
}

// R12 Blocker E / R13 Blocker B: core.fsmonitor also accepts a literal boolean (disabling git's
// built-in filesystem-monitor integration entirely, not naming an external hook program) - a literal
// safe value is not a command at all and must NOT go through the generic command-bearing-value ask
// below. Shared between the top-level `-c`/config-override loop and the alias-body context merge so
// both apply the exact same policy to a safe value found in either place.
const FSMONITOR_SAFE_VALUE_RE = /^(false|0|no|off)$/i;

// Classifies a single non-alias config override for the purposes of the running floor: a literal
// safe core.fsmonitor value contributes no floor at all (`fsmonitorSafe: true`, the caller sets its
// own fsmonitorDisabledProven flag); a command-bearing key's value is resolved via
// classifyGitConfigBearingValue (may itself be a `deny`, which the caller must return immediately);
// anything else floors to ask TAMPER, exactly as it always has for an override this scanner cannot
// otherwise interpret.
function classifyGitConfigOverrideForFloor(ov, ctx) {
  if (/^core\.fsmonitor$/i.test(ov.key) && typeof ov.value === 'string' && FSMONITOR_SAFE_VALUE_RE.test(ov.value.trim())) {
    return { fsmonitorSafe: true };
  }
  if (isGitCommandBearingConfigKey(ov.key)) {
    return { floor: classifyGitConfigBearingValue(ov.value, ctx) };
  }
  return { floor: askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git command sets a config value that could not be resolved with confidence.' }) };
}

// Applies a list of non-alias config overrides (from the top-level command OR an alias body) to a
// running floor, honoring the core.fsmonitor safe-value carve-out. A command-bearing override that
// resolves to `deny` is surfaced via `denyResult` for the caller to return immediately - mirrors the
// pre-existing top-level behavior (a `!`-prefixed value that confidently resolves to a protected
// payload denies outright, regardless of which subcommand follows).
function applyConfigOverridesToFloor(floor, overrides, ctx, fsmonitorProven) {
  let resultFloor = floor;
  let fsmonitorDisabledProven = fsmonitorProven;
  for (const ov of overrides || []) {
    const r = classifyGitConfigOverrideForFloor(ov, ctx);
    if (r.fsmonitorSafe) { fsmonitorDisabledProven = true; continue; }
    if (r.floor.decision === 'deny') return { floor: resultFloor, fsmonitorDisabledProven, denyResult: r.floor };
    resultFloor = worseOf(resultFloor, r.floor);
  }
  return { floor: resultFloor, fsmonitorDisabledProven, denyResult: null };
}

// R12 Blocker D / R13 Blocker B: repository/config selector global options (-C/--git-dir/--work-tree/
// --namespace/--bare) floor the decision, whether they appeared on the top-level command line or
// inside a git alias body - -C/--git-dir/--work-tree select an entirely different (potentially
// attacker-controlled) repository and config; --namespace/--bare change which refs/config are in
// play. Shared between the top-level parse and the alias-context merge so both apply the identical
// policy.
function mergeSelectorHitsIntoFloor(floor, selectorHits) {
  let result = floor;
  for (const hit of selectorHits || []) {
    if (hit.flag === '-C' || hit.flag === '--git-dir' || hit.flag === '--work-tree') {
      result = worseOf(result, askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git invocation selects a different repository/config or work-tree location, which this scanner cannot audit.' }));
    } else {
      result = worseOf(result, askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this git invocation changes the ref namespace or bare-repository mode, which this scanner does not model.' }));
    }
  }
  return result;
}

// R9 fail-closed policy: only a subcommand PROVEN read-only may defer at the bottom of classifyGit -
// everything else (anything not specifically dispatched above this point) asks. `config`/`remote`
// keep their own narrower, already-audited read-only recognition inside their dedicated classifiers
// (see classifyGitConfig's --get/--list branch and classifyGitRemote's bare/-v/get-url branch) -
// this list is only consulted for subcommands that reach the very end of classifyGit unhandled.
const GIT_READONLY_SUBCOMMANDS = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file']);

// R10 Section 5: the subcommand name alone does not prove the invocation is read-only - `diff`/
// `log`/`show` can redirect their output to an arbitrary file (`--output[=]FILE`, a real write, not
// a display), and `diff`/`log`/`show`/`cat-file` can invoke an external diff/textconv/content-filter
// driver named in repository config or `.gitattributes` (`--ext-diff`, `--textconv`, `cat-file
// --filters`, `cat-file --textconv`) - this scanner does not inspect that config, so it can never
// confirm the driver is safe. Only once neither shape is present does the subcommand defer.
const GIT_OUTPUT_FILE_SUBCOMMANDS = new Set(['diff', 'log', 'show']);
const GIT_EXTCONTENT_SUBCOMMANDS = new Set(['diff', 'log', 'show']);

// R11 Blocker C: metadata-only diff display modes never render file content, so they never invoke a
// textconv/ext-diff driver - a `diff`/`show` invocation may defer ONLY when every flag present is in
// this set (or --no-textconv/--no-ext-diff are both explicitly present, checked separately).
const GIT_DIFF_SHOW_METADATA_ONLY_RE = /^(--stat|--shortstat|--numstat|--name-only|--name-status|--raw|--summary|--check)$/;

// R11 Blocker D: per-subcommand recognized-flag tables for the "unsupported option -> ask" invariant.
// Only dash-prefixed tokens are checked against these - a positional revision/pathspec/object
// argument is never required to be in an allowlist to pass through.
const GIT_READONLY_FLAG_TABLES = {
  status: {
    bool: new Set(['-s', '--short', '-b', '--branch', '-v', '--verbose', '--porcelain', '--long']),
    re: /^--untracked-files(=\S+)?$|^-u(no|normal|all)?$/,
  },
  log: {
    bool: new Set(['--oneline', '-p', '-u', '--patch', '--patch-with-stat', '--stat', '--name-only', '--name-status', '--show-signature', '--no-textconv', '--no-ext-diff']),
    re: /^-[0-9]+$|^--(format|pretty)(=.*)?$/,
  },
  'rev-parse': {
    bool: new Set(['--verify', '--short', '--is-inside-work-tree', '--show-toplevel', '--abbrev-ref', '--symbolic-full-name', '-q', '--quiet']),
  },
  'ls-files': {
    bool: new Set(['-c', '--cached', '-d', '--deleted', '-m', '--modified', '-o', '--others', '-i', '--ignored', '--exclude-standard', '-z']),
  },
  'ls-tree': {
    bool: new Set(['-r', '-d', '-l', '--long', '-z', '--name-only', '--name-status', '--abbrev', '--full-tree']),
  },
  'cat-file': {
    bool: new Set(['-p', '-t', '-s', '-e', '--batch', '--batch-check', '--follow-symlinks']),
  },
};

function isRecognizedGitReadonlyFlag(subcommand, raw) {
  const table = GIT_READONLY_FLAG_TABLES[subcommand];
  if (!table) return false;
  if (table.bool && table.bool.has(raw)) return true;
  if (table.re && table.re.test(raw)) return true;
  return false;
}

function classifyGitReadonlyUnknownOptionGuard(subcommand, subTokens) {
  for (const t of subTokens) {
    if (typeof t === 'string' && t[0] === '-' && t !== '-' && t !== '--' && !isRecognizedGitReadonlyFlag(subcommand, t)) {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option for this git read-only command.' });
    }
  }
  return null;
}

// R12 Blocker E: status/diff/ls-files can trigger a repository-configured core.fsmonitor hook
// program on every invocation (verified via a disposable marker) - this scanner never reads
// repository/global git config, so it can never confirm the monitor is disabled purely by looking at
// the command line, UNLESS the invocation itself proves it via `-c core.fsmonitor=<safe-value>`
// (see FSMONITOR_SAFE_VALUE_RE / fsmonitorDisabledProven in classifyGit).
const FSMONITOR_REFRESH_SUBCOMMANDS = new Set(['status', 'diff', 'ls-files']);

// R12 Blocker F: log/show/ls-tree/cat-file consume repository objects, which in a partial clone can
// trigger an implicit fetch from the promisor remote for any object missing locally - this scanner
// never knows whether the repository is a partial clone, so it can never confirm no such fetch can
// happen UNLESS the invocation itself proves it via `--no-lazy-fetch`/`GIT_NO_LAZY_FETCH=1` (see
// lazyFetchProven in classifyGit). `diff` is deliberately NOT included here - it already has its own
// strictly narrower Blocker C (textconv/ext-diff) gate, and the required negative control (`git -c
// core.fsmonitor=false diff --stat` -> defer, no --no-lazy-fetch needed) proves diff is gated by
// Blocker E only, not this one.
const LAZY_FETCH_OBJECT_SUBCOMMANDS = new Set(['log', 'show', 'ls-tree', 'cat-file']);

function classifyGitReadonlySubcommand(subcommand, subTokens, subMeta, ctx, fsmonitorDisabledProven, lazyFetchProven) {
  const result = classifyGitReadonlySubcommandInner(subcommand, subTokens, subMeta, ctx);
  // Only a would-be DEFER is intercepted - every ask/deny the inner classifier already produced
  // (signature verification, --output, --textconv, unknown-option guard, ...) is strictly at least as
  // protective as this floor and must pass through unchanged.
  if (result.decision !== 'defer') return result;
  if (FSMONITOR_REFRESH_SUBCOMMANDS.has(subcommand) && !fsmonitorDisabledProven) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: core.fsmonitor may run an external hook program on this refresh-triggering command; pass -c core.fsmonitor=false to prove it is disabled.' });
  }
  if (LAZY_FETCH_OBJECT_SUBCOMMANDS.has(subcommand) && !lazyFetchProven) {
    return askResult(RULE.EGRESS, { safeMessage: 'Needs approval: this reads a repository object, which in a partial clone can trigger an implicit network fetch from the promisor remote; pass --no-lazy-fetch or GIT_NO_LAZY_FETCH=1 to prove it cannot.' });
  }
  return result;
}

function classifyGitReadonlySubcommandInner(subcommand, subTokens, subMeta, ctx) {
  if (subcommand === 'cat-file') {
    for (const t of subTokens) {
      if (t === '--filters' || t === '--textconv') {
        return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: git cat-file --filters/--textconv can run an external content filter or textconv driver from repository config or .gitattributes.' });
      }
    }
    const guard = classifyGitReadonlyUnknownOptionGuard('cat-file', subTokens);
    if (guard) return guard;
    return deferResult();
  }

  // R11 Blocker C: signature verification (--show-signature, or a --format/--pretty value containing
  // a %G placeholder such as %G?/%GK/%GS/%GT) can invoke an external GPG (or gpg.ssh.program)
  // configured in git config - always ask, checked before anything else can allow a defer.
  if (subcommand === 'log' || subcommand === 'show') {
    for (let idx = 0; idx < subTokens.length; idx++) {
      const t = subTokens[idx];
      if (t === '--show-signature') {
        return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this verifies a commit/tag signature, which can invoke an external GPG (or gpg.ssh) program from git config.' });
      }
      if (t === '--format' || t === '--pretty') {
        const val = subTokens[idx + 1];
        if (typeof val === 'string' && /%G/i.test(val)) {
          return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this format string requests signature-verification data (%G placeholder).' });
        }
      }
      if (typeof t === 'string' && /^--(format|pretty)=/.test(t) && /%G/i.test(t)) {
        return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this format string requests signature-verification data (%G placeholder).' });
      }
    }
  }

  if (GIT_OUTPUT_FILE_SUBCOMMANDS.has(subcommand) || GIT_EXTCONTENT_SUBCOMMANDS.has(subcommand)) {
    for (let idx = 0; idx < subTokens.length; idx++) {
      const t = subTokens[idx];
      if (t === '--output') {
        const valTok = subMeta[idx + 1];
        if (!valTok) return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: git --output target could not be determined.' });
        const hit = checkTamperToken(valTok, ctx);
        if (hit) return hit;
        return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git command writes output to a file instead of displaying it.' });
      }
      if (typeof t === 'string' && t.indexOf('--output=') === 0) {
        const m = subMeta[idx];
        const valTok = {
          cooked: t.slice('--output='.length),
          ambiguous: m ? m.ambiguous : true,
          hasUnquotedGlob: m ? m.hasUnquotedGlob : false,
          hasDynamicExpansion: m ? m.hasDynamicExpansion : false,
        };
        const hit = checkTamperToken(valTok, ctx);
        if (hit) return hit;
        return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git command writes output to a file instead of displaying it.' });
      }
      if (t === '--ext-diff' || t === '--textconv') {
        return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this can run an external diff or textconv driver from repository config or .gitattributes.' });
      }
    }
  }

  // R11 Blocker C: `diff` is always content-producing by nature, and `show` defaults to a patch for
  // a commit target too - both may defer ONLY when proven not to invoke a driver: either every
  // dash-flag present is a metadata-only display mode (never renders content), or --no-textconv AND
  // --no-ext-diff are both explicitly present. The disallowed-flag check runs even in the
  // driver-disabled branch, so an unrecognized flag combined with --no-textconv/--no-ext-diff still asks.
  if (subcommand === 'diff' || subcommand === 'show') {
    const hasNoTextconv = subTokens.indexOf('--no-textconv') !== -1;
    const hasNoExtDiff = subTokens.indexOf('--no-ext-diff') !== -1;
    const hasMetadataOnlyModeFlag = subTokens.some((t) => typeof t === 'string' && GIT_DIFF_SHOW_METADATA_ONLY_RE.test(t));
    const hasDisallowedFlag = subTokens.some((t) => typeof t === 'string' && t[0] === '-' && t !== '-' && !GIT_DIFF_SHOW_METADATA_ONLY_RE.test(t) && t !== '--no-textconv' && t !== '--no-ext-diff');
    const isDriverDisabled = hasNoTextconv && hasNoExtDiff;
    const isMetadataOnly = hasMetadataOnlyModeFlag && !hasDisallowedFlag;
    if (!isDriverDisabled && !isMetadataOnly) {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this can render diff content through an external textconv or ext-diff driver from repository config; pass --no-textconv --no-ext-diff or a metadata-only display flag to allow.' });
    }
    if (hasDisallowedFlag) {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option for this git read-only command.' });
    }
    return deferResult();
  }

  // R11 Blocker C: `log`'s default (no patch flag) never renders diff content, so it keeps the old
  // defer-eligible path; only once a patch-producing flag is requested does the same textconv/
  // ext-diff concern apply, and only --no-textconv + --no-ext-diff (both) proves it safe.
  if (subcommand === 'log') {
    const hasPatchFlag = subTokens.some((t) => t === '-p' || t === '-u' || t === '--patch' || t === '--patch-with-stat');
    if (hasPatchFlag) {
      const hasNoTextconv = subTokens.indexOf('--no-textconv') !== -1;
      const hasNoExtDiff = subTokens.indexOf('--no-ext-diff') !== -1;
      if (!(hasNoTextconv && hasNoExtDiff)) {
        return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this shows patch content, which can invoke an external textconv or ext-diff driver from repository config.' });
      }
    }
  }

  const guard = classifyGitReadonlyUnknownOptionGuard(subcommand, subTokens);
  if (guard) return guard;
  return deferResult();
}

// Command-bearing git environment variables: whichever program these name may be invoked by git
// itself (as a pager, editor, external diff, SSH transport, or credential prompt) depending on the
// subcommand/config in play - this scanner does not model exactly when each one fires, so presence
// on ANY git invocation floors to at least ask, exactly like the existing GIT_CONFIG_* env handling.
const GIT_COMMAND_BEARING_ENV_VARS = new Set([
  'GIT_EXTERNAL_DIFF', 'GIT_PAGER', 'PAGER', 'GIT_EDITOR', 'GIT_SEQUENCE_EDITOR',
  'GIT_SSH_COMMAND', 'GIT_ASKPASS', 'SSH_ASKPASS', 'VISUAL', 'EDITOR',
]);

function classifyGitCommandBearingEnvValue(value, ctx) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git invocation sets a command-bearing environment variable (pager/editor/diff/ssh/askpass).' });
  }
  const inner = classifyCommandString(value, 'posix', ctx, 0, { segments: 0 });
  if (inner.decision === 'deny') return inner;
  return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git invocation sets a command-bearing environment variable whose program could not be fully resolved.' });
}

// R11 Blocker B: environment variables that change WHERE git reads its config/index/repository
// data from, rather than what program it runs. Not command-bearing (classifyGitCommandBearingEnvValue
// doesn't apply), but redirecting these to an attacker-controlled path is equally dangerous - e.g. an
// alternate GIT_CONFIG_GLOBAL can itself set command-bearing keys (core.pager, credential.helper) or
// an alternate GIT_INDEX_FILE/GIT_DIR can point git at a completely different repository/config tree.
const GIT_PATH_BEARING_ENV_VARS = new Set([
  'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_INDEX_FILE', 'GIT_DIR', 'GIT_COMMON_DIR',
  'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'HOME', 'USERPROFILE', 'XDG_CONFIG_HOME',
]);

function classifyGitPathBearingEnvValue(value, ambiguous, ctx) {
  if (ambiguous || typeof value !== 'string') {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git invocation overrides a config/repository path via an environment variable that could not be resolved with confidence.' });
  }
  if (detectUnquotedGlob(value, 'posix') || detectDynamicExpansion(value, 'posix')) {
    return askResult(RULE.SECRET, { safeMessage: 'Needs approval: this git invocation overrides a config/repository path with an unresolved glob or expansion character.' });
  }
  if (isSecretPath(value, ctx)) return denyResult(RULE.SECRET);
  return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git invocation overrides where Git reads its config, index, or repository data from.' });
}

// git subcommands that mutate the working tree/index at an explicit, parseable pathspec - deny on
// an exact protected-path match, ask on anything dynamic/glob/unresolved, never defer (these are
// real writes, not read-only queries).
function classifyPathspecTargets(tokens, meta, ctx) {
  if (tokens.length === 0) {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git command could not determine which paths it affects.' });
  }
  for (let idx = 0; idx < tokens.length; idx++) {
    if (tokenNeedsFloor(meta[idx])) {
      return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: git pathspec could not be resolved with confidence (dynamic or glob token).' });
    }
    const hit = checkTamperPath(tokens[idx], ctx);
    if (hit) return hit;
  }
  return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git command modifies working-tree files at an explicit path.' });
}

function classifyGitCheckout(subTokens, subMeta, ctx) {
  const dashIdx = subTokens.indexOf('--');
  if (dashIdx === -1) {
    // No pathspec separator - branch/commit switch form, which can also discard uncommitted
    // working-tree changes. Broad working-tree mutation this scanner can't fully characterize.
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git checkout may switch branches or discard working-tree changes.' });
  }
  return classifyPathspecTargets(subTokens.slice(dashIdx + 1), subMeta.slice(dashIdx + 1), ctx);
}

const GIT_RESTORE_BOOLEAN_RE = /^--(source|staged|worktree|ours|theirs|quiet|progress|no-progress)(=|$)/i;

function classifyGitRestore(subTokens, subMeta, ctx) {
  const dashIdx = subTokens.indexOf('--');
  const startIdx = dashIdx === -1 ? 0 : dashIdx + 1;
  const candidates = [];
  const candidatesMeta = [];
  for (let idx = startIdx; idx < subTokens.length; idx++) {
    const t = subTokens[idx];
    if (dashIdx === -1 && t.startsWith('-')) {
      if (!GIT_RESTORE_BOOLEAN_RE.test(t)) {
        return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: git restore option shape not recognized with confidence.' });
      }
      continue;
    }
    candidates.push(t);
    candidatesMeta.push(subMeta[idx]);
  }
  return classifyPathspecTargets(candidates, candidatesMeta, ctx);
}

const GIT_RM_BOOLEAN_FLAGS = new Set(['-r', '-f', '--force', '--cached', '-n', '--dry-run', '--ignore-unmatch', '-q', '--quiet']);

function classifyGitRm(subTokens, subMeta, ctx) {
  const candidates = [];
  const candidatesMeta = [];
  for (let idx = 0; idx < subTokens.length; idx++) {
    const t = subTokens[idx];
    if (t === '--') continue;
    if (GIT_RM_BOOLEAN_FLAGS.has(t)) continue;
    if (t.startsWith('-')) return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: git rm option shape not recognized with confidence.' });
    candidates.push(t);
    candidatesMeta.push(subMeta[idx]);
  }
  return classifyPathspecTargets(candidates, candidatesMeta, ctx);
}

function isGitCleanBooleanFlag(t) {
  if (/^--(force|dry-run|quiet)$/.test(t)) return true;
  if (/^-[a-zA-Z]+$/.test(t) && Array.from(t.slice(1)).every((c) => 'fdxXnq'.indexOf(c) !== -1)) return true;
  return false;
}

function classifyGitClean(subTokens, subMeta, ctx) {
  // -n/--dry-run only lists what would be removed - genuinely read-only, defer.
  if (subTokens.indexOf('-n') !== -1 || subTokens.indexOf('--dry-run') !== -1) return deferResult();
  const candidates = [];
  const candidatesMeta = [];
  for (let idx = 0; idx < subTokens.length; idx++) {
    const t = subTokens[idx];
    if (t === '--') continue;
    if (isGitCleanBooleanFlag(t)) continue;
    if (t.startsWith('-')) return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: git clean option shape not recognized with confidence.' });
    candidates.push(t);
    candidatesMeta.push(subMeta[idx]);
  }
  if (candidates.length === 0) {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this deletes untracked files across the working tree.' });
  }
  return classifyPathspecTargets(candidates, candidatesMeta, ctx);
}

const GIT_UPDATE_INDEX_BOOLEAN_FLAGS = new Set(['--assume-unchanged', '--no-assume-unchanged', '--skip-worktree', '--no-skip-worktree', '--again', '--refresh', '-q']);

function classifyGitUpdateIndex(subTokens, subMeta, ctx) {
  const candidates = [];
  const candidatesMeta = [];
  for (let idx = 0; idx < subTokens.length; idx++) {
    const t = subTokens[idx];
    if (t === '--') continue;
    if (GIT_UPDATE_INDEX_BOOLEAN_FLAGS.has(t)) continue;
    if (t.startsWith('-')) return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: git update-index option shape not recognized with confidence.' });
    candidates.push(t);
    candidatesMeta.push(subMeta[idx]);
  }
  if (candidates.length === 0) return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: git update-index target could not be determined.' });
  return classifyPathspecTargets(candidates, candidatesMeta, ctx);
}

// git subcommands that can rewrite/discard many working-tree files at once, where the actual set of
// affected files is determined by a patch/commit/stash this scanner does not inspect - ask always,
// with narrowly-recognized read-only sub-modes (`reset` without --hard, `apply --check`, `stash`
// without apply/pop) kept at their prior (still fail-closed by default) behavior.
const GIT_BROAD_MUTATOR_ASK_SUBCOMMANDS = new Set(['am', 'cherry-pick', 'revert', 'merge', 'switch']);

function classifyGitReset(subTokens) {
  if (subTokens.indexOf('--hard') !== -1) {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: git reset --hard discards uncommitted working-tree changes.' });
  }
  return null;
}

function classifyGitApply(subTokens) {
  if (subTokens.indexOf('--check') !== -1) return deferResult(); // read-only: validates, never writes
  return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this applies a patch to working-tree files whose content is not inspected.' });
}

function classifyGitStash(subTokens) {
  const sub = subTokens[0];
  if (sub === 'apply' || sub === 'pop') {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this restores stashed changes onto the working tree.' });
  }
  return null;
}

// Safe single-quote POSIX quoting of an already-cooked literal string value: wraps it in single
// quotes, escaping any embedded single quote as `'\''` (close quote, escaped literal quote, reopen
// quote) - re-tokenizing the result with this scanner's own POSIX word-scanner/cooker reproduces the
// exact original value, regardless of what characters it contains (spaces, `$`, backticks, ...).
function posixQuoteLiteral(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}

// R14 Blocker A: a `!`-prefixed Git shell alias receives, as real appended argv, both any tokens
// accumulated from EARLIER alias hops (`resolveGitAlias`'s `tail`) and whatever followed the alias
// name on the actual invocation (`subRestTokens`) - R13 classified only the static alias-body text in
// isolation, silently discarding these arguments (so `git -c alias.x='!git' x push` was misread as
// bare `git` instead of `git push`). `appendedTokens`/`appendedMetadata` are parallel arrays (cooked
// string, token metadata) covering exactly those appended arguments. `recursionState` carries
// `{depth, budget, aliasDepth}` inherited from the ENTIRE outer classification (see Section 10) so
// that crossing this shell-alias boundary can never reset the wrapper-depth/total-segment-budget
// counters, and is itself bounded by MAX_GIT_SHELL_ALIAS_DEPTH independent of those.
//
// Approach (Section 4): (1) classify the static alias body alone - a confidently-resolved deny from
// the text alone always wins outright, regardless of what the appended arguments turn out to be;
// (2) if every appended argument is exact/static (never ambiguous/dynamic/glob), POSIX-quote each one
// and build the effective invocation git would actually run, classify THAT too, and combine both
// results via worseOf; (3) if any appended argument is dynamic/glob/ambiguous, the effective
// invocation can't be modeled with confidence, so this floors to ask AMZ-COMPLEX-WRAPPER (unless the
// static-alone classification already denied in step 1). When the alias payload is itself a `git ...`
// invocation, the combined result (including a proven-safe defer) is trusted as-is - re-entering
// classifyGit re-derives its own selector/fsmonitor/lazy-fetch floors exactly as rigorously as a
// top-level command would; a non-git payload keeps the prior conservative floor (never surfaces a
// bare defer/ask-UNKNOWN, only a confidently resolved ask/deny).
function classifyGitShellAliasInvocation(shellCommand, appendedTokens, appendedMetadata, ctx, recursionState) {
  const shellCmd = String(shellCommand).slice(1).trim();
  if (shellCmd.length === 0) return askResult(RULE.COMPLEX);

  const aliasDepth = recursionState.aliasDepth || 0;
  if (aliasDepth >= MAX_GIT_SHELL_ALIAS_DEPTH) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this git shell-alias chain exceeds the supported recursion depth.' });
  }
  const nextDepth = (recursionState.depth || 0) + 1;
  const nextAliasDepth = aliasDepth + 1;
  const budget = recursionState.budget || { segments: 0 };

  const staticInner = classifyCommandString(shellCmd, 'posix', ctx, nextDepth, budget, undefined, nextAliasDepth);
  if (staticInner.decision === 'deny') return staticInner;

  const shellBinary = extractBinaryAndRest(shellCmd, 'posix');
  const isGitPassthrough = !!(shellBinary && !shellBinary.ambiguous && basenameOf(shellBinary.first) === 'git');
  const unresolvedFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this git alias runs a shell command that could not be fully resolved.' });

  if (!appendedTokens || appendedTokens.length === 0) {
    if (isGitPassthrough) return staticInner;
    return unresolvedFloor;
  }

  const allExact = (appendedMetadata || []).every((m) => m && !m.ambiguous && !m.hasDynamicExpansion && !m.hasUnquotedGlob);
  if (!allExact) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this git alias receives an invocation argument that could not be resolved with confidence (dynamic or glob).' });
  }

  const quotedArgs = appendedTokens.map(posixQuoteLiteral).join(' ');
  const effectiveInvocation = shellCmd + ' ' + quotedArgs;
  const effectiveInner = classifyCommandString(effectiveInvocation, 'posix', ctx, nextDepth, budget, undefined, nextAliasDepth);
  const combined = worseOf(staticInner, effectiveInner);

  if (isGitPassthrough) return combined;
  return resolvedOrFloor(combined, unresolvedFloor);
}

function classifyGit(rest, ctx, assignments, dialect, depth, budget, aliasDepth) {
  const td = dialectTokenStrings(rest, dialect);
  if (!td.ok) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: git command arguments could not be resolved with confidence.' });
  }
  const tokens = td.tokens;
  const meta = td.meta;
  const parsed = parseGitGlobalOptions(tokens, assignments);
  if (parsed.unknownGlobalOption) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: git global option is not recognized.' });
  }
  const i = parsed.index;
  const aliasMap = parsed.aliasMap;
  const unresolvedAliasNames = parsed.unresolvedAliasNames;

  // Command-bearing environment variables (R10 Section 5) - a pager/editor/external-diff/ssh/
  // askpass program name set via a leading assignment is at least ask, deny on a confidently-
  // resolved protected payload, regardless of which subcommand follows (this scanner does not model
  // exactly which subcommand triggers which of these).
  let envVarFloor = null;
  for (const a of assignments || []) {
    if (!GIT_COMMAND_BEARING_ENV_VARS.has(a.name)) continue;
    if (a.ambiguous) {
      envVarFloor = worseOf(envVarFloor, askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git invocation sets a command-bearing environment variable that could not be resolved with confidence.' }));
      continue;
    }
    const r = classifyGitCommandBearingEnvValue(a.value, ctx);
    if (r.decision === 'deny') return r;
    envVarFloor = worseOf(envVarFloor, r);
  }

  // Path-bearing environment variables (R11 Blocker B) - independent of the command-bearing set
  // above, these redirect where git reads config/index/repository data from.
  let pathEnvFloor = null;
  for (const a of assignments || []) {
    if (!GIT_PATH_BEARING_ENV_VARS.has(a.name)) continue;
    const r = classifyGitPathBearingEnvValue(a.value, a.ambiguous, ctx);
    if (r.decision === 'deny') return r;
    pathEnvFloor = worseOf(pathEnvFloor, r);
  }

  // Every non-alias `-c key=value`/`-c key` override must factor into the decision (R9 Section 8) -
  // a command-bearing key with a `!`-prefixed value can deny outright, regardless of which
  // subcommand follows (credential/editor/pager/filter hooks can fire for many git operations, not
  // just an obviously-matching one); anything else floors to at least ask. R12 Blocker E:
  // core.fsmonitor also accepts a literal boolean (disabling git's built-in filesystem-monitor
  // integration entirely, not naming an external hook program) - a literal safe value here is not a
  // command at all and must NOT go through the generic command-bearing-value ask below; it instead
  // proves (for classifyGitReadonlySubcommand's benefit) that the refresh-time execution risk is
  // closed for THIS invocation. `applyConfigOverridesToFloor`/`classifyGitConfigOverrideForFloor`
  // are shared with the R13 Blocker B alias-body context merge below, so both apply the identical
  // policy regardless of whether the override came from the top-level command line or an alias body.
  let configOverrideFloor = null;
  let fsmonitorDisabledProven = false;
  {
    const applied = applyConfigOverridesToFloor(configOverrideFloor, parsed.nonAliasConfigOverrides, ctx, fsmonitorDisabledProven);
    if (applied.denyResult) return applied.denyResult;
    configOverrideFloor = applied.floor;
    fsmonitorDisabledProven = applied.fsmonitorDisabledProven;
  }

  // R12 Blocker F: --no-lazy-fetch (global option, tracked by parseGitGlobalOptions) or
  // GIT_NO_LAZY_FETCH=1/true (leading env assignment) proves this invocation cannot trigger an
  // implicit promisor-remote fetch for a missing object in a partial clone. An env value that's
  // dynamic/ambiguous or anything other than 1/true simply leaves this unproven (same as it being
  // absent entirely) - classifyGitReadonlySubcommand's own floor below already asks EGRESS by
  // default whenever this stays false, so no separate ask/deny branch is needed here.
  let lazyFetchProven = !!parsed.hasNoLazyFetch;
  for (const a of assignments || []) {
    if (a.name !== 'GIT_NO_LAZY_FETCH') continue;
    if (!a.ambiguous && typeof a.value === 'string' && /^(1|true)$/i.test(a.value.trim())) {
      lazyFetchProven = true;
    }
  }

  // R12 Blocker D: repository/config selector global options (-C/--git-dir/--work-tree/--namespace/
  // --bare) floor the decision - see parseGitGlobalOptions' selectorHits doc comment for why.
  // Combined via worseOf like every other floor here, so it can never PREEMPT a stronger result (e.g.
  // `git -C x push` still denies GIT_PUSH) - it only ever raises a would-be weaker outcome.
  // mergeSelectorHitsIntoFloor is shared with the R13 Blocker B alias-body context merge below.
  let selectorFloor = mergeSelectorHitsIntoFloor(null, parsed.selectorHits);

  const envCfg = collectGitConfigEnvAliases(assignments);
  for (const k of Object.keys(envCfg.aliasMap)) {
    if (!Object.prototype.hasOwnProperty.call(aliasMap, k)) aliasMap[k] = envCfg.aliasMap[k];
  }

  function resolveSubcommandDecision() {
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
      // R13 Blocker B: whatever selector/config-override/lazy-fetch signal the alias BODY carried
      // (across every hop of the chain, accumulated by resolveGitAlias) must merge into the SAME
      // outer floors the top-level command's own `-c`/global options already feed - never reset,
      // never silently dropped just because it came from inside an alias rather than the literal
      // command line. Applied here BEFORE the shellAlias/subcommand branches below so it covers
      // both.
      {
        const applied = applyConfigOverridesToFloor(configOverrideFloor, resolved.nonAliasConfigOverrides, ctx, fsmonitorDisabledProven);
        if (applied.denyResult) return applied.denyResult;
        configOverrideFloor = applied.floor;
        fsmonitorDisabledProven = applied.fsmonitorDisabledProven;
      }
      selectorFloor = mergeSelectorHitsIntoFloor(selectorFloor, resolved.selectorHits);
      if (resolved.hasNoLazyFetch) lazyFetchProven = true;

      // R14 Blocker A: whatever followed the alias name on the command line (subRestTokens) plus
      // any tail already accumulated from earlier hops (resolved.tail) are real invocation
      // arguments - real git passes them as argv to a plain subcommand rewrite AND to a `!`-
      // prefixed shell alias alike, so both branches below need the same merged token/metadata
      // pair. Alias-body tail tokens come from git's own static config value (already resolved,
      // cooked via tokenizeCookedPosix at alias-expansion time), not from live shell input - there
      // is no further dynamic/glob concern to carry for them, so they get "already resolved"
      // placeholder metadata.
      const tailMeta = resolved.tail.map(() => ({ ambiguous: false, hasDynamicExpansion: false, hasUnquotedGlob: false }));
      const appendedTokens = resolved.tail.concat(subRestTokens);
      const appendedMeta = tailMeta.concat(subRestMeta);

      if (resolved.shellAlias) {
        // A `!`-prefixed alias value runs its payload as a shell command in its own right, with the
        // appended invocation arguments as real argv - see classifyGitShellAliasInvocation.
        return classifyGitShellAliasInvocation(resolved.shellAlias, appendedTokens, appendedMeta, ctx, {
          depth: depth || 0,
          budget: budget || { segments: 0 },
          aliasDepth: aliasDepth || 0,
        });
      }
      subcommand = resolved.subcommand;
      subRestTokens = appendedTokens;
      subRestMeta = appendedMeta;
    }

    if (subcommand === 'push' || subcommand === 'send-pack') return denyResult(RULE.GIT_PUSH);

    if (subcommand === 'config') return classifyGitConfig(subRestTokens, subRestMeta);
    if (subcommand === 'remote') return classifyGitRemote(subRestTokens, subRestMeta);
    if (subcommand === 'submodule') return classifyGitSubmodule(subRestTokens, subRestMeta, ctx);
    if (subcommand === 'bisect') return classifyGitBisect(subRestTokens, subRestMeta, ctx);
    const runnerHit = classifyGitCommandRunner(subcommand, subRestTokens, ctx);
    if (runnerHit) return runnerHit;

    if (subcommand === 'checkout') return classifyGitCheckout(subRestTokens, subRestMeta, ctx);
    if (subcommand === 'restore') return classifyGitRestore(subRestTokens, subRestMeta, ctx);
    if (subcommand === 'rm') return classifyGitRm(subRestTokens, subRestMeta, ctx);
    if (subcommand === 'clean') return classifyGitClean(subRestTokens, subRestMeta, ctx);
    if (subcommand === 'update-index') return classifyGitUpdateIndex(subRestTokens, subRestMeta, ctx);
    if (subcommand === 'reset') {
      const r = classifyGitReset(subRestTokens);
      if (r) return r;
    }
    if (subcommand === 'apply') return classifyGitApply(subRestTokens);
    if (subcommand === 'stash') {
      const r = classifyGitStash(subRestTokens);
      if (r) return r;
    }
    if (GIT_BROAD_MUTATOR_ASK_SUBCOMMANDS.has(subcommand)) {
      return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git command can modify multiple working-tree files in ways this scanner cannot scope down.' });
    }

    // git commit is a recognized ASK family (shared baseline: Bash(git commit *)) that a wrapper
    // can hide from the literal-prefix matcher - always ask here too, direct or wrapped.
    if (subcommand === 'commit') return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this git command requires manual approval.' });

    // GIT_CONFIG_* env assignments were present but didn't resolve through to a specifically
    // dangerous subcommand above - arbitrary config injection is still at least ask, never defer.
    if (envCfg.hasGitConfigEnv) return askResult(RULE.TAMPER);

    // R9 fail-closed fallback: only a subcommand proven read-only may defer here. R10 Section 5:
    // the subcommand name alone is not proof - classifyGitReadonlySubcommand inspects the option
    // shape too (--output/--ext-diff/--textconv/cat-file --filters) before allowing it to defer.
    if (GIT_READONLY_SUBCOMMANDS.has(subcommand)) {
      return classifyGitReadonlySubcommand(subcommand, subRestTokens, subRestMeta, ctx, fsmonitorDisabledProven, lazyFetchProven);
    }
    // R13 Section 8: an alias can expand to a token sequence whose first word isn't a real git
    // subcommand at all (e.g. `alias.y = "npm publish"`) - real git would try an external `git-npm`
    // dispatch and fail, but this scanner's conservative worldview instead gives the token sequence
    // one more chance: a final recursive classification as its own standalone command, exactly like
    // a `!`-prefixed shell alias gets. resolvedOrFloor still floors an unresolved/defer/ask-UNKNOWN
    // inner result up to the exact same generic ask this fallback always returned before - only a
    // CONFIDENTLY resolved ask/deny from the inner classification is ever surfaced instead, so this
    // can only ever raise (never lower) what would otherwise have been returned here.
    const unrecognizedFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized git subcommand.' });
    const payload = [subcommand].concat(subRestTokens).join(' ');
    const inner = classifyCommandString(payload, 'posix', ctx, 0, { segments: 0 });
    return resolvedOrFloor(inner, unrecognizedFloor);
  }

  const result = resolveSubcommandDecision();
  const floor = worseOf(worseOf(worseOf(configOverrideFloor, envVarFloor), pathEnvFloor), selectorFloor);
  return floor ? worseOf(floor, result) : result;
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
    // R12 Blocker G: presence of a recognized read-only flag somewhere in the token list is not
    // proof every OTHER token is also safe - an unrecognized option (or a config-key positional
    // this scanner doesn't need to further examine while read-only) must still ask rather than
    // silently defer just because one keyword matched. A non-dash positional (the key being
    // queried, for `--get <key>`) is left unexamined, same as before.
    for (const p of tokens) {
      if (p.value.startsWith('-') && !/^(--get-all|--get|--list|-l|--show-origin|--show-scope)$/i.test(p.value)) {
        return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option for this git config read-only command.' });
      }
    }
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
  // R10 Section 7 audit fix: only `show`/`get-url` are genuinely read-only queries - `prune` deletes
  // stale remote-tracking refs, `update` fetches from every configured remote (network egress plus
  // ref changes), and `set-head`/`set-branches` rewrite tracking configuration. Previously every
  // subcommand other than the deny-listed ones silently deferred.
  // R12 Blocker C: `git remote show <name>` contacts the named remote over the network to list its
  // branches/HEAD (unless `-n` is given, which suppresses that query and only prints locally-cached
  // information) - genuinely read-only only in the `-n` shape. R12 Blocker G: any option this scanner
  // doesn't specifically recognize (for either `show` or `get-url`) asks rather than silently
  // deferring just because the sub-subcommand name matched.
  if (/^show$/i.test(sub)) {
    const after = tokens.slice(i + 1);
    let hasNoQuery = false;
    let endOfOptions = false;
    for (const t of after) {
      if (endOfOptions) continue;
      if (t === '--') { endOfOptions = true; continue; }
      if (t === '-n') { hasNoQuery = true; continue; }
      if (/^(-v|--verbose)$/i.test(t)) continue;
      if (typeof t === 'string' && t[0] === '-' && t !== '-') {
        return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option for git remote show.' });
      }
      // positional (remote name) - passes through unexamined, same as before.
    }
    if (hasNoQuery) return deferResult();
    return askResult(RULE.EGRESS, { safeMessage: 'Needs approval: git remote show without -n queries the remote over the network.' });
  }
  if (/^get-url$/i.test(sub)) {
    const after = tokens.slice(i + 1);
    let endOfOptions = false;
    for (const t of after) {
      if (endOfOptions) continue;
      if (t === '--') { endOfOptions = true; continue; }
      if (/^(--push|--all)$/i.test(t)) continue;
      if (typeof t === 'string' && t[0] === '-' && t !== '-') {
        return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option for git remote get-url.' });
      }
    }
    return deferResult();
  }
  return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this git remote command can modify remote-tracking configuration or contact the network.' });
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

// Explicit LOCAL-ONLY read-only package-manager subcommands - the only shapes allowed to defer once
// every mutating built-in above has been ruled out (R9 fail-closed policy: unknown subcommand must
// never default to "probably safe"). R12 Blocker B: `view`/`info`/`show`/`v` moved OUT of this set -
// they query the configured package registry over the network (see
// PACKAGE_REGISTRY_QUERY_SUBCOMMANDS below) and are never local-only, unlike `list`/`ls`/`why` which
// only inspect the local node_modules/lockfile tree.
const PACKAGE_READONLY_SUBCOMMANDS = new Set(['list', 'ls', 'why']);

// R12 Blocker B: npm/pnpm subcommands (and aliases) that fetch package metadata from the configured
// registry over the network - `show`/`v` are documented npm aliases for `view`; pnpm recognizes the
// same `view`/`info`/`show` aliases. Checked uniformly across bin (npm/pnpm/yarn) since the set of
// alias names is the same and this scanner does not need to distinguish which package manager it is
// to know a registry fetch is about to happen.
const PACKAGE_REGISTRY_QUERY_SUBCOMMANDS = new Set(['view', 'info', 'show', 'v']);

// R10 Section 6: subcommand-name membership alone does not prove the invocation is read-only -
// a dynamic/glob argument, or an option shape this scanner doesn't specifically recognize (e.g. a
// hypothetical command-bearing config flag), must still ask rather than silently defer just because
// the subcommand itself is on the allowlist. Recognized display-only flags are a narrow, explicit
// set; anything else (including a bare package/query positional, which always passes through) is
// treated conservatively.
const PACKAGE_READONLY_BOOLEAN_RE = /^--(json|long|all|global|production|dev|parseable|depth)(=\S+)?$/;
const PACKAGE_READONLY_BOOLEAN_LETTERS = 'lag';

function classifyPackageReadonlySubcommand(subTokens, subMeta) {
  for (let idx = 0; idx < subTokens.length; idx++) {
    if (tokenNeedsFloor(subMeta[idx])) {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: package manager subcommand argument could not be resolved with confidence (dynamic or glob token).' });
    }
    const t = subTokens[idx];
    if (t.startsWith('-') && t !== '-') {
      if (PACKAGE_READONLY_BOOLEAN_RE.test(t)) continue;
      if (/^-[a-zA-Z]+$/.test(t) && Array.from(t.slice(1)).every((c) => PACKAGE_READONLY_BOOLEAN_LETTERS.indexOf(c) !== -1)) continue;
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option for this package manager read-only subcommand.' });
    }
  }
  return deferResult();
}

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
  // R12 Blocker B: view/info/show/v (npm and pnpm aliases for the same registry-metadata query) hit
  // the configured package registry over the network to fetch the requested package's metadata -
  // this scanner never resolves the registry URL or makes the request, so it is at least ask EGRESS
  // regardless of option shape (unlike list/ls/why below, this is intentionally not narrowed further
  // in R12 - asking the whole group is accepted policy, not a required optimization).
  if (PACKAGE_REGISTRY_QUERY_SUBCOMMANDS.has(subcommand)) {
    return askResult(RULE.EGRESS, { safeMessage: 'Needs approval: this queries the package registry over the network for package metadata.' });
  }
  if (bin === 'yarn' && subcommand === 'npm') {
    // Yarn Berry's `yarn npm <command>` command group - only `info` is recognized as a registry
    // query here (mirrors `yarn info`/npm/pnpm `view`/`info`/`show`/`v`); any other `yarn npm`
    // sub-subcommand (publish, whoami, tag, ...) is not specifically modeled and must ask rather
    // than fall through to classifyPackageScript, which would misread "npm" as a package.json
    // script name.
    if (tokenNeedsFloor(meta[i + 1])) {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: yarn npm sub-subcommand could not be resolved with confidence (dynamic or glob token).' });
    }
    const sub2 = tokens[i + 1];
    if (sub2 === 'info') {
      return askResult(RULE.EGRESS, { safeMessage: 'Needs approval: this queries the package registry over the network for package metadata.' });
    }
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized yarn npm sub-subcommand.' });
  }
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
      return resolvedOrFloor(inner, askFloor);
    }
    const eqCall = afterSub.find((t) => t.indexOf('--call=') === 0);
    if (eqCall) {
      const inner = classifyCommandString(eqCall.slice('--call='.length), 'posix', ctx, 0, { segments: 0 });
      return resolvedOrFloor(inner, askFloor);
    }
    let rawPayload = skipLeadingRawWords(rest, i + 1).trim();
    if (/^--(\s|$)/.test(rawPayload)) rawPayload = rawPayload.replace(/^--\s*/, '');
    if (rawPayload.length === 0) return askFloor;
    const inner = classifyCommandString(rawPayload, 'posix', ctx, 0, { segments: 0 });
    return resolvedOrFloor(inner, askFloor);
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
    return resolvedOrFloor(inner, askFloor);
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
  // Explicit read-only package-manager subcommands - the only shapes allowed to defer at this
  // fallback (R9 fail-closed policy: unknown subcommand must never default to "probably safe").
  // R10 Section 6: subcommand-name membership alone is not proof either - classifyPackageReadonly
  // Subcommand additionally inspects the remaining argument list (dynamic/glob token, or an option
  // shape this scanner doesn't specifically recognize) before allowing it to defer.
  if (subcommand !== undefined && PACKAGE_READONLY_SUBCOMMANDS.has(subcommand)) {
    return classifyPackageReadonlySubcommand(tokens.slice(i + 1), meta.slice(i + 1));
  }
  // Yarn supports running a package.json script without the `run` keyword (`yarn deploy` ==
  // `yarn run deploy`) - only for yarn (npm/pnpm require the explicit subcommand), and only once
  // every recognized yarn built-in above has already been ruled out. Resolved exactly like `run
  // <name>`: deny on a protected script body, ask on a missing/unreadable/dynamic one, never defer.
  if (bin === 'yarn' && subcommand !== undefined) {
    return classifyPackageScript(subcommand, prefixPath, ctx);
  }
  // Unknown npm/pnpm subcommand (or no subcommand at all) - fail closed rather than silently
  // defer just because this scanner doesn't specifically recognize it.
  return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized package manager subcommand.' });
}

// codegraph init is a recognized ASK family (shared baseline: Bash(codegraph init *)) that a
// wrapper can hide from the literal-prefix matcher - always ask here too. R10 Section 7 audit fix:
// only the specifically-allowlisted read-only query subcommands may defer - every other/unknown
// codegraph subcommand (and a bare `codegraph` with none) asks rather than silently deferring just
// because it isn't "init".
const CODEGRAPH_READONLY_SUBCOMMANDS = new Set(['explore', 'search', 'query', 'status']);

function classifyCodegraph(rest, dialect) {
  const td = dialectTokenStrings(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: codegraph command arguments could not be resolved with confidence.' });
  if (td.tokens[0] !== undefined && tokenNeedsFloor(td.meta[0])) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: codegraph subcommand could not be resolved with confidence.' });
  }
  if (td.tokens[0] === 'init') return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this initializes a CodeGraph index.' });
  if (td.tokens[0] !== undefined && CODEGRAPH_READONLY_SUBCOMMANDS.has(td.tokens[0])) return deferResult();
  return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized codegraph subcommand.' });
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

// R10 Section 4: cat/head/tail/grep/rg moved to their own option-aware classifiers
// (classifyCatHeadTailCut / classifyGrepOptions, dispatched via classifySimpleReadonlyCommand) which
// each cover both option-shape validation AND this same secret-path check - they no longer need (or
// use) this generic flag-blind fallback.
const SECRET_READ_PRIMITIVES = new Set(['less', 'more', 'sed', 'awk', 'type', 'get-content', 'gc', 'base64', 'xxd', 'strings']);
// R12: `install` copies files exactly like `cp` (same src/dest operand grammar, already shares
// parseWriterOperands with cp for its tamper-destination check) - its source side gets the same
// secret-read/network-path scrutiny.
const SECRET_COPY_PRIMITIVES = new Set(['cp', 'copy', 'copy-item', 'install']);

// Cook a raw argument token into its semantic value before path checks, dialect-aware, so an
// escape sequence like `.e\nv` (POSIX: backslash escapes the literal `n`, semantic value `.env`),
// `.e^nv` (CMD caret) or `` .e`nv `` (PowerShell backtick) all resolve to their real semantic value
// instead of comparing the wrong raw string. Returns {ok:true, cooked} or {ambiguous:true} if the
// escape/quote structure can't be resolved with confidence - callers must ask rather than silently
// use the raw (possibly wrong) token.
function cookArgForPath(raw, dialect) {
  return cookDialectTarget(raw, dialect);
}

function classifySecretPrimitive(bin, rest, segment, dialect, ctx) {
  if (bin === '.' || bin === 'source') {
    const td = tokenizeDialectWords(rest, dialect);
    const first = td.tokens[0];
    if (first) {
      const hit = classifyReadSourceToken(first, ctx);
      if (hit) return hit;
      return askResult(RULE.COMPLEX);
    }
    return null;
  }
  if (SECRET_READ_PRIMITIVES.has(bin)) {
    const td = tokenizeDialectWords(rest, dialect);
    const tokens = td.tokens.filter((t) => t.raw && t.raw[0] !== '-');
    if (tokens.length === 0) return null;
    for (const t of tokens) {
      const hit = classifyReadSourceToken(t, ctx);
      if (hit) return hit;
    }
    return null;
  }
  if (SECRET_COPY_PRIMITIVES.has(bin)) {
    // Option-aware operand parsing (same parser classifyShellMutationTamper's destination-side
    // check uses) so a `-t DIR`/`--target-directory` value is never mistaken for a source, and a
    // combined/long boolean flag never has its arity guessed at.
    const parsed = parseWriterOperands(rest, dialect);
    if (parsed.ambiguous) return askResult(RULE.COMPLEX);
    if (parsed.unknownOption) {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for this file-reading command.' });
    }
    // Every source argument (every positional token except the last, which is the destination) is
    // a potential secret-read source for `cp`/`copy`/`copy-item`/`install`, not only the first (`cp
    // a b c dest` has three sources); with an explicit target directory (`-t DIR`) every positional
    // token is a source. A single lone token (no clear destination position) is still checked as a
    // source.
    let sources;
    if (parsed.targetDir) sources = parsed.positional;
    else if (parsed.positional.length > 1) sources = parsed.positional.slice(0, -1);
    else sources = parsed.positional;
    for (const t of sources) {
      const hit = classifyReadSourceToken(t, ctx);
      if (hit) return hit;
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
  if (!hasInlineFlag) {
    // Running a standalone project script through the interpreter (`node script.js`, `python
    // script.py`, `ruby script.rb`) rather than an inline -e/-c/-p snippet - content not inspected,
    // same standalone-script-invariant floor as directly executing a .sh/.ps1 file. Never a silent
    // defer just because there's no inline flag to pattern-match against.
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a script file through an interpreter; its content is not inspected.' });
  }

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

// awk/gawk/mawk programs can execute arbitrary commands via the `system(...)` built-in - never a
// silent defer just because the program text isn't independently recognized as dangerous. When a
// literal-string argument to `system(...)` can be extracted with confidence, it is recursively
// classified (denying on a confidently-resolved protected payload); otherwise this floors to ask.
const AWK_INTERPRETERS = new Set(['awk', 'gawk', 'mawk']);
const AWK_SYSTEM_CALL_RE = /\bsystem\s*\(\s*(['"])((?:(?!\1)[^\\]|\\.)*)\1\s*\)/;

function classifyAwkInterpreter(bin, segment, ctx) {
  if (!AWK_INTERPRETERS.has(bin)) return null;
  const askFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs an awk program, which can execute arbitrary commands via system().' });
  const m = AWK_SYSTEM_CALL_RE.exec(segment);
  if (m && m[2]) {
    const inner = classifyCommandString(m[2], 'posix', ctx, 0, { segments: 0 });
    return resolvedOrFloor(inner, askFloor);
  }
  return askFloor;
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
  return resolvedOrFloor(inner, askFloor);
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

// R10 Section 4: the binary name alone was never proof of read-only-ness - `sort -o FILE`,
// `rg --pre COMMAND`, `date --file=.env` all write/read/execute through a normal-looking coreutils
// invocation. classifySimpleReadonlyCommand replaces the old bare Set-membership check with a
// per-binary option-aware parser; a binary handled here only ever defers once its OWN parser has
// proven the specific invocation shape read-only. Binaries with no narrow parser below (awk/sed/
// find/interpreters/project runners) are still excluded entirely - their grammar can write files or
// run commands this scanner does not parse, so they must never reach this function at all.

// Binaries with no operand grammar that causes a file write, secret-content read, or command
// execution - global redirection is already checked upstream (classifyGlobalRedirection) for all of
// them, so nothing further needs inspecting here regardless of arguments.
const SIMPLE_READONLY_NOOP_BINS = new Set(['pwd', 'echo', 'printf', 'true', 'false', 'whoami']);

// `date`: only `date` / `date +FORMAT` are unconditionally read-only. `-f/--file`/`-r/--reference`
// read an arbitrary file as a source of dates/timestamps - secret-read policy applies. `-s/--set`
// changes the system clock - always ask. Any other option shape this scanner does not specifically
// recognize (including `-d/--date`, which is not in this narrow list) asks rather than being guessed at.
function classifyDateCommand(rest, dialect, ctx) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX);
  const tokens = td.tokens;
  let fileTok = null;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.raw === '-f' || t.raw === '--file' || t.raw === '-r' || t.raw === '--reference') {
      const val = tokens[i + 1];
      if (!val) return askResult(RULE.COMPLEX);
      fileTok = val;
      i += 2;
      continue;
    }
    if (typeof t.cooked === 'string' && (/^--file=/.test(t.cooked) || /^--reference=/.test(t.cooked))) {
      const eq = t.cooked.indexOf('=');
      fileTok = { cooked: t.cooked.slice(eq + 1), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
      i += 1;
      continue;
    }
    if (t.raw === '-s' || t.raw === '--set' || /^--set=/.test(t.raw)) {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this changes the system clock.' });
    }
    if (typeof t.cooked === 'string' && t.cooked[0] === '+') {
      if (tokenNeedsFloor(t)) return askResult(RULE.COMPLEX);
      i += 1;
      continue;
    }
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for date.' });
  }
  if (fileTok) {
    const hit = classifyReadSourceToken(fileTok, ctx);
    if (hit) return hit;
  }
  return deferResult();
}

// `sort`: -o/--output writes sorted output to a file (deny if protected, else ask - a real write to
// an arbitrary location is never silently allowed to defer just because the target isn't protected).
// --files0-from reads a NUL-separated list of input files from FILE - secret-read policy applies to
// FILE itself. --compress-program runs an external (de)compression program - always ask. -T/
// --temporary-directory changes where sort writes its temp files - ask if dynamic/glob or if it
// targets a protected location (explicitly "ask", not "deny", per the narrower risk of a temp-file
// directory versus an explicit output file). Plain positional input files go through the same
// secret-read policy as `cat`. Unknown option -> ask.
const SORT_BOOLEAN_LETTERS = 'bcCdfghiMmnRrsuVz';
const SORT_BOOLEAN_LONG_RE = /^--(reverse|unique|numeric-sort|ignore-case|ignore-leading-blanks|dictionary-order|general-numeric-sort|ignore-nonprinting|month-sort|human-numeric-sort|random-sort|check|merge|stable|zero-terminated|debug|version|help)$/;
const SORT_VALUE_FLAGS = new Set(['-k', '--key', '-t', '--field-separator', '-S', '--buffer-size', '--parallel']);
const SORT_VALUE_LONG_EQ_RE = /^--(key|field-separator|buffer-size|parallel|check)=/;

function isSortBooleanFlag(raw) {
  if (SORT_BOOLEAN_LONG_RE.test(raw)) return true;
  if (/^--check=\S+$/.test(raw)) return true;
  if (/^-[a-zA-Z]+$/.test(raw) && Array.from(raw.slice(1)).every((c) => SORT_BOOLEAN_LETTERS.indexOf(c) !== -1)) return true;
  return false;
}

function classifySortCommand(rest, dialect, ctx) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX);
  const tokens = td.tokens;
  let outputTok = null;
  let files0Tok = null;
  let tempDirTok = null;
  let hasCompressProgram = false;
  let endOfOptions = false;
  const positional = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (endOfOptions) { positional.push(t); i += 1; continue; }
    if (t.raw === '--') { endOfOptions = true; i += 1; continue; }
    if (t.raw === '-o' || t.raw === '--output') {
      const val = tokens[i + 1];
      if (!val) return askResult(RULE.COMPLEX);
      outputTok = val; i += 2; continue;
    }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--output=') === 0) {
      outputTok = { cooked: t.cooked.slice('--output='.length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
      i += 1; continue;
    }
    if (t.raw === '--files0-from') {
      const val = tokens[i + 1];
      if (!val) return askResult(RULE.COMPLEX);
      files0Tok = val; i += 2; continue;
    }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--files0-from=') === 0) {
      files0Tok = { cooked: t.cooked.slice('--files0-from='.length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
      i += 1; continue;
    }
    if (t.raw === '--compress-program') { hasCompressProgram = true; i += 2; continue; }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--compress-program=') === 0) { hasCompressProgram = true; i += 1; continue; }
    if (t.raw === '-T' || t.raw === '--temporary-directory') {
      const val = tokens[i + 1];
      if (!val) return askResult(RULE.COMPLEX);
      tempDirTok = val; i += 2; continue;
    }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--temporary-directory=') === 0) {
      tempDirTok = { cooked: t.cooked.slice('--temporary-directory='.length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
      i += 1; continue;
    }
    if (SORT_VALUE_FLAGS.has(t.raw)) { i += 2; continue; }
    if (SORT_VALUE_LONG_EQ_RE.test(t.raw)) { i += 1; continue; }
    if (isSortBooleanFlag(t.raw)) { i += 1; continue; }
    if (t.raw[0] === '-' && t.raw !== '-') {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for sort.' });
    }
    positional.push(t);
    i += 1;
  }

  let result = null;
  if (hasCompressProgram) {
    result = worseOf(result, askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: sort --compress-program runs an external program to (de)compress temporary files.' }));
  }
  if (tempDirTok) {
    if (tokenNeedsFloor(tempDirTok)) {
      result = worseOf(result, askResult(RULE.TAMPER, { safeMessage: 'Needs approval: sort temporary directory could not be resolved with confidence.' }));
    } else if (checkTamperPath(tempDirTok.cooked, ctx)) {
      result = worseOf(result, askResult(RULE.TAMPER, { safeMessage: 'Needs approval: sort temporary directory targets a protected location.' }));
    }
  }
  if (outputTok) {
    const hit = checkTamperToken(outputTok, ctx);
    result = worseOf(result, hit || askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this writes sorted output to a file.' }));
  }
  if (files0Tok) {
    const hit = classifyReadSourceToken(files0Tok, ctx);
    if (hit) result = worseOf(result, hit);
  }
  for (const p of positional) {
    const hit = classifyReadSourceToken(p, ctx);
    if (hit) result = worseOf(result, hit);
  }
  return result || deferResult();
}

// `uniq [OPTION] [INPUT [OUTPUT]]` - INPUT (first positional) is secret-read policy, OUTPUT (second
// positional) is tamper-destination policy. More than two positional operands, or an unrecognized
// option, is not a shape this scanner guesses at - ask.
const UNIQ_VALUE_FLAGS = new Set(['-f', '--skip-fields', '-s', '--skip-chars', '-w', '--check-chars']);
const UNIQ_VALUE_EQ_RE = /^--(skip-fields|skip-chars|check-chars)=/;
const UNIQ_BOOLEAN_LONG_RE = /^--(count|repeated|all-repeated|unique|ignore-case|zero-terminated|group|version|help)(=\S+)?$/;
const UNIQ_BOOLEAN_LETTERS = 'cDdiuz';

function classifyUniqCommand(rest, dialect, ctx) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX);
  const tokens = td.tokens;
  const positional = [];
  let endOfOptions = false;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (endOfOptions) { positional.push(t); i += 1; continue; }
    if (t.raw === '--') { endOfOptions = true; i += 1; continue; }
    if (UNIQ_VALUE_FLAGS.has(t.raw)) { i += 2; continue; }
    if (UNIQ_VALUE_EQ_RE.test(t.raw)) { i += 1; continue; }
    if (UNIQ_BOOLEAN_LONG_RE.test(t.raw)) { i += 1; continue; }
    if (/^-[a-zA-Z]+$/.test(t.raw) && Array.from(t.raw.slice(1)).every((c) => UNIQ_BOOLEAN_LETTERS.indexOf(c) !== -1)) { i += 1; continue; }
    if (t.raw[0] === '-' && t.raw !== '-') {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for uniq.' });
    }
    positional.push(t);
    i += 1;
  }
  if (positional.length > 2) return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized operand shape for uniq.' });
  let result = null;
  if (positional[0]) {
    const hit = classifyReadSourceToken(positional[0], ctx);
    if (hit) result = worseOf(result, hit);
  }
  if (positional[1]) {
    const hit = checkTamperToken(positional[1], ctx);
    if (hit) result = worseOf(result, hit);
  }
  return result || deferResult();
}

// `wc`: only --files0-from needs special handling (reads an arbitrary file naming further inputs -
// secret-read policy). Plain positional file operands are not modeled beyond the existing behavior
// (wc reveals only counts, not content) - out of this scanner's stated R10 scope for wc.
const WC_BOOLEAN_LETTERS = 'clmwL';

function classifyWcCommand(rest, dialect, ctx) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX);
  const tokens = td.tokens;
  let filesFromTok = null;
  let endOfOptions = false;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (endOfOptions) { i += 1; continue; }
    if (t.raw === '--') { endOfOptions = true; i += 1; continue; }
    if (t.raw === '--files0-from') {
      const val = tokens[i + 1];
      if (!val) return askResult(RULE.COMPLEX);
      filesFromTok = val; i += 2; continue;
    }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--files0-from=') === 0) {
      filesFromTok = { cooked: t.cooked.slice('--files0-from='.length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
      i += 1; continue;
    }
    if (t.raw === '--total' || /^--total=/.test(t.raw)) { i += (t.raw === '--total') ? 2 : 1; continue; }
    if (/^--(bytes|chars|lines|words|max-line-length|version|help)$/.test(t.raw)) { i += 1; continue; }
    if (/^-[a-zA-Z]+$/.test(t.raw) && Array.from(t.raw.slice(1)).every((c) => WC_BOOLEAN_LETTERS.indexOf(c) !== -1)) { i += 1; continue; }
    if (t.raw[0] === '-' && t.raw !== '-') {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for wc.' });
    }
    i += 1;
  }
  if (filesFromTok) {
    const hit = classifyReadSourceToken(filesFromTok, ctx);
    if (hit) return hit;
  }
  return deferResult();
}

// `cat`/`head`/`tail`/`cut`: only a narrow, explicit boolean/value option set is recognized per
// binary; unknown option -> ask. Every remaining positional (non-flag) operand goes through the
// same secret-read policy `grep`/`rg` use (deny if secret, ask if dynamic/glob/ambiguous).
function classifyCatHeadTailCut(bin, rest, dialect, ctx) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX);
  const tokens = td.tokens;
  const positional = [];
  let endOfOptions = false;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (endOfOptions) { positional.push(t); i += 1; continue; }
    if (t.raw === '--') { endOfOptions = true; i += 1; continue; }
    let recognized = false;
    if (bin === 'cat') {
      if (/^--(show-all|number-nonblank|show-ends|number|squeeze-blank|show-tabs|show-nonprinting|version|help)$/.test(t.raw)) recognized = true;
      else if (/^-[a-zA-Z]+$/.test(t.raw) && Array.from(t.raw.slice(1)).every((c) => 'AbeEnstTuv'.indexOf(c) !== -1)) recognized = true;
    } else if (bin === 'head' || bin === 'tail') {
      if (t.raw === '-n' || t.raw === '--lines' || t.raw === '-c' || t.raw === '--bytes') { i += 2; continue; }
      if (/^(-n|-c)\S+$/.test(t.raw)) recognized = true;
      else if (/^--(lines|bytes)=/.test(t.raw)) recognized = true;
      else if (bin === 'tail' && (t.raw === '-s' || t.raw === '--sleep-interval' || t.raw === '--pid' || t.raw === '--max-unchanged-stats')) { i += 2; continue; }
      else if (bin === 'tail' && /^--(sleep-interval|pid|max-unchanged-stats)=/.test(t.raw)) recognized = true;
      else if (bin === 'tail' && (/^--(follow|retry)(=\S+)?$/.test(t.raw) || t.raw === '-f' || t.raw === '-F')) recognized = true;
      else if (/^--(quiet|silent|verbose|zero-terminated|version|help)$/.test(t.raw)) recognized = true;
      else if (/^-[a-zA-Z]+$/.test(t.raw) && Array.from(t.raw.slice(1)).every((c) => 'qvzF'.indexOf(c) !== -1)) recognized = true;
    } else if (bin === 'cut') {
      if (t.raw === '-f' || t.raw === '--fields' || t.raw === '-d' || t.raw === '--delimiter' || t.raw === '-c' || t.raw === '--characters' || t.raw === '-b' || t.raw === '--bytes' || t.raw === '--output-delimiter') { i += 2; continue; }
      if (/^--(fields|delimiter|characters|bytes|output-delimiter)=/.test(t.raw)) recognized = true;
      else if (/^-[fdcb]\S+$/.test(t.raw)) recognized = true;
      else if (/^--(only-delimited|complement|zero-terminated|version|help)$/.test(t.raw)) recognized = true;
      else if (/^-[a-zA-Z]+$/.test(t.raw) && Array.from(t.raw.slice(1)).every((c) => 'sz'.indexOf(c) !== -1)) recognized = true;
    }
    if (recognized) { i += 1; continue; }
    if (t.raw[0] === '-' && t.raw !== '-') {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for this file-reading command.' });
    }
    positional.push(t);
    i += 1;
  }
  let result = null;
  for (const p of positional) {
    const hit = classifyReadSourceToken(p, ctx);
    if (hit) result = worseOf(result, hit);
  }
  return result || deferResult();
}

// `grep`/`rg`: -f/--file[=] reads an arbitrary pattern file - secret-read policy. `rg` additionally
// supports --pre[=] (runs an external preprocessor command for every searched file - deny on a
// confidently-resolved protected payload, else ask) and --pre-glob[=] (a glob pattern, not a file
// path or command - just consumed as a recognized value flag). Every remaining positional operand
// goes through the same secret-read policy as `cat`.
const GREP_BOOLEAN_LETTERS = 'ivclLnHhrRwxoqsaIEFGPz';
const GREP_BOOLEAN_LONG_RE = /^--(ignore-case|invert-match|count|files-with-matches|files-without-match|line-number|with-filename|no-filename|recursive|dereference-recursive|word-regexp|line-regexp|only-matching|quiet|silent|text|extended-regexp|fixed-strings|basic-regexp|perl-regexp|null-data|byte-offset|no-messages|version|help)$/;
const GREP_VALUE_FLAGS = new Set(['-A', '-B', '-C', '-e', '-m', '--include', '--exclude', '--exclude-dir', '--color', '--binary-files']);
const GREP_VALUE_LONG_EQ_RE = /^--(after-context|before-context|context|regexp|max-count|include|exclude|exclude-dir|color|binary-files)=/;

function classifyGrepOptions(bin, rest, dialect, ctx) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX);
  const tokens = td.tokens;
  let fileTok = null;
  let preTok = null;
  let endOfOptions = false;
  const positional = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (endOfOptions) { positional.push(t); i += 1; continue; }
    if (t.raw === '--') { endOfOptions = true; i += 1; continue; }
    if (t.raw === '-f' || t.raw === '--file') {
      const val = tokens[i + 1];
      if (!val) return askResult(RULE.COMPLEX);
      fileTok = val; i += 2; continue;
    }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--file=') === 0) {
      fileTok = { cooked: t.cooked.slice('--file='.length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
      i += 1; continue;
    }
    if (bin === 'rg') {
      if (t.raw === '--pre') {
        const val = tokens[i + 1];
        if (!val) return askResult(RULE.COMPLEX);
        preTok = val; i += 2; continue;
      }
      if (typeof t.cooked === 'string' && t.cooked.indexOf('--pre=') === 0) {
        preTok = { cooked: t.cooked.slice('--pre='.length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
        i += 1; continue;
      }
      if (t.raw === '--pre-glob') { i += 2; continue; }
      if (typeof t.cooked === 'string' && t.cooked.indexOf('--pre-glob=') === 0) { i += 1; continue; }
    }
    if (GREP_VALUE_FLAGS.has(t.raw)) { i += 2; continue; }
    if (GREP_VALUE_LONG_EQ_RE.test(t.raw)) { i += 1; continue; }
    if (GREP_BOOLEAN_LONG_RE.test(t.raw)) { i += 1; continue; }
    if (/^-[a-zA-Z]+$/.test(t.raw) && Array.from(t.raw.slice(1)).every((c) => GREP_BOOLEAN_LETTERS.indexOf(c) !== -1)) { i += 1; continue; }
    if (t.raw[0] === '-' && t.raw !== '-') {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for this search command.' });
    }
    positional.push(t);
    i += 1;
  }
  let result = null;
  if (fileTok) {
    const hit = classifyReadSourceToken(fileTok, ctx);
    if (hit) result = worseOf(result, hit);
  }
  if (preTok) {
    const askFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs an external preprocessor command for each searched file.' });
    if (tokenNeedsFloor(preTok)) {
      result = worseOf(result, askFloor);
    } else {
      const inner = classifyCommandString(preTok.cooked, 'posix', ctx, 0, { segments: 0 });
      result = worseOf(result, resolvedOrFloor(inner, askFloor));
    }
  }
  for (const p of positional) {
    const hit = classifyReadSourceToken(p, ctx);
    if (hit) result = worseOf(result, hit);
  }
  return result || deferResult();
}

// `ls`/`dir`/`which`/`where` only enumerate names (directory entries or PATH matches) - no operand
// shape causes a file write, secret-content read, or command execution, so a positional listing
// target (including a dynamic/glob one, e.g. `ls *.txt`) is always safe to pass through unexamined.
// R11 Blocker D: the binary being harmless is not the same as every FLAG being harmless to guess the
// arity of - an unrecognized `-`/`/`-prefixed option still asks, it just never needs a distinct
// deny-capable check the way a writer/secret-read command would.
const LS_BOOLEAN_LETTERS = 'laAhRtrS1dF';

function isLsBooleanFlag(raw) {
  if (/^--(all|almost-all|human-readable|recursive|reverse|size|color|directory|classify)(=\S+)?$/.test(raw)) return true;
  if (/^-[a-zA-Z0-9]+$/.test(raw) && Array.from(raw.slice(1)).every((c) => LS_BOOLEAN_LETTERS.indexOf(c) !== -1)) return true;
  return false;
}

function isWhichWhereBooleanFlag(raw) {
  return /^(-a|--all|-s|--silent)$/.test(raw) || /^\/[a-zA-Z]$/.test(raw);
}

function isDirBooleanFlag(raw) {
  return /^\/[a-zA-Z]$/.test(raw) || isLsBooleanFlag(raw);
}

function classifySimpleListingCommand(bin, rest, dialect) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX);
  const winStyle = bin === 'dir' || bin === 'where';
  for (const t of td.tokens) {
    const raw = t.raw;
    const isFlagShaped = raw[0] === '-' || (winStyle && raw[0] === '/');
    if (!isFlagShaped) continue;
    let recognized = false;
    if (bin === 'ls') recognized = isLsBooleanFlag(raw);
    else if (bin === 'which') recognized = isWhichWhereBooleanFlag(raw);
    else if (bin === 'where') recognized = isWhichWhereBooleanFlag(raw);
    else if (bin === 'dir') recognized = isDirBooleanFlag(raw);
    if (!recognized) {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for this listing command.' });
    }
  }
  return deferResult();
}

function classifySimpleReadonlyCommand(bin, rest, dialect, ctx) {
  if (SIMPLE_READONLY_NOOP_BINS.has(bin)) return deferResult();
  // `type` (Windows CMD file-reader semantics) was already fully vetted for secret-path content by
  // classifySecretPrimitive earlier in the pipeline (a member of SECRET_READ_PRIMITIVES) - reaching
  // this point means every argument was already confirmed exact/non-secret/non-glob/non-dynamic, so
  // no further option parsing is needed here.
  if (bin === 'type') return deferResult();
  if (bin === 'date') return classifyDateCommand(rest, dialect, ctx);
  if (bin === 'sort') return classifySortCommand(rest, dialect, ctx);
  if (bin === 'uniq') return classifyUniqCommand(rest, dialect, ctx);
  if (bin === 'wc') return classifyWcCommand(rest, dialect, ctx);
  if (bin === 'cat' || bin === 'head' || bin === 'tail' || bin === 'cut') return classifyCatHeadTailCut(bin, rest, dialect, ctx);
  if (bin === 'grep' || bin === 'rg') return classifyGrepOptions(bin, rest, dialect, ctx);
  if (bin === 'ls' || bin === 'dir' || bin === 'which' || bin === 'where') return classifySimpleListingCommand(bin, rest, dialect);
  return null;
}

const TAMPER_SRC_DEST_BINARIES = new Set(['cp', 'copy', 'copy-item', 'install']);
const TAMPER_DEST_ONLY_BINARIES = new Set(['mv', 'move', 'ren', 'rename', 'move-item', 'ln']);
const TAMPER_UNIFORM_BINARIES = new Set(['rm', 'rmdir', 'del', 'erase', 'remove-item', 'ri', 'set-content', 'add-content', 'out-file']);
// R13 Blocker A: rsync gets its own dedicated source+destination classifier (classifyRsync) - its
// option grammar (-a/-v/-z/..., --files-from, -e/--rsh, --rsync-path, ...) is entirely different from
// cp/mv's (parseWriterOperands would misread rsync's own flags as unrecognized), and unlike cp/mv it
// can name a REMOTE source or destination (rsync://, host:path, user@host:path) that must be
// recognized as network egress, not just a local path this scanner never inspected before R13.
const RSYNC_BINARIES = new Set(['rsync']);
const TAMPER_MUTATION_BINARIES = new Set([
  ...TAMPER_SRC_DEST_BINARIES, ...TAMPER_DEST_ONLY_BINARIES, ...TAMPER_UNIFORM_BINARIES, ...RSYNC_BINARIES,
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

// Basename of an already-cooked path string (NOT basenameOf, which is for executable names and
// strips .exe/.cmd/.bat and lowercases - wrong for a general file/directory path).
function pathBasename(cookedPath) {
  const norm = cookedPath.replace(/\\/g, '/').replace(/\/+$/, '');
  const idx = norm.lastIndexOf('/');
  return idx === -1 ? norm : norm.slice(idx + 1);
}

// Known boolean (no-argument) flags for cp/mv/install/ln - both long forms and any cluster of
// known single-letter flags (`-rf`, `-sf`, ...), mirroring the combined-short-flag pattern already
// used for `rm`/`git clean`. Any OTHER `-`-prefixed token has unrecognized arity and floors to ask
// rather than guessing whether it consumes a following value.
const CP_MV_BOOLEAN_LETTERS = 'rRfvpainuls';
const CP_MV_BOOLEAN_LONG_RE = /^--(recursive|force|verbose|preserve|archive|interactive|no-clobber|update|link|symbolic-link)$/;

function isCpMvBooleanFlag(raw) {
  if (CP_MV_BOOLEAN_LONG_RE.test(raw)) return true;
  if (/^--preserve=/.test(raw)) return true;
  if (/^-[a-zA-Z]+$/.test(raw) && Array.from(raw.slice(1)).every((c) => CP_MV_BOOLEAN_LETTERS.indexOf(c) !== -1)) return true;
  return false;
}

// Option-aware operand parser shared by cp/copy/copy-item/install (source+destination) and mv/
// move/ren/rename/move-item/ln (destination-only) - parses `-t <dir>`/`--target-directory[=]<dir>`/
// `-T`/`--no-target-directory`/`--` before deciding which positional tokens are sources vs the
// destination, so a directory-form destination (explicit -t, or an implicit trailing-slash
// destination) is recognized instead of naively comparing the literal last argument.
function parseWriterOperands(rest, dialect) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return { ambiguous: true };
  let targetDir = null;
  let noTargetDir = false;
  let endOfOptions = false;
  const positional = [];
  for (let idx = 0; idx < td.tokens.length; idx++) {
    const t = td.tokens[idx];
    if (endOfOptions) { positional.push(t); continue; }
    if (t.raw === '--') { endOfOptions = true; continue; }
    if (t.raw === '-t' || t.raw === '--target-directory') {
      const val = td.tokens[idx + 1];
      if (!val) return { ambiguous: true };
      targetDir = val;
      idx += 1;
      continue;
    }
    if (t.cooked !== null && t.cooked.indexOf('--target-directory=') === 0) {
      targetDir = {
        cooked: t.cooked.slice('--target-directory='.length),
        ambiguous: t.ambiguous,
        hasUnquotedGlob: t.hasUnquotedGlob,
        hasDynamicExpansion: t.hasDynamicExpansion,
      };
      continue;
    }
    if (t.raw === '-T' || t.raw === '--no-target-directory') { noTargetDir = true; continue; }
    if (isCpMvBooleanFlag(t.raw)) continue;
    if (t.raw[0] === '-' && t.raw !== '-') return { unknownOption: true };
    positional.push(t);
  }
  return { ok: true, targetDir, noTargetDir, positional };
}

// From a parsed writer-operand set, decide destination mode: an explicit -t/--target-directory (or
// an implicit trailing-slash last positional argument, unless -T forced file mode) means EVERY
// positional token is a source landing in that directory under its own basename; otherwise the
// last positional token is the exact destination file and everything before it is a source.
function resolveWriterDestination(parsed) {
  if (parsed.targetDir) {
    return { mode: 'dir', dirTok: parsed.targetDir, sources: parsed.positional };
  }
  if (parsed.positional.length === 0) return { mode: 'none' };
  const last = parsed.positional[parsed.positional.length - 1];
  const isDirForm = !parsed.noTargetDir && typeof last.cooked === 'string' && /\/$/.test(last.cooked);
  if (isDirForm) {
    return { mode: 'dir', dirTok: last, sources: parsed.positional.slice(0, -1) };
  }
  return { mode: 'file', destTok: last, sources: parsed.positional.slice(0, -1) };
}

function classifyWriterDestination(bin, rest, dialect, ctx) {
  const parsed = parseWriterOperands(rest, dialect);
  if (parsed.ambiguous) return askResult(RULE.COMPLEX);
  if (parsed.unknownOption) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for this file-writing command.' });
  }
  // cp/copy/copy-item/install with fewer than 2 positional operands (and no -t) has no clear
  // destination position - classifySecretPrimitive's source-check (for the src/dest family) still
  // evaluates the lone token as a source instead.
  if (TAMPER_SRC_DEST_BINARIES.has(bin) && !parsed.targetDir && parsed.positional.length < 2) {
    return null;
  }
  const resolved = resolveWriterDestination(parsed);
  if (resolved.mode === 'none') return null;
  if (resolved.mode === 'file') return checkTamperToken(resolved.destTok, ctx);
  // mode === 'dir': check every source's basename landing inside the target directory.
  if (tokenNeedsFloor(resolved.dirTok)) {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: destination directory could not be resolved with confidence.' });
  }
  for (const src of resolved.sources) {
    if (tokenNeedsFloor(src)) {
      return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this command writes into a directory using a source name that could not be resolved with confidence.' });
    }
    const candidatePath = resolved.dirTok.cooked.replace(/\/+$/, '') + '/' + pathBasename(src.cooked);
    const hit = checkTamperPath(candidatePath, ctx);
    if (hit) return hit;
    if (/claude\.md$/i.test(candidatePath.replace(/\\/g, '/'))) return askResult(RULE.TAMPER);
  }
  return null;
}

// ===================== R13 Blocker A: rsync source/destination classification =====================

// A `[user@]host:path` remote-shell spec or a `host::module/path` rsync-daemon spec - real rsync's
// own syntax, distinct from a UNC path or /dev/tcp special file. A bare single ASCII letter
// immediately followed by `:` is a Windows drive letter (`C:/repo`), never a remote host, and is
// deliberately excluded here (with no `user@` prefix) so a plain local absolute path is never
// misread as a network target.
function isRsyncRemoteSpec(cooked) {
  if (typeof cooked !== 'string') return false;
  if (/^rsync:\/\//i.test(cooked)) return true;
  const m = /^([A-Za-z0-9._-]+@)?([A-Za-z0-9][A-Za-z0-9._-]*):(.*)$/.exec(cooked);
  if (!m) return false;
  const userPart = m[1];
  const host = m[2];
  if (!userPart && host.length === 1) return false;
  return true;
}

// Combines the shared network-path detector (dev/tcp, dev/udp, plain UNC) with rsync's own remote-
// spec forms (rsync://, host:path, user@host:path) and the `\\?\UNC\...` device-namespace UNC alias
// (which classifyNetworkPathToken deliberately excludes, since that form is normally local-path-alias
// territory handled by normalizeProtectedPath instead - here it is unambiguously a network share).
function isRsyncNetworkTarget(cooked, ctx) {
  if (typeof cooked !== 'string') return false;
  if (classifyNetworkPathToken(cooked)) return true;
  if (isRsyncRemoteSpec(cooked)) return true;
  const norm = normalizeProtectedPath(cooked, ctx);
  return !!(norm && norm.networkUnc);
}

function classifyRsyncNetworkToken(cooked, ctx) {
  if (!isRsyncNetworkTarget(cooked, ctx)) return null;
  return askResult(RULE.EGRESS, { safeMessage: 'Needs approval: this rsync operand references a network destination (UNC share, rsync:// URL, or remote host:path spec), not a local file.' });
}

// A source operand (positional source, --files-from/--exclude-from/--include-from/--password-file
// value) goes through network-path, secret-read, dynamic/glob, and Windows-path-ambiguity policy -
// the same four policies classifyReadSourceToken already applies elsewhere, plus rsync's own wider
// network-spec recognition.
function classifyRsyncSourceToken(tokenMeta, ctx) {
  if (!tokenMeta || tokenMeta.ambiguous) return askResult(RULE.COMPLEX);
  const netHit = classifyRsyncNetworkToken(tokenMeta.cooked, ctx);
  if (netHit) return netHit;
  if (tokenMeta.hasUnquotedGlob || tokenMeta.hasDynamicExpansion) {
    return askResult(RULE.SECRET, { safeMessage: 'Needs approval: this command reads a file whose path contains an unresolved shell glob or expansion character.' });
  }
  if (isSecretPath(tokenMeta.cooked, ctx)) return denyResult(RULE.SECRET);
  if (hasSecretAmbiguous83(tokenMeta.cooked, ctx)) {
    return askResult(RULE.SECRET, { safeMessage: 'Needs approval: this path contains an 8.3 short-name-shaped component near a protected location and could not be confirmed safe.' });
  }
  return null;
}

// The destination operand goes through network-egress, protected-path tamper, dynamic/glob, and
// Windows-path-ambiguity policy - checkTamperPath already covers protected-path/plain-UNC/device-UNC,
// but rsync's own rsync://host:path remote-spec forms need the wider network check ahead of it (those
// never resolve to anything checkTamperPath's local-path normalization would recognize).
function classifyRsyncDestinationToken(tokenMeta, ctx) {
  if (!tokenMeta || tokenMeta.ambiguous) return askResult(RULE.COMPLEX);
  if (tokenMeta.hasUnquotedGlob || tokenMeta.hasDynamicExpansion) {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this command writes to a path containing an unresolved shell glob or expansion character.' });
  }
  const netHit = classifyRsyncNetworkToken(tokenMeta.cooked, ctx);
  if (netHit) return netHit;
  const tamperHit = checkTamperPath(tokenMeta.cooked, ctx);
  if (tamperHit) return tamperHit;
  if (/claude\.md$/i.test(tokenMeta.cooked.replace(/\\/g, '/'))) return askResult(RULE.TAMPER);
  return null;
}

// R14 Blocker C: like checkTamperPath, but additionally denies when the target DIRECTORY itself
// (rather than the target being exactly a protected entry) contains a known protected entry
// somewhere underneath it - e.g. a directory-style rsync destination option (--backup-dir/
// --partial-dir/--temp-dir) pointed straight at the AMZ safety-control directory itself
// (`.claude`, not `.claude/hooks`) is not one of checkTamperPath's exact protected paths, but rsync
// can still create/overwrite arbitrary files anywhere underneath it using its own relative-path
// structure, which is exactly as dangerous as writing the protected entry directly.
function checkTamperDirectoryTarget(rawPath, ctx) {
  const direct = checkTamperPath(rawPath, ctx);
  if (direct) return direct;
  const norm = normalizeProtectedPath(rawPath, ctx);
  if (!norm.ok || norm.networkUnc) return null;
  const entries = buildProtectedPathEntries(ctx);
  const prefix = norm.comparisonPath + '/';
  for (const e of entries) {
    if (e.path.indexOf(prefix) === 0) return denyResult(RULE.TAMPER);
  }
  return null;
}

function classifyRsyncDestinationDirToken(tokenMeta, ctx) {
  if (!tokenMeta || tokenMeta.ambiguous) return askResult(RULE.COMPLEX);
  if (tokenMeta.hasUnquotedGlob || tokenMeta.hasDynamicExpansion) {
    return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: this command writes to a directory containing an unresolved shell glob or expansion character.' });
  }
  const netHit = classifyRsyncNetworkToken(tokenMeta.cooked, ctx);
  if (netHit) return netHit;
  const tamperHit = checkTamperDirectoryTarget(tokenMeta.cooked, ctx);
  if (tamperHit) return tamperHit;
  return null;
}

// `-e`/`--rsh`/`--rsync-path` name an external command rsync invokes for the remote-shell transport
// or the remote rsync binary path - never a silent defer, deny on a confidently-resolved protected
// payload, ask otherwise.
function classifyRsyncCommandOptionValue(tokenMeta, ctx, label) {
  const askFloor = askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: ' + label + ' runs an external command whose payload could not be fully resolved.' });
  if (!tokenMeta || tokenMeta.ambiguous) return askFloor;
  if (tokenMeta.hasUnquotedGlob || tokenMeta.hasDynamicExpansion) return askFloor;
  const inner = classifyCommandString(tokenMeta.cooked, 'posix', ctx, 0, { segments: 0 });
  return resolvedOrFloor(inner, askFloor);
}

// Known rsync boolean (no-argument) short/long flags - a conservative subset covering the common
// mutation/behavior flags; anything else dash-prefixed and unrecognized floors to ask rather than
// guessing whether it consumes a following value (same invariant as CP_MV_BOOLEAN_LETTERS).
const RSYNC_BOOLEAN_LETTERS = 'avznrltpogDHASXhq8';
const RSYNC_BOOLEAN_LONG_RE = /^--(archive|verbose|dry-run|recursive|links|times|perms|owner|group|devices|specials|hard-links|acls|xattrs|sparse|human-readable|quiet|progress|delete|delete-before|delete-during|delete-after|delete-excluded|force|checksum|update|inplace|partial|compress|stats|itemize-changes|prune-empty-dirs|one-file-system|numeric-ids|whole-file|no-whole-file|del|8-bit-output)$/;

function isRsyncBooleanFlag(raw) {
  if (RSYNC_BOOLEAN_LONG_RE.test(raw)) return true;
  if (/^-[a-zA-Z0-9]+$/.test(raw) && Array.from(raw.slice(1)).every((c) => RSYNC_BOOLEAN_LETTERS.indexOf(c) !== -1)) return true;
  return false;
}

// Value-bearing rsync options whose value this scanner does not need to inspect for security purposes
// (a pattern, a numeric limit, a chmod spec, ...) - consumed as flag+value (or flag=value) so the
// value token is never mistaken for a positional source/destination operand or an unrecognized flag.
// R14 Blocker C: path-bearing options (log-file/backup-dir/partial-dir/temp-dir/write-batch/
// only-write-batch/read-batch/early-input/compare-dest/copy-dest/link-dest) and --filter/-f
// (external merge-file reference) are deliberately NOT in this set any more - see
// RSYNC_WRITE_FILE_OPTIONS/RSYNC_WRITE_DIR_OPTIONS/RSYNC_READ_PATH_OPTIONS/RSYNC_FILTER_FLAGS below.
const RSYNC_OPAQUE_VALUE_FLAGS = new Set(['--exclude', '--include', '--bwlimit', '--timeout', '--port', '--max-size', '--min-size', '--suffix', '--out-format', '--chmod', '--chown']);
const RSYNC_OPAQUE_VALUE_EQ_RE = /^--(exclude|include|bwlimit|timeout|port|max-size|min-size|suffix|out-format|chmod|chown)=/;

// R14 Blocker C: destination options whose value names a single FILE (checkTamperPath's ordinary
// exact-path semantics apply directly) vs a DIRECTORY that rsync will write arbitrary content under
// using its own internal relative-path structure (--backup-dir/--partial-dir/--temp-dir) - a
// directory-style destination must ALSO deny when a protected file/dir (.claude/settings.json,
// .claude/hooks/...) lives inside it, not merely when the directory IS one of those exact entries,
// since rsync can create arbitrarily-named files anywhere under it.
const RSYNC_WRITE_FILE_OPTIONS = { '--log-file': 'logFile', '--write-batch': 'writeBatch', '--only-write-batch': 'onlyWriteBatch' };
const RSYNC_WRITE_DIR_OPTIONS = { '--backup-dir': 'backupDir', '--partial-dir': 'partialDir', '--temp-dir': 'tempDir' };
// Read-side path-bearing options (a single file to read, or a comparison/hard-link-source
// directory rsync reads from) - all get the same network/secret/dynamic/8.3 policy as an ordinary
// read source (classifyRsyncSourceToken already covers the directory case too via isSecretPath's
// `secrets/` substring match).
const RSYNC_READ_PATH_OPTIONS = { '--read-batch': 'readBatch', '--early-input': 'earlyInput', '--compare-dest': 'compareDest', '--copy-dest': 'copyDest', '--link-dest': 'linkDest' };

// `rsync [OPTION...] SOURCE... DEST` - every positional operand except the last is a source, the
// last is the destination; fewer than 2 positional operands (after option parsing) leaves the
// source/destination split undetermined. Unlike cp/mv, rsync has no -t/--target-directory equivalent
// and no directory-form-destination ambiguity to resolve.
function parseRsyncOperands(rest, dialect) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return { ambiguous: true };
  const tokens = td.tokens;
  const sourceFileOptions = {};
  const commandOptions = {};
  const destinationOptions = {};
  let filterPresent = false;
  let endOfOptions = false;
  const positional = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (endOfOptions) { positional.push(t); i += 1; continue; }
    if (t.raw === '--') { endOfOptions = true; i += 1; continue; }

    if (t.raw === '--files-from') { const v = tokens[i + 1]; if (!v) return { ambiguous: true }; sourceFileOptions.filesFrom = v; i += 2; continue; }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--files-from=') === 0) {
      sourceFileOptions.filesFrom = { cooked: t.cooked.slice('--files-from='.length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
      i += 1; continue;
    }
    if (t.raw === '--exclude-from') { const v = tokens[i + 1]; if (!v) return { ambiguous: true }; sourceFileOptions.excludeFrom = v; i += 2; continue; }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--exclude-from=') === 0) {
      sourceFileOptions.excludeFrom = { cooked: t.cooked.slice('--exclude-from='.length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
      i += 1; continue;
    }
    if (t.raw === '--include-from') { const v = tokens[i + 1]; if (!v) return { ambiguous: true }; sourceFileOptions.includeFrom = v; i += 2; continue; }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--include-from=') === 0) {
      sourceFileOptions.includeFrom = { cooked: t.cooked.slice('--include-from='.length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
      i += 1; continue;
    }
    if (t.raw === '--password-file') { const v = tokens[i + 1]; if (!v) return { ambiguous: true }; sourceFileOptions.passwordFile = v; i += 2; continue; }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--password-file=') === 0) {
      sourceFileOptions.passwordFile = { cooked: t.cooked.slice('--password-file='.length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
      i += 1; continue;
    }

    // R14 Blocker C: read-side path-bearing options (--read-batch/--early-input/--compare-dest/
    // --copy-dest/--link-dest) get the same network/secret/dynamic/8.3 read-source policy as
    // --files-from et al above - never silently consumed as opaque.
    {
      const readOptMatched = Object.keys(RSYNC_READ_PATH_OPTIONS).find((flag) => t.raw === flag);
      if (readOptMatched) {
        const v = tokens[i + 1]; if (!v) return { ambiguous: true };
        sourceFileOptions[RSYNC_READ_PATH_OPTIONS[readOptMatched]] = v; i += 2; continue;
      }
      const readOptEq = Object.keys(RSYNC_READ_PATH_OPTIONS).find((flag) => typeof t.cooked === 'string' && t.cooked.indexOf(flag + '=') === 0);
      if (readOptEq) {
        sourceFileOptions[RSYNC_READ_PATH_OPTIONS[readOptEq]] = { cooked: t.cooked.slice((readOptEq + '=').length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
        i += 1; continue;
      }
    }

    // R14 Blocker C: write-side path-bearing options - FILE-style (--log-file/--write-batch/
    // --only-write-batch) get the ordinary exact-file destination policy; DIRECTORY-style
    // (--backup-dir/--partial-dir/--temp-dir/-T) additionally deny when a protected entry lives
    // underneath the directory (see classifyRsyncDestinationDirToken/checkTamperDirectoryTarget) -
    // never silently consumed as opaque.
    {
      const writeFileMatched = Object.keys(RSYNC_WRITE_FILE_OPTIONS).find((flag) => t.raw === flag);
      if (writeFileMatched) {
        const v = tokens[i + 1]; if (!v) return { ambiguous: true };
        destinationOptions[RSYNC_WRITE_FILE_OPTIONS[writeFileMatched]] = { tok: v, kind: 'file' }; i += 2; continue;
      }
      const writeFileEq = Object.keys(RSYNC_WRITE_FILE_OPTIONS).find((flag) => typeof t.cooked === 'string' && t.cooked.indexOf(flag + '=') === 0);
      if (writeFileEq) {
        const v = { cooked: t.cooked.slice((writeFileEq + '=').length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
        destinationOptions[RSYNC_WRITE_FILE_OPTIONS[writeFileEq]] = { tok: v, kind: 'file' }; i += 1; continue;
      }
      if (t.raw === '-T') {
        const v = tokens[i + 1]; if (!v) return { ambiguous: true };
        destinationOptions.tempDir = { tok: v, kind: 'dir' }; i += 2; continue;
      }
      const writeDirMatched = Object.keys(RSYNC_WRITE_DIR_OPTIONS).find((flag) => t.raw === flag);
      if (writeDirMatched) {
        const v = tokens[i + 1]; if (!v) return { ambiguous: true };
        destinationOptions[RSYNC_WRITE_DIR_OPTIONS[writeDirMatched]] = { tok: v, kind: 'dir' }; i += 2; continue;
      }
      const writeDirEq = Object.keys(RSYNC_WRITE_DIR_OPTIONS).find((flag) => typeof t.cooked === 'string' && t.cooked.indexOf(flag + '=') === 0);
      if (writeDirEq) {
        const v = { cooked: t.cooked.slice((writeDirEq + '=').length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
        destinationOptions[RSYNC_WRITE_DIR_OPTIONS[writeDirEq]] = { tok: v, kind: 'dir' }; i += 1; continue;
      }
    }

    if (t.raw === '-e') { const v = tokens[i + 1]; if (!v) return { ambiguous: true }; commandOptions.rsh = v; i += 2; continue; }
    if (t.raw === '--rsh') { const v = tokens[i + 1]; if (!v) return { ambiguous: true }; commandOptions.rsh = v; i += 2; continue; }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--rsh=') === 0) {
      commandOptions.rsh = { cooked: t.cooked.slice('--rsh='.length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
      i += 1; continue;
    }
    if (t.raw === '--rsync-path') { const v = tokens[i + 1]; if (!v) return { ambiguous: true }; commandOptions.rsyncPath = v; i += 2; continue; }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--rsync-path=') === 0) {
      commandOptions.rsyncPath = { cooked: t.cooked.slice('--rsync-path='.length), ambiguous: t.ambiguous, hasUnquotedGlob: t.hasUnquotedGlob, hasDynamicExpansion: t.hasDynamicExpansion };
      i += 1; continue;
    }

    // R14 Blocker C: --filter/-f can reference an external merge file (`merge FILE`, `. FILE`) this
    // scanner does not parse - never silently consumed as opaque; always floors to at least ask.
    if (t.raw === '--filter' || t.raw === '-f') {
      if (!tokens[i + 1]) return { ambiguous: true };
      filterPresent = true; i += 2; continue;
    }
    if (typeof t.cooked === 'string' && t.cooked.indexOf('--filter=') === 0) { filterPresent = true; i += 1; continue; }

    if (RSYNC_OPAQUE_VALUE_FLAGS.has(t.raw)) {
      if (!tokens[i + 1]) return { ambiguous: true };
      i += 2; continue;
    }
    if (RSYNC_OPAQUE_VALUE_EQ_RE.test(t.raw)) { i += 1; continue; }

    if (isRsyncBooleanFlag(t.raw)) { i += 1; continue; }
    if (t.raw[0] === '-' && t.raw !== '-') return { unknownOption: true };
    positional.push(t);
    i += 1;
  }

  if (positional.length < 2) {
    return { ok: true, sources: [], destination: null, sourceFileOptions, commandOptions, destinationOptions, filterPresent, insufficientOperands: true };
  }
  const destination = positional[positional.length - 1];
  const sources = positional.slice(0, -1);
  return { ok: true, sources, destination, sourceFileOptions, commandOptions, destinationOptions, filterPresent };
}

function classifyRsync(rest, ctx, dialect) {
  const parsed = parseRsyncOperands(rest, dialect);
  if (parsed.ambiguous) return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: rsync command arguments could not be resolved with confidence.' });
  if (parsed.unknownOption) {
    return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for rsync.' });
  }

  let result = null;

  if (parsed.commandOptions.rsh !== undefined) {
    const hit = classifyRsyncCommandOptionValue(parsed.commandOptions.rsh, ctx, 'this rsync -e/--rsh option');
    if (hit.decision === 'deny') return hit;
    result = worseOf(result, hit);
  }
  if (parsed.commandOptions.rsyncPath !== undefined) {
    const hit = classifyRsyncCommandOptionValue(parsed.commandOptions.rsyncPath, ctx, 'this rsync --rsync-path option');
    if (hit.decision === 'deny') return hit;
    result = worseOf(result, hit);
  }

  for (const key of ['filesFrom', 'excludeFrom', 'includeFrom', 'passwordFile', 'readBatch', 'earlyInput', 'compareDest', 'copyDest', 'linkDest']) {
    const tok = parsed.sourceFileOptions[key];
    if (tok === undefined) continue;
    const hit = classifyRsyncSourceToken(tok, ctx);
    if (hit) result = worseOf(result, hit);
  }

  for (const key of ['logFile', 'writeBatch', 'onlyWriteBatch', 'backupDir', 'partialDir', 'tempDir']) {
    const entry = parsed.destinationOptions[key];
    if (entry === undefined) continue;
    const hit = entry.kind === 'dir' ? classifyRsyncDestinationDirToken(entry.tok, ctx) : classifyRsyncDestinationToken(entry.tok, ctx);
    if (hit) result = worseOf(result, hit);
  }

  if (parsed.filterPresent) {
    result = worseOf(result, askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: rsync --filter/-f can reference an external merge file, which this scanner does not parse.' }));
  }

  if (parsed.insufficientOperands) {
    return worseOf(result, askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: rsync source/destination could not be determined from this command.' }));
  }

  for (const src of parsed.sources) {
    const hit = classifyRsyncSourceToken(src, ctx);
    if (hit) result = worseOf(result, hit);
  }

  const destHit = classifyRsyncDestinationToken(parsed.destination, ctx);
  if (destHit) result = worseOf(result, destHit);

  return result;
}

function classifyShellMutationTamper(bin, rest, segment, dialect, ctx) {
  if (!TAMPER_MUTATION_BINARIES.has(bin)) return null;

  if (RSYNC_BINARIES.has(bin)) return classifyRsync(rest, ctx, dialect);

  if (TAMPER_SRC_DEST_BINARIES.has(bin) || TAMPER_DEST_ONLY_BINARIES.has(bin)) {
    return classifyWriterDestination(bin, rest, dialect, ctx);
  }

  const td = tokenizeDialectWords(rest, dialect);
  const tokens = td.tokens.filter((t) => t.raw && t.raw[0] !== '-');
  for (const t of tokens) {
    const hit = checkTamperToken(t, ctx);
    if (hit) return hit;
  }
  return null;
}

// ===================== R9 Section 6: direct writer commands =====================
// tee/truncate/touch/dd/sed -i/patch write files through their own dedicated grammar (not a
// source/destination split like cp/mv) - each gets a narrow, conservative operand parser. An
// unrecognized option shape floors to ask (never guessed at), and every recognized target gets the
// same checkTamperToken treatment as any other tamper-target path.

const TEE_BOOLEAN_RE = /^(-a|--append|-i|--ignore-interrupts|-p|--output-error(=.*)?)$/;

function classifyTee(rest, dialect, ctx) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX);
  const targets = [];
  for (const t of td.tokens) {
    if (TEE_BOOLEAN_RE.test(t.raw)) continue;
    if (t.raw[0] === '-' && t.raw !== '-') {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for this file-writing command.' });
    }
    targets.push(t);
  }
  for (const t of targets) {
    const hit = checkTamperToken(t, ctx);
    if (hit) return hit;
  }
  return null;
}

function classifyTruncate(rest, dialect, ctx) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX);
  const targets = [];
  for (let idx = 0; idx < td.tokens.length; idx++) {
    const t = td.tokens[idx];
    if (t.raw === '-s' || t.raw === '--size' || t.raw === '-r' || t.raw === '--reference') { idx += 1; continue; }
    if (/^--(size|reference)=/.test(t.raw)) continue;
    if (t.raw === '-c' || t.raw === '--no-create' || t.raw === '-o' || t.raw === '--io-blocks') continue;
    if (t.raw[0] === '-' && t.raw !== '-') {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for this file-writing command.' });
    }
    targets.push(t);
  }
  for (const t of targets) {
    const hit = checkTamperToken(t, ctx);
    if (hit) return hit;
  }
  return null;
}

const TOUCH_BOOLEAN_RE = /^(-a|-c|--no-create|-m|-h|--no-dereference)$/;

function classifyTouch(rest, dialect, ctx) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX);
  const targets = [];
  for (const t of td.tokens) {
    if (TOUCH_BOOLEAN_RE.test(t.raw)) continue;
    if (t.raw[0] === '-' && t.raw !== '-') {
      // -d/-t/-r and other value-bearing flags this scanner doesn't specifically model - can't be
      // sure whether the next token is that flag's value or a target file, so ask rather than guess.
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for this file-writing command.' });
    }
    targets.push(t);
  }
  for (const t of targets) {
    const hit = checkTamperToken(t, ctx);
    if (hit) return hit;
  }
  return null;
}

function classifyDd(rest, dialect, ctx) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX);
  for (const t of td.tokens) {
    if (t.cooked !== null && t.cooked.indexOf('of=') === 0) {
      const valTok = {
        cooked: t.cooked.slice('of='.length),
        ambiguous: t.ambiguous,
        hasUnquotedGlob: t.hasUnquotedGlob,
        hasDynamicExpansion: t.hasDynamicExpansion,
      };
      return checkTamperToken(valTok, ctx);
    }
  }
  return null;
}

const PATCH_BOOLEAN_RE = /^(-N|--forward|-E|--remove-empty-files|-f|--force|-s|--quiet|-u|--unified|-c|--context|-l|--ignore-whitespace|-b|--backup)$/;

function classifyPatch(rest, dialect, ctx) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return askResult(RULE.COMPLEX);
  const targets = [];
  for (const t of td.tokens) {
    if (PATCH_BOOLEAN_RE.test(t.raw)) continue;
    if (t.raw[0] === '-' && t.raw !== '-') {
      return askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: unrecognized option shape for this file-writing command.' });
    }
    targets.push(t);
  }
  if (targets.length === 0) return null;
  // `patch [ORIGFILE [PATCHFILE]]` modifies ORIGFILE (the first positional operand) in place.
  return checkTamperToken(targets[0], ctx);
}

// `sed` without -i/--in-place only writes to stdout (already covered by the global redirection
// check for `>` and by classifySecretPrimitive's SECRET_READ_PRIMITIVES handling for its file
// arguments) - only the in-place form is a direct file-writing concern handled here.
function classifySedInPlace(rest, dialect, ctx) {
  const td = tokenizeDialectWords(rest, dialect);
  if (!td.ok) return null;
  const hasInPlace = td.tokens.some((t) => t.raw === '-i' || t.raw === '--in-place' || /^-i\S/.test(t.raw) || /^--in-place=/.test(t.raw));
  if (!hasInPlace) return null;
  const hasExprFlag = td.tokens.some((t) => t.raw === '-e' || t.raw === '-f' || /^--expression=/.test(t.raw) || /^--file=/.test(t.raw));
  const nonFlag = td.tokens.filter((t) => !(t.raw[0] === '-' && t.raw !== '-'));
  // Without -e/-f, the first non-flag token is sed's own script/expression, not a target file.
  const targets = hasExprFlag ? nonFlag : nonFlag.slice(1);
  for (const t of targets) {
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
// R11 Blocker A: Bash special network device files - `/dev/tcp/<host>/<port>` and
// `/dev/udp/<host>/<port>` open a TCP/UDP socket as a file descriptor when redirected to/from; this
// scanner never resolves the hostname or opens the socket, so any such target is at least ask. The
// literal `/dev/tcp/`/`/dev/udp/` prefix survives cooking even when host/port are dynamic (`$HOST`)
// since cooking never evaluates variables - only quote/escape structure - so this check runs before
// the generic `!exact` floor, not after it, or a dynamic-but-recognizable network target would fall
// through to the less specific TAMPER/SECRET ask instead of EGRESS.
function isDevNetworkTarget(cooked) {
  return typeof cooked === 'string' && /^\/dev\/(tcp|udp)\//i.test(cooked);
}

// A plain UNC network share (`\\server\share\...` or `//server/share\...`) is never a local
// filesystem path - writing to one sends data over the network (SMB), same concern as /dev/tcp.
// Windows device-namespace prefixes (`\\?\`, `\\.\`) are NOT plain UNC shares and are excluded here
// - those are handled by normalizeProtectedPath (R11 Blocker E) as local-path aliases instead.
function isUncNetworkTarget(cooked) {
  if (typeof cooked !== 'string') return false;
  if (/^\\\\\?\\/.test(cooked) || /^\\\\\.\\/.test(cooked)) return false;
  return /^\/\/[^\/]/.test(normalizeSlashes(cooked));
}

// R12 Blocker A: shared network-path-token classifier, consulted from every surface that names a
// file-like operand - redirection (any direction: input redirection opens the same TCP/UDP socket or
// SMB session as output/bidirectional does), a plain read command's positional argument, or a copy/
// install source. A `/dev/tcp`/`/dev/udp` special device file or a plain UNC network share is never a
// local file regardless of whether it is being read from or written to, so this asks EGRESS either
// way - hostname/share is never resolved and no connection is ever opened by this scanner.
function classifyNetworkPathToken(cooked) {
  if (typeof cooked !== 'string') return null;
  if (!isDevNetworkTarget(cooked) && !isUncNetworkTarget(cooked)) return null;
  return askResult(RULE.EGRESS, { safeMessage: 'Needs approval: this references a network destination (TCP/UDP device file or UNC share), not a local file - hostname is not resolved and no socket is opened.' });
}

function classifyGlobalRedirection(segment, ctx, dialect) {
  const redirs = scanRedirections(segment, dialect);
  for (const r of redirs) {
    if (r.ambiguous) {
      return askResult(RULE.TAMPER, { safeMessage: 'Needs approval: redirection target could not be resolved with confidence.' });
    }
    const target = r.cookedTarget;
    // R12 Blocker A: input redirection (`cat < /dev/tcp/host/80`) opens the network socket exactly
    // as reading FROM it as the shell's stdin - the direction restriction that used to gate this
    // check (out/inout only) left plain input redirection from a network device file/UNC share
    // completely unchecked. Every direction is checked now.
    const netHit = classifyNetworkPathToken(target);
    if (netHit) return netHit;
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
      // R12 Blocker H: classifyReadSourcePath also flags an 8.3-ambiguous component near a secret
      // location (in addition to the pre-existing exact-secret-basename deny this replaces).
      const readHit = classifyReadSourcePath(target, ctx);
      if (readHit) return readHit;
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

function classifyEffectiveBinary(segment, dialect, ctx, assignments, depth, budget, aliasDepth) {
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
  if (bin === 'git') return classifyGit(rest, ctx, assignments || [], dialect, depth, budget, aliasDepth);
  // `git-push`/`git-send-pack` are the real standalone binaries git's own subcommands dispatch
  // to internally (present on PATH alongside `git` itself on most POSIX installs) - invoking them
  // directly bypasses the `bin === 'git'` dispatch entirely unless handled here too.
  if (bin === 'git-push' || bin === 'git-send-pack') return denyResult(RULE.GIT_PUSH);

  if (TAMPER_MUTATION_BINARIES.has(bin)) {
    const t = classifyShellMutationTamper(bin, rest, segment, dialect, ctx);
    if (t) return t;
  }

  if (bin === 'tee') { const t = classifyTee(rest, dialect, ctx); if (t) return t; }
  if (bin === 'truncate') { const t = classifyTruncate(rest, dialect, ctx); if (t) return t; }
  if (bin === 'touch') { const t = classifyTouch(rest, dialect, ctx); if (t) return t; }
  if (bin === 'dd') { const t = classifyDd(rest, dialect, ctx); if (t) return t; }
  if (bin === 'patch') { const t = classifyPatch(rest, dialect, ctx); if (t) return t; }
  if (bin === 'sed') { const t = classifySedInPlace(rest, dialect, ctx); if (t) return t; }

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

  const awkHit = classifyAwkInterpreter(bin, segment, ctx);
  if (awkHit) return awkHit;

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
    return classifyEffectiveBinary(rest, dialect, ctx, assignments, depth, budget, aliasDepth);
  }

  // R9 fail-closed policy: only a binary PROVEN read-only (and, by reaching this point, already
  // past the global redirection/secret-path/dynamic-token checks above) may still defer. `type`
  // reaching this point already had every argument confirmed exact/non-secret/non-glob/non-dynamic
  // by classifySecretPrimitive above (it only returns null/undefined when that holds). R10 Section 4:
  // the binary name alone is no longer sufficient for the rest of this group either -
  // classifySimpleReadonlyCommand additionally validates the option/operand shape (date/sort/uniq/
  // wc/cat/head/tail/cut/grep/rg) before allowing a defer. Everything else asks: "unrecognized" must
  // never again silently mean "assumed safe".
  const simpleHit = classifySimpleReadonlyCommand(bin, rest, dialect, ctx);
  if (simpleHit) return simpleHit;

  return askResult(RULE.UNKNOWN, { safeMessage: 'Needs approval: this executable is not recognized by the safety classifier.' });
}

// classifySegment resolves at most one wrapper hop, then either classifies the leaf binary or
// recurses into classifyCommandString to re-segment the wrapper's payload from scratch (a payload
// like `echo ok; git push` is shell content in its own right, not a single opaque argument).
// `depth` bounds recursion (MAX_WRAPPER_DEPTH); `budget` is a mutable {segments} counter shared
// across the whole recursive classification of one top-level command, bounding total segments
// processed across all wrapper layers combined (MAX_TOTAL_SEGMENTS), not just per-layer.
function classifySegment(rawSegment, dialect, ctx, depth, budget, inheritedAssignments, aliasDepth) {
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
    const inner = classifyCommandString(resolved.payload, resolved.dialect, ctx, depth + 1, budget, effectiveAssignments, aliasDepth);
    // Package-runner invariant (npx / pnpm dlx / yarn dlx): always at least ask, regardless of
    // payload. A protected-action payload already denies/asks on its own merits and passes
    // through unchanged; only an otherwise-unrecognized payload (defer, or - under the R9 fail-
    // closed default - the generic `ask AMZ-UNKNOWN-COMMAND`) is floored to this more specific,
    // package-runner-aware ask instead.
    if (resolved.packageRunner) {
      return resolvedOrFloor(inner, askResult(RULE.COMPLEX, { safeMessage: 'Needs approval: this runs a package-runner command with an unresolved payload.' }));
    }
    return inner;
  }
  const effectiveAssignments = mergeAssignments(inheritedAssignments, resolved.assignments);
  return classifyEffectiveBinary(resolved.segment, resolved.dialect, ctx, effectiveAssignments, depth, budget, aliasDepth);
}

// R14 Section 10: `aliasDepth` threads the git-shell-alias recursion counter (see
// classifyGitShellAliasInvocation/MAX_GIT_SHELL_ALIAS_DEPTH) through the SAME recursive chain that
// already carries `depth`/`budget` - a top-level command starts at aliasDepth 0; it only increases
// when a `!`-prefixed Git alias body is reclassified as a fresh command string, and that increased
// value must survive any ordinary wrapper hops (env/bash/sh/...) encountered afterward, exactly like
// `depth`/`budget` already do, so alternating wrapper-hops and shell-alias-hops can never bypass the
// combined recursion bound.
function classifyCommandString(raw, initialDialect, ctx, depth, budget, inheritedAssignments, aliasDepth) {
  const effectiveDepth = depth || 0;
  const effectiveBudget = budget || { segments: 0 };
  const effectiveAliasDepth = aliasDepth || 0;
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
    const r = classifySegment(s, initialDialect, ctx, effectiveDepth, effectiveBudget, inheritedAssignments, effectiveAliasDepth);
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
  normalizeProtectedPath,
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
