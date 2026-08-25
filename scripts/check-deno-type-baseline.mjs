#!/usr/bin/env node
/**
 * Deno type-check baseline gate (non-aggravation).
 *
 * `npm run test:deno` runs with `--no-check` because type-checking the edge functions
 * against the floating `jsr:@supabase/supabase-js@2` types currently yields 65 pre-existing
 * errors. Left alone, `--no-check` would also silently swallow *new* type debt.
 *
 * This gate re-runs the very same test selection with type-checking ENABLED and compares
 * the diagnostics against a structured baseline keyed by `TScode|repo-relative-file`.
 * Keying per (code, file) — instead of a single global count — means a brand new error in
 * another file (or of another kind) fails even if an old error disappeared at the same time.
 *
 *   - identical debt          -> pass, silent
 *   - debt shrinks            -> pass, prints what to lower
 *   - a bucket grows          -> FAIL
 *   - a new (code, file) pair -> FAIL
 *   - output unparseable      -> FAIL
 *   - deno missing / command  -> FAIL
 *     fails for another cause
 *   - all errors gone         -> pass
 *
 * Fixing the 65 errors is a separate, targeted effort. When they shrink, lower the baseline
 * below in the same commit that removes them — never raise it to make a red run green.
 *
 * Usage:
 *   node scripts/check-deno-type-baseline.mjs
 *   node scripts/check-deno-type-baseline.mjs --print-baseline   # regenerate the literal
 *                                                               # (only ever to LOWER it)
 *
 * `DENO_BIN` overrides the `deno` executable when it is not on PATH.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Baseline lowered on 2026-09-22: 49 diagnostics (45 TS2339, 2 TS2345, 2 TS2352)
 * after fixing PromiseLike + insert param types in _shared/runtime.ts, which
 * eliminated 16 TS2345 errors in sync-canonical-cargo-to-legacy-facts and
 * write-cargo-canonical.
 */
const BASELINE_TOTAL = 49;
const BASELINE = {
  'TS2339|supabase/functions/_tests/derive_cargo_canonical_payload_validation.test.ts': 38,
  'TS2339|supabase/functions/_tests/sync_canonical_cargo_to_legacy_facts.test.ts': 7,
  'TS2345|supabase/functions/run-pricing/index.ts': 2,
  'TS2352|supabase/functions/_tests/canonicalize_cargo_from_case_validation.test.ts': 1,
  'TS2352|supabase/functions/_tests/derive_cargo_canonical_payload_validation.test.ts': 1,
};

/**
 * The five live smoke tests need SUPABASE_SERVICE_ROLE_KEY and a reachable Supabase
 * runtime, so they are excluded here exactly as in `npm run test:deno`.
 */
const LIVE_ONLY_TESTS = [
  'supabase/functions/_tests/eq1_m15b_smoke.test.ts',
  'supabase/functions/_tests/m17c_thread_temporal_guards.test.ts',
  'supabase/functions/_tests/pad_alias_smoke.test.ts',
  'supabase/functions/_tests/pad_nom3_runtime_smoke.test.ts',
  'supabase/functions/_tests/phase15_smoke_test.ts',
];

// Same flags as `test:deno`, minus `--no-check` (that is the whole point) and plus
// `--no-run`: we only want the type-check pass, never the test bodies.
const DENO_ARGS = [
  'test',
  '--no-run',
  '--allow-env',
  '--allow-read',
  '--no-lock',
  '--node-modules-dir=none',
  `--ignore=${LIVE_ONLY_TESTS.join(',')}`,
  'supabase/functions/',
];

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const printBaseline = process.argv.includes('--print-baseline');

/** CSI escape sequences, built without a literal control char so no lint rule trips. */
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, 'g');
const DIAGNOSTIC_HEADER = /^TS(\d+) \[ERROR\]:/;
const DIAGNOSTIC_LOCATION = /^\s+at (file:\/\/\/.*):(\d+):(\d+)\s*$/;
// Deno omits this summary line entirely when there is exactly ONE error, so it is treated
// as an optional cross-check: present -> must match the parsed count, absent -> ignored.
const FOUND_ERRORS = /^Found (\d+) errors?\.$/m;
const TYPE_CHECK_FAILED = 'Type checking failed.';

function die(message, details) {
  console.error(`[deno-type-baseline] FAIL — ${message}`);
  if (details) {
    console.error(details);
  }
  process.exit(1);
}

function runDeno() {
  const denoBin = process.env.DENO_BIN || 'deno';
  const result = spawnSync(denoBin, DENO_ARGS, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // NO_COLOR belt, ANSI stripping braces: CI and local TTYs must parse identically.
    env: { ...process.env, NO_COLOR: '1' },
    windowsHide: true,
  });

  if (result.error) {
    if (result.error.code === 'ENOENT') {
      die(
        `\`${denoBin}\` was not found. Install Deno 2.9.5 (or set DENO_BIN to its path) ` +
          'so the Deno type debt can be checked.'
      );
    }
    die(`could not run \`${denoBin}\`: ${result.error.message}`);
  }
  if (result.status === null) {
    die(`\`${denoBin}\` was terminated by signal ${result.signal ?? 'unknown'}.`);
  }

  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(ANSI_PATTERN, '');
  return { status: result.status, output };
}

