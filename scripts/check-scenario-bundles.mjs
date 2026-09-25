#!/usr/bin/env node
/** Resolve each delivery entry with only its own directory and _shared present.
 * Deno info builds a dependency graph: no Edge handler or client data is executed.
 * This checks bundle input closure, NOT the Lovable compiler or deployed bytes.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsRoot = path.join(root, 'supabase', 'functions');
const deno = process.env.DENO_BIN || 'deno';
const entries = ['quotation-engine', 'run-scenario-pricing', 'manage-quote-scenario',
  // MULTI-LOT-TERMINAL-1: functions whose bundle gains the per-lot registry modules.
  'manage-lot-confirmation', 'manage-pad-group-confirmation', 'run-pricing', 'build-case-puzzle'];
const scratch = mkdtempSync(path.join(tmpdir(), 'dcq-scenario-bundles-'));
let failures = 0;

function graphErrors(value, location = '') {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'error' && child ? [`${location}: ${JSON.stringify(child)}`]
      : graphErrors(child, `${location}/${key}`));
}

function resolveGraph(directory, name) {
  const entry = path.join(directory, name, 'index.ts');
  const result = spawnSync(deno, ['info', '--json', '--no-config', '--no-lock',
    '--node-modules-dir=none', pathToFileURL(entry).href], {
    cwd: directory, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  let graph;
  try { graph = JSON.parse(result.stdout); }
  catch { throw new Error(`Unparseable Deno graph (exit ${result.status}): ${result.stderr.slice(-2000)}`); }
  if (!Array.isArray(graph.modules) || graph.modules.length === 0) throw new Error('Empty Deno graph');
  if (!graph.modules.some(module => module.specifier === pathToFileURL(entry).href && module.kind === 'esm')) {
    throw new Error('Entry point was not parsed as an ESM module');
  }
  const errors = graphErrors(graph);
  for (const module of graph.modules) {
    if (!module.specifier?.startsWith('file:')) continue;
    const local = fileURLToPath(module.specifier);
    const relative = path.relative(directory, local);
    if (relative.startsWith('..') || path.isAbsolute(relative)) errors.push(`Escaped bundle: ${relative}`);
  }
  if (result.status !== 0 && errors.length === 0) throw new Error(`Deno exit ${result.status}: ${result.stderr.slice(-2000)}`);
  return { errors, modules: graph.modules.length };
}

try {
  for (const name of entries) {
    const isolated = path.join(scratch, name);
    cpSync(path.join(functionsRoot, name), path.join(isolated, name), { recursive: true });
    cpSync(path.join(functionsRoot, '_shared'), path.join(isolated, '_shared'), { recursive: true });
    for (const other of entries.filter(entry => entry !== name)) {
      if (existsSync(path.join(isolated, other))) throw new Error(`Isolation broken: ${other}`);
    }
    const graph = resolveGraph(isolated, name);
    if (graph.errors.length) {
      failures++;
      console.error(`[scenario-bundles] FAIL ${name}: ${graph.errors.join('\n')}`);
    } else {
      console.log(`[scenario-bundles] PASS ${name}: ${graph.modules} modules resolved in isolation`);
    }
  }
  // Reintroduce the exact missing-sibling defect only inside our disposable fixture.
  const isolated = path.join(scratch, 'run-scenario-pricing');
  const domainPath = path.join(isolated, 'run-scenario-pricing', 'domain.ts');
  const source = readFileSync(domainPath, 'utf8');
  const shared = 'from "../_shared/quote-scenario-domain.ts"';
  if (source.split(shared).length !== 2) throw new Error('Negative control target must occur exactly once');
  writeFileSync(domainPath, source.replace(shared, 'from "../manage-quote-scenario/domain.ts"'));
  const negative = resolveGraph(isolated, 'run-scenario-pricing');
  if (!negative.errors.some(error => error.includes('manage-quote-scenario/domain.ts'))) {
    throw new Error('Negative control did not detect missing sibling module');
  }
  console.log('[scenario-bundles] PASS negative control: missing sibling import rejected');
} catch (error) {
  failures++;
  console.error(`[scenario-bundles] FAIL: ${error.message}`);
} finally {
  // Only remove the exact freshly-created temp directory, never a caller-supplied path.
  const parent = path.resolve(tmpdir());
  const target = path.resolve(scratch);
  if (path.dirname(target) !== parent || !path.basename(target).startsWith('dcq-scenario-bundles-')) {
    throw new Error(`Unsafe temporary cleanup target: ${target}`);
  }
  rmSync(target, { recursive: true, force: true });
}
process.exitCode = failures ? 1 : 0;
