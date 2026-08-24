#!/usr/bin/env node
/**
 * Edge Function configuration gate (P0-C).
 *
 * Supabase deploys every directory under `supabase/functions/` that contains an
 * `index.ts`. A function with no `[functions.<name>]` section in `supabase/config.toml`
 * still deploys — it just inherits whatever the CLI defaults to, which makes the
 * deployed auth posture implicit and version-dependent. Nine PAD/classification
 * functions were in exactly that state (roadmap §4.3).
 *
 * This gate makes the mapping total and explicit, in both directions:
 *
 *   - a deployable function with no section          -> FAIL (implicit config)
 *   - a section whose function no longer exists      -> FAIL (obsolete/unknown)
 *   - the same `[functions.x]` section twice         -> FAIL (last-wins ambiguity)
 *   - `verify_jwt` missing from a section            -> FAIL (implicit again)
 *   - `verify_jwt` not a TOML boolean                -> FAIL ("false" is not false)
 *   - `verify_jwt = true`                            -> FAIL (see below)
 *
 * Why `verify_jwt = true` fails: the project signs with ES256 signing keys, which the
 * gateway-level JWT check does not accept, so EVERY function runs `verify_jwt = false`
 * and enforces auth in code via `requireUser`/`requireAdmin` (or inline `getUser` under
 * the caller JWT). That is the contract in docs/SECURITY_CONTRACT.md — `healthz` is the
 * single intentionally public endpoint, and its openness comes from its code, not from
 * this flag. A `true` here would therefore be a mistake, not a hardening: it would break
 * the function while changing nothing about its real authorization. If the doctrine ever
 * changes, update the contract and this gate together — never this gate alone.
 *
 * This is a static configuration check. It does NOT verify that a function authenticates
 * its callers; that remains a code review responsibility.
 *
 * Usage:
 *   node scripts/check-edge-function-config.mjs
 *   node scripts/check-edge-function-config.mjs --root <dir>   # check another checkout
 *                                                             # (used for negative probes)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Directories under `supabase/functions/` that are NOT deployable functions.
 * Deliberately an exhaustive allowlist and not a `_`-prefix rule: a new `_foo/index.ts`
 * must fail loudly rather than be silently skipped.
 */
const NON_FUNCTION_DIRS = new Set(['_shared', '_tests']);

/** The single value `verify_jwt` may take under the current security contract. */
const REQUIRED_VERIFY_JWT = false;

const LABEL = '[edge-function-config]';

