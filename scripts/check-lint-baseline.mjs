#!/usr/bin/env node
/**
 * Lint baseline gate.
 *
 * The repository carries a known ESLint debt (mostly `@typescript-eslint/no-explicit-any`).
 * Making it blocking today would freeze every change, so this gate only enforces
 * NON-AGGRAVATION: the run fails when the counts grow above the recorded baseline,
 * and passes when they stay equal or improve.
 *
 * Reducing the debt is a separate, targeted effort (roadmap PACK P2-C). When counts
 * improve, lower the constants below in the same commit that removes the problems.
 */
import { ESLint } from 'eslint';

const BASELINE_ERRORS = 756;
const BASELINE_WARNINGS = 27;

const eslint = new ESLint();
const results = await eslint.lintFiles(['.']);

let errorCount = 0;
let warningCount = 0;
for (const result of results) {
  errorCount += result.errorCount;
  warningCount += result.warningCount;
}

const worseErrors = errorCount > BASELINE_ERRORS;
const worseWarnings = warningCount > BASELINE_WARNINGS;

console.log(
  `[lint-baseline] current: ${errorCount} errors, ${warningCount} warnings — ` +
    `baseline: ${BASELINE_ERRORS} errors, ${BASELINE_WARNINGS} warnings`
);

if (worseErrors || worseWarnings) {
  console.error(
    '[lint-baseline] FAIL — the lint debt increased. Fix the new problems introduced by this change; ' +
      'do not raise the baseline to make this gate pass.'
  );
  const formatter = await eslint.loadFormatter('stylish');
  console.error(await formatter.format(results.filter((r) => r.errorCount + r.warningCount > 0)));
  process.exit(1);
}

if (errorCount < BASELINE_ERRORS || warningCount < BASELINE_WARNINGS) {
  console.log(
    `[lint-baseline] Improvement detected. Lower BASELINE_ERRORS/BASELINE_WARNINGS in ` +
      `scripts/check-lint-baseline.mjs to ${errorCount}/${warningCount} to lock the gain in.`
  );
}

console.log('[lint-baseline] OK — no aggravation.');
