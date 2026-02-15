#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

function usage() {
  console.log(`Usage:
  node tools/audit/audit_case_dossier.mjs --dossier <case_id_or_prefix> [--out <path>]

Required environment variables:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY

Example:
  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \\
  node tools/audit/audit_case_dossier.mjs --dossier acddafa7
`);
}

function parseArgs(argv) {
  const args = { dossier: '', out: '' };
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') {
      args.help = true;
      return args;
    }
    if (token === '--dossier') {
      args.dossier = argv[i + 1] || '';
      i += 1;
      continue;
    }
    if (token === '--out') {
      args.out = argv[i + 1] || '';
      i += 1;
      continue;
    }
  }
  return args;
}

function sanitizeFileToken(value) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48);
}

function findKeyPaths(input, matcher, prefix = '$') {
  const matches = [];

  if (Array.isArray(input)) {
    input.forEach((item, index) => {
      matches.push(...findKeyPaths(item, matcher, `${prefix}[${index}]`));
    });
    return matches;
  }

  if (input && typeof input === 'object') {
    Object.entries(input).forEach(([key, value]) => {
      const nextPrefix = `${prefix}.${key}`;
      if (matcher(key, value)) {
        matches.push({ path: nextPrefix, value });
      }
      matches.push(...findKeyPaths(value, matcher, nextPrefix));
    });
  }

  return matches;
}

async function resolveCase(client, dossierToken) {
  const direct = await client
    .from('quote_cases')
    .select('id, thread_id, status, request_type, created_at, updated_at, last_activity_at')
    .eq('id', dossierToken)
    .maybeSingle();

  if (direct.data) {
    return direct.data;
  }

  const byThread = await client
    .from('quote_cases')
    .select('id, thread_id, status, request_type, created_at, updated_at, last_activity_at')
    .eq('thread_id', dossierToken)
    .maybeSingle();

  if (byThread.data) {
    return byThread.data;
  }

  const latest = await client
    .from('quote_cases')
    .select('id, thread_id, status, request_type, created_at, updated_at, last_activity_at')
    .order('created_at', { ascending: false })
    .limit(500);

  if (latest.error) {
    throw latest.error;
  }

  const token = dossierToken.toLowerCase();
  return (latest.data || []).find(
    (item) => item.id.toLowerCase().startsWith(token) || item.thread_id.toLowerCase().startsWith(token),
  );
}

async function run() {
  const args = parseArgs(process.argv);
  if (args.help) {
    usage();
    return;
  }

  if (!args.dossier) {
    usage();
    throw new Error('Missing required --dossier argument');
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const client = createClient(url, key, { auth: { persistSession: false } });
  const quoteCase = await resolveCase(client, args.dossier);

  if (!quoteCase) {
    throw new Error(`No quote_cases row found for token "${args.dossier}"`);
  }

  const caseId = quoteCase.id;
  const threadId = quoteCase.thread_id;

  const [
    factsResp,
    pricingResp,
    qvResp,
    emailsResp,
  ] = await Promise.all([
    client
      .from('quote_facts')
      .select('id, fact_key, value_json, value_text, source_type, is_current, confidence, created_at')
      .eq('case_id', caseId)
      .eq('is_current', true)
      .order('created_at', { ascending: false }),
    client
      .from('pricing_runs')
      .select('id, run_number, status, total_ht, total_ttc, currency, outputs_json, engine_response, created_at, completed_at')
      .eq('case_id', caseId)
      .order('run_number', { ascending: false })
      .limit(5),
    client
      .from('quotation_versions')
      .select('id, case_id, pricing_run_id, version_number, status, is_selected, snapshot, created_at')
      .eq('case_id', caseId)
      .order('version_number', { ascending: false })
      .limit(5),
    client
      .from('emails')
      .select('id, thread_id, subject, received_at, created_at')
      .eq('thread_id', threadId)
      .order('received_at', { ascending: false })
      .limit(200),
  ]);

  if (factsResp.error) throw factsResp.error;
  if (pricingResp.error) throw pricingResp.error;
  if (qvResp.error) throw qvResp.error;
  if (emailsResp.error) throw emailsResp.error;

  const facts = factsResp.data || [];
  const pricingRuns = pricingResp.data || [];
  const quotationVersions = qvResp.data || [];
  const emails = emailsResp.data || [];

  const emailIds = emails.map((email) => email.id);
  let attachments = [];
  if (emailIds.length > 0) {
    const attachmentsResp = await client
      .from('email_attachments')
      .select('id, email_id, filename, content_type, size, is_analyzed, extracted_data, created_at')
      .in('email_id', emailIds)
      .order('created_at', { ascending: false })
      .limit(1000);

    if (attachmentsResp.error) throw attachmentsResp.error;
    attachments = attachmentsResp.data || [];
  }

  const cargoArticlesFact = facts.find((fact) => fact.fact_key === 'cargo.articles_detail');

  const latestSuccessPricing = pricingRuns.find((run) => run.status === 'success') || null;
  const cafHints = latestSuccessPricing
    ? [
        ...findKeyPaths(latestSuccessPricing.outputs_json, (k) => /caf/i.test(k)),
        ...findKeyPaths(latestSuccessPricing.engine_response, (k) => /caf/i.test(k)),
      ]
    : [];

  const ddTvaHints = quotationVersions.flatMap((version) => {
    const items = findKeyPaths(version.snapshot, (k) => /(dd|tva|droit|tax)/i.test(k));
    return items.map((item) => ({ version_number: version.version_number, ...item }));
  });

  const analyzedCount = attachments.filter((item) => item.is_analyzed === true).length;
  const extractedCount = attachments.filter((item) => item.extracted_data !== null).length;

  const report = {
    generated_at: new Date().toISOString(),
    dossier_token: args.dossier,
    case: quoteCase,
    checks: {
      quote_facts_articles_detail: {
        found: Boolean(cargoArticlesFact),
        value_json: cargoArticlesFact?.value_json ?? null,
        source_type: cargoArticlesFact?.source_type ?? null,
        confidence: cargoArticlesFact?.confidence ?? null,
        current_facts_count: facts.length,
      },
      pricing_runs_latest_success: {
        found: Boolean(latestSuccessPricing),
        pricing_run: latestSuccessPricing,
        caf_key_hints: cafHints.slice(0, 40),
      },
      quotation_versions_dd_tva: {
        versions_count: quotationVersions.length,
        selected_version_number:
          quotationVersions.find((version) => version.is_selected)?.version_number ?? null,
        dd_tva_key_hints: ddTvaHints.slice(0, 80),
      },
      email_attachments_analysis: {
        emails_count: emails.length,
        attachments_count: attachments.length,
        analyzed_count: analyzedCount,
        extracted_data_count: extractedCount,
        analyzed_rate_pct: attachments.length ? Number(((analyzedCount / attachments.length) * 100).toFixed(2)) : null,
        extracted_rate_pct: attachments.length ? Number(((extractedCount / attachments.length) * 100).toFixed(2)) : null,
        recent_attachments: attachments.slice(0, 20),
      },
    },
  };

  const safeToken = sanitizeFileToken(args.dossier);
  const defaultOut = path.join(process.cwd(), `audit/p0/reports/dossier_${safeToken}_audit.json`);
  const outputPath = args.out || defaultOut;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  console.log(`Audit completed for case ${caseId}`);
  console.log(`Output: ${outputPath}`);
}

run().catch((error) => {
  console.error('Audit failed:', error.message || error);
  process.exit(1);
});