/** `[section]` header, capturing the raw dotted key. Trailing comments allowed. */
const SECTION_HEADER = /^\[([^[\]]+)\]\s*(?:#.*)?$/;
/** `key = value`, with the value stripped of any trailing comment by the caller. */
const KEY_VALUE = /^([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/;

function fail(message, details = []) {
  console.error(`${LABEL} FAIL — ${message}`);
  for (const detail of details) {
    console.error(`  ${detail}`);
  }
  process.exit(1);
}

/** Byte-wise ordering: identical on Windows and Linux, unlike locale-aware sorting. */
function byCodeUnit(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function resolveRoot() {
  const index = process.argv.indexOf('--root');
  if (index === -1) {
    const scriptDir = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(scriptDir, '..');
  }
  const value = process.argv[index + 1];
  if (!value) {
    fail('`--root` needs a directory argument.');
  }
  return path.resolve(value);
}

/**
 * Splits a dotted TOML table key into its segments, unquoting basic-string segments.
 * Returns null when a segment uses a form this gate does not understand — the caller
 * turns that into a failure rather than guessing.
 */
function parseTableKey(rawKey) {
  const segments = [];
  for (const raw of rawKey.split('.')) {
    const segment = raw.trim();
    if (/^[A-Za-z0-9_-]+$/.test(segment)) {
      segments.push(segment);
      continue;
    }
    if (/^"[^"\\]*"$/.test(segment)) {
      segments.push(segment.slice(1, -1));
      continue;
    }
    return null;
  }
  return segments.length > 0 ? segments : null;
}

/** Strips a trailing `#` comment from a value, ignoring `#` inside a basic string. */
function stripComment(value) {
  let inString = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === '"' && value[i - 1] !== '\\') {
      inString = !inString;
    } else if (char === '#' && !inString) {
      return value.slice(0, i).trim();
    }
  }
  return value.trim();
}

/** Every deployable function: a direct subdirectory of `functions/` holding an index.ts. */
function readDeployableFunctions(functionsDir) {
  if (!fs.existsSync(functionsDir)) {
    fail(`\`${functionsDir}\` does not exist.`);
  }

  const names = [];
  const skipped = [];
  // `withFileTypes` alone would misreport a symlinked function directory, so stat each
  // entry (which follows links). Broken links are reported, never silently dropped.
  for (const entry of fs.readdirSync(functionsDir)) {
    const entryPath = path.join(functionsDir, entry);
    let stats;
    try {
      stats = fs.statSync(entryPath);
    } catch (error) {
      fail(`could not stat \`${entryPath}\`: ${error.message}`);
    }
    if (!stats.isDirectory() || NON_FUNCTION_DIRS.has(entry)) {
      continue;
    }
    if (fs.existsSync(path.join(entryPath, 'index.ts'))) {
      names.push(entry);
    } else {
      skipped.push(entry);
    }
  }

  return { names: names.sort(byCodeUnit), skipped: skipped.sort(byCodeUnit) };
}

/**
 * Minimal TOML table walk, scoped to what this gate needs: the `[functions.<name>]`
 * tables and their `verify_jwt` key. Anything it cannot classify is an error, so an
 * unexpected construct can never be read as "configured".
 */
function readConfiguredFunctions(configPath) {
  if (!fs.existsSync(configPath)) {
    fail(`\`${configPath}\` does not exist.`);
  }

  const lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/);
  /** name -> { line, verifyJwt: 'true'|'false'|<raw>|null, verifyJwtLine } */
  const sections = new Map();
  const duplicates = [];
  const malformed = [];
  const order = [];
  let current = null;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      return;
    }

    if (line.startsWith('[[')) {
      // Array of tables: never a function section, and it opens a scope we must leave.
      current = null;
      return;
    }

    const header = SECTION_HEADER.exec(line);
    if (header) {
      const segments = parseTableKey(header[1]);
      if (!segments) {
        malformed.push(`line ${lineNumber}: table header \`${line}\` is not understood`);
        current = null;
        return;
      }
      if (segments[0] !== 'functions') {
        current = null;
        return;
      }
      if (segments.length === 1) {
        // A bare `[functions]` table would hold per-function config in a shape this
        // gate does not model. Refuse rather than report a false "all explicit".
        malformed.push(
          `line ${lineNumber}: bare \`[functions]\` table is not supported — ` +
            'use one `[functions.<name>]` section per function'
        );
        current = null;
        return;
      }
      const name = segments[1];
      if (segments.length > 2) {
        // e.g. `[functions.x.static_files]` — a sub-table of x, not a second declaration
        // of x, and not a place `verify_jwt` may live.
        current = null;
        return;
      }
      if (sections.has(name)) {
        duplicates.push(
          `${name}: declared at line ${sections.get(name).line} and again at line ${lineNumber}`
        );
        current = null;
        return;
      }
      current = { line: lineNumber, verifyJwt: null, verifyJwtLine: null };
      sections.set(name, current);
      order.push(name);
      return;
    }

    if (!current) {
      return;
    }

    const keyValue = KEY_VALUE.exec(line);
    if (!keyValue || keyValue[1] !== 'verify_jwt') {
      return;
    }
    if (current.verifyJwt !== null) {
      malformed.push(
        `line ${lineNumber}: \`verify_jwt\` set twice in the same section ` +
          `(first at line ${current.verifyJwtLine})`
      );
      return;
    }
    current.verifyJwt = stripComment(keyValue[2]);
    current.verifyJwtLine = lineNumber;
  });

  if (malformed.length > 0) {
    fail(`\`${configPath}\` could not be read unambiguously.`, malformed);
  }

  return { sections, duplicates, order };
}