/** Maps a `file:///…` URL emitted by Deno to a repo-relative path, or keeps it verbatim. */
function toRepoRelative(fileUrl) {
  let absolute;
  try {
    absolute = fileURLToPath(fileUrl);
  } catch {
    return fileUrl;
  }
  const relative = path.relative(repoRoot, absolute);
  // Outside the repo (a remote/JSR dependency): keep the URL so it shows up as a new bucket.
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return fileUrl;
  }
  return relative.split(path.sep).join('/');
}

/** Pairs every `TSxxxx [ERROR]:` header with the first `at file://…` line that follows it. */
function parseDiagnostics(output) {
  const diagnostics = [];
  for (const line of output.split(/\r?\n/)) {
    const header = DIAGNOSTIC_HEADER.exec(line);
    if (header) {
      diagnostics.push({ code: `TS${header[1]}`, file: null, position: null });
      continue;
    }
    const current = diagnostics[diagnostics.length - 1];
    if (!current || current.file !== null) {
      continue;
    }
    const location = DIAGNOSTIC_LOCATION.exec(line);
    if (location) {
      current.file = toRepoRelative(location[1]);
      current.position = `${location[2]}:${location[3]}`;
    }
  }
  return diagnostics;
}

function bucketKey(diagnostic) {
  return `${diagnostic.code}|${diagnostic.file}`;
}

const { status, output } = runDeno();

if (status === 0) {
  // Type-checking passed outright: no debt left to guard.
  if (BASELINE_TOTAL > 0) {
    console.log(
      `[deno-type-baseline] All Deno type errors are gone (baseline was ${BASELINE_TOTAL}). ` +
        'Empty BASELINE and set BASELINE_TOTAL to 0 in scripts/check-deno-type-baseline.mjs, ' +
        'then drop --no-check from the test:deno script.'
    );
  }
  console.log('[deno-type-baseline] OK — 0 type errors.');
  process.exit(0);
}

if (!output.includes(TYPE_CHECK_FAILED)) {
  die(
    '`deno test --no-run` failed for a reason other than type diagnostics ' +
      `(exit ${status}, no "${TYPE_CHECK_FAILED}" marker).`,
    output
  );
}

const diagnostics = parseDiagnostics(output);

if (diagnostics.length === 0) {
  die(`type-checking failed (exit ${status}) but no TSxxxx diagnostic could be parsed.`, output);
}

const unlocated = diagnostics.filter((diagnostic) => diagnostic.file === null);
if (unlocated.length > 0) {
  die(
    `${unlocated.length} diagnostic(s) had no \`at file://…\` location — output format not understood.`,
    output
  );
}

const found = FOUND_ERRORS.exec(output);
if (found && Number(found[1]) !== diagnostics.length) {
  die(
    `Deno reported ${found[1]} errors but ${diagnostics.length} could be parsed — ` +
      'output format not understood.',
    output
  );
}

const current = new Map();
for (const diagnostic of diagnostics) {
  const key = bucketKey(diagnostic);
  current.set(key, (current.get(key) ?? 0) + 1);
}

if (printBaseline) {
  const entries = [...current.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  console.log(`const BASELINE_TOTAL = ${diagnostics.length};`);
  console.log('const BASELINE = {');
  for (const [key, count] of entries) {
    console.log(`  '${key}': ${count},`);
  }
  console.log('};');
  console.log('// Paste above ONLY to record a REDUCTION of the debt, never an increase.');
  process.exit(0);
}

const baselineSum = Object.values(BASELINE).reduce((total, count) => total + count, 0);
if (baselineSum !== BASELINE_TOTAL) {
  die(
    `the baseline is inconsistent: BASELINE_TOTAL is ${BASELINE_TOTAL} but the buckets sum to ` +
      `${baselineSum}. Fix scripts/check-deno-type-baseline.mjs.`
  );
}

const regressions = [];
for (const [key, count] of current) {
  const allowed = BASELINE[key] ?? 0;
  if (count > allowed) {
    regressions.push({ key, count, allowed });
  }
}

console.log(
  `[deno-type-baseline] current: ${diagnostics.length} type errors in ${current.size} ` +
    `(code, file) bucket(s) — baseline: ${BASELINE_TOTAL} in ${Object.keys(BASELINE).length}`
);

if (regressions.length > 0) {
  console.error('[deno-type-baseline] FAIL — the Deno type debt increased:');
  for (const { key, count, allowed } of regressions) {
    const [code, file] = key.split('|');
    const label = allowed === 0 ? 'new bucket' : `was ${allowed}`;
    console.error(`  ${code} in ${file}: ${count} (${label})`);
    for (const diagnostic of diagnostics.filter((entry) => bucketKey(entry) === key)) {
      console.error(`    ${diagnostic.file}:${diagnostic.position}`);
    }
  }
  console.error(
    '[deno-type-baseline] Fix the type errors introduced by this change; do not raise the ' +
      'baseline in scripts/check-deno-type-baseline.mjs to make this gate pass.'
  );
  process.exit(1);
}

const improvements = [];
for (const [key, allowed] of Object.entries(BASELINE)) {
  const count = current.get(key) ?? 0;
  if (count < allowed) {
    improvements.push(`  ${key.split('|').join(' in ')}: ${count} (was ${allowed})`);
  }
}

if (improvements.length > 0) {
  console.log('[deno-type-baseline] Improvement detected:');
  console.log(improvements.join('\n'));
  console.log(
    '[deno-type-baseline] Lower BASELINE/BASELINE_TOTAL in scripts/check-deno-type-baseline.mjs ' +
      '(`node scripts/check-deno-type-baseline.mjs --print-baseline`) to lock the gain in.'
  );
}

console.log('[deno-type-baseline] OK — no aggravation.');
