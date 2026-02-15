#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

function parseCsv(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  const lines = raw.split(/\r?\n/);
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    header.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function median(values) {
  if (!values.length) return null;
  const arr = [...values].sort((a,b) => a-b);
  const m = Math.floor(arr.length/2);
  return arr.length % 2 ? arr[m] : (arr[m-1]+arr[m])/2;
}

function safePct(n, d) { return d === 0 ? null : (n/d)*100; }

function run({ casesPath, linesPath, rulesPath, outputPath }) {
  const cases = parseCsv(casesPath);
  const lines = parseCsv(linesPath);
  const rules = parseCsv(rulesPath);

  const linesByQuote = new Map();
  for (const l of lines) {
    if (!linesByQuote.has(l.quote_id)) linesByQuote.set(l.quote_id, []);
    linesByQuote.get(l.quote_id).push({ ...l, amount_ht: Number(l.amount_ht || 0) });
  }

  const rulesByIncoterm = new Map(rules.map(r => [r.incoterm, r]));

  const results = [];
  const iaMapes = [];
  const iaCoverage = [];
  const iaIncotermChecks = [];
  const iaBlocking = [];

  for (const c of cases) {
    const ref = linesByQuote.get(c.reference_quote_id) || [];
    const ia = linesByQuote.get(c.ia_quote_id) || [];

    const refByCode = new Map(ref.map(l => [l.service_code, l]));
    const iaByCode = new Map(ia.map(l => [l.service_code, l]));

    const expected = [...refByCode.keys()];
    let matched = 0;
    const mapes = [];

    for (const code of expected) {
      const rl = refByCode.get(code);
      const il = iaByCode.get(code);
      if (!il) continue;
      matched++;
      if (rl.amount_ht > 0) {
        mapes.push(Math.abs(il.amount_ht - rl.amount_ht) / rl.amount_ht * 100);
      }
    }

    const coverage = safePct(matched, expected.length);
    if (coverage !== null) iaCoverage.push(coverage);
    iaMapes.push(...mapes);

    const rule = rulesByIncoterm.get(c.incoterm);
    let incotermOk = true;
    if (rule) {
      const iaBlocs = new Set(ia.map(l => l.bloc));
      const required = (rule.required_blocs || '').split('|').filter(Boolean);
      const forbidden = (rule.forbidden_blocs || '').split('|').filter(Boolean);
      const missingRequired = required.filter(b => !iaBlocs.has(b));
      const presentForbidden = forbidden.filter(b => iaBlocs.has(b));
      incotermOk = missingRequired.length === 0 && presentForbidden.length === 0;
    }
    iaIncotermChecks.push(incotermOk ? 1 : 0);

    const hasBlockingError = (coverage ?? 0) < 95 || !incotermOk;
    iaBlocking.push(hasBlockingError ? 1 : 0);

    const refTotal = ref.reduce((s,l)=>s+l.amount_ht,0);
    const iaTotal = ia.reduce((s,l)=>s+l.amount_ht,0);
    const totalGapPct = refTotal > 0 ? Math.abs(iaTotal-refTotal)/refTotal*100 : null;

    results.push({
      audit_case_id: c.audit_case_id,
      coverage_pct: coverage,
      mape_median_pct: median(mapes),
      incoterm_ok: incotermOk,
      blocking_error: hasBlockingError,
      total_gap_pct: totalGapPct,
    });
  }

  const summary = {
    cases: cases.length,
    kpi_p0: {
      coverage_structurale_pct: median(iaCoverage),
      mape_median_lignes_pct: median(iaMapes),
      conformite_incoterm_pct: safePct(iaIncotermChecks.reduce((a,b)=>a+b,0), iaIncotermChecks.length),
      erreurs_bloquantes_pct: safePct(iaBlocking.reduce((a,b)=>a+b,0), iaBlocking.length),
      ecart_total_median_pct: median(results.map(r => r.total_gap_pct).filter(v => v !== null)),
    },
    thresholds: {
      coverage_min_pct: 95,
      mape_max_pct: 8,
      incoterm_min_pct: 98,
      blocking_max_pct: 2,
      total_gap_max_pct: 5,
    },
    verdict: 'NO-GO',
    case_results: results,
    generated_at: new Date().toISOString(),
  };

  const k = summary.kpi_p0;
  const pass =
    (k.coverage_structurale_pct ?? 0) >= summary.thresholds.coverage_min_pct &&
    (k.mape_median_lignes_pct ?? Infinity) <= summary.thresholds.mape_max_pct &&
    (k.conformite_incoterm_pct ?? 0) >= summary.thresholds.incoterm_min_pct &&
    (k.erreurs_bloquantes_pct ?? Infinity) <= summary.thresholds.blocking_max_pct &&
    (k.ecart_total_median_pct ?? Infinity) <= summary.thresholds.total_gap_max_pct;
  summary.verdict = pass ? 'GO' : 'NO-GO';

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2));
  return summary;
}

const root = process.cwd();
const summary = run({
  casesPath: path.join(root, 'audit/p0/input/cases.csv'),
  linesPath: path.join(root, 'audit/p0/input/quote_lines.csv'),
  rulesPath: path.join(root, 'audit/p0/input/incoterm_rules.csv'),
  outputPath: path.join(root, 'audit/p0/reports/bootstrap_summary.json'),
});

console.log(`Audit run complete: ${summary.cases} case(s), verdict=${summary.verdict}`);