const repoRoot = resolveRoot();
const functionsDir = path.join(repoRoot, 'supabase', 'functions');
const configPath = path.join(repoRoot, 'supabase', 'config.toml');

const { names: deployable, skipped } = readDeployableFunctions(functionsDir);
const { sections, duplicates, order } = readConfiguredFunctions(configPath);

const deployableSet = new Set(deployable);
const problems = [];

if (duplicates.length > 0) {
  problems.push({
    title: `${duplicates.length} duplicated \`[functions.<name>]\` section(s) — the last one silently wins`,
    details: duplicates,
  });
}

const missing = deployable.filter((name) => !sections.has(name));
if (missing.length > 0) {
  problems.push({
    title: `${missing.length} deployable function(s) have no \`[functions.<name>]\` section`,
    details: missing.map((name) => `${name} (supabase/functions/${name}/index.ts)`),
    hint: 'Add the section to supabase/config.toml with `verify_jwt = false`.',
  });
}

const unknown = order.filter((name) => !deployableSet.has(name));
if (unknown.length > 0) {
  problems.push({
    title: `${unknown.length} configured function(s) have no \`supabase/functions/<name>/index.ts\``,
    details: unknown.map((name) => `${name} (declared at line ${sections.get(name).line})`),
    hint: 'Remove the obsolete section, or restore the function directory.',
  });
}

const missingFlag = [];
const notBoolean = [];
const wrongValue = [];
for (const name of order) {
  if (!deployableSet.has(name)) {
    continue;
  }
  const section = sections.get(name);
  if (section.verifyJwt === null) {
    missingFlag.push(`${name} (section at line ${section.line})`);
  } else if (section.verifyJwt !== 'true' && section.verifyJwt !== 'false') {
    notBoolean.push(`${name}: verify_jwt = ${section.verifyJwt} (line ${section.verifyJwtLine})`);
  } else if ((section.verifyJwt === 'true') !== REQUIRED_VERIFY_JWT) {
    wrongValue.push(`${name}: verify_jwt = ${section.verifyJwt} (line ${section.verifyJwtLine})`);
  }
}

if (missingFlag.length > 0) {
  problems.push({
    title: `${missingFlag.length} section(s) do not set \`verify_jwt\``,
    details: missingFlag,
    hint: 'Every section must state the policy explicitly: `verify_jwt = false`.',
  });
}
if (notBoolean.length > 0) {
  problems.push({
    title: `${notBoolean.length} section(s) set \`verify_jwt\` to a non-boolean`,
    details: notBoolean,
    hint: 'Use the bare TOML booleans `true`/`false`, not strings or numbers.',
  });
}
if (wrongValue.length > 0) {
  problems.push({
    title: `${wrongValue.length} section(s) set \`verify_jwt = true\``,
    details: wrongValue,
    hint:
      'The project signs with ES256 keys, so gateway JWT verification rejects valid tokens; ' +
      'auth is enforced in code (docs/SECURITY_CONTRACT.md). Set `verify_jwt = false` — do not ' +
      'relax the in-code `requireUser`/`requireAdmin` check instead.',
  });
}

if (skipped.length > 0) {
  console.log(
    `${LABEL} ignored ${skipped.length} directory/directories without index.ts: ${skipped.join(', ')}`
  );
}

if (problems.length > 0) {
  console.error(`${LABEL} FAIL — supabase/config.toml does not match supabase/functions/.`);
  for (const problem of problems) {
    console.error(`  ${problem.title}:`);
    for (const detail of problem.details) {
      console.error(`    - ${detail}`);
    }
    if (problem.hint) {
      console.error(`    ${problem.hint}`);
    }
  }
  process.exit(1);
}

console.log(
  `${LABEL} OK — ${deployable.length} deployable function(s), each with exactly one ` +
    `\`[functions.<name>]\` section and \`verify_jwt = ${REQUIRED_VERIFY_JWT}\`.`
);
