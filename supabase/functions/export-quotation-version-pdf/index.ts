/**
 * Phase 17C: export-quotation-version-pdf
 * Generates a DRAFT PDF from quotation_versions.snapshot
 * 
 * Runtime Contract (Phase 14-16):
 * - verify_jwt = false (config.toml) — auth validated in-function via inline JWT check
 * - respondOk / respondError / logRuntimeEvent / correlationId
 * - Idempotence on (quotation_version_id, document_type='pdf')
 * - Guard FSM: quote_cases.status = QUOTED_VERSIONED
 * - Mapping: quotation_id = case_id, root_quotation_id = case_id
 * - Insert bloquant (no best-effort)
 * - Hash SHA-256 for audit trail
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { handleCors } from "../_shared/cors.ts";
import {
  getCorrelationId, respondOk, respondError, logRuntimeEvent,
  getStatusFromErrorCode, type ErrorCode,
} from "../_shared/runtime.ts";

const FUNCTION_NAME = "export-quotation-version-pdf";

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Sanitize text for WinAnsi encoding (pdf-lib limitation).
 * Replaces non-WinAnsi characters with ASCII equivalents.
 */
function sanitize(text: string): string {
  return text
    .replace(/[\u202F\u00A0]/g, ' ')  // narrow no-break space, no-break space
    .replace(/\u2192/g, '->')          // → arrow
    .replace(/\u2190/g, '<-')          // ← arrow
    .replace(/\u00E9/g, 'e')           // é
    .replace(/\u00E8/g, 'e')           // è
    .replace(/\u00EA/g, 'e')           // ê
    .replace(/\u00E0/g, 'a')           // à
    .replace(/\u00E2/g, 'a')           // â
    .replace(/\u00F4/g, 'o')           // ô
    .replace(/\u00EE/g, 'i')           // î
    .replace(/\u00FB/g, 'u')           // û
    .replace(/\u00E7/g, 'c')           // ç
    .replace(/[^\x00-\xFF]/g, '?');    // catch-all: replace anything outside Latin-1
}

function formatAmount(amount: number): string {
  return sanitize(new Intl.NumberFormat('fr-FR').format(amount));
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

async function sha256(data: Uint8Array): Promise<string> {
  const arrayBuffer = new ArrayBuffer(data.length);
  const view = new Uint8Array(arrayBuffer);
  view.set(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// QUALIFICATION HELPERS (Lot 3B — historical fallback)
// ============================================================================

interface QuoteQualification {
  level: "firm" | "provisional" | "partial";
  reasons: Array<{ code: string; message: string; field?: string }>;
  firmTotalPolicy: "all_included" | "excludes_reserved_items";
}

const REASON_LABELS: Record<string, string> = {
  MISSING_CARGO_VALUE: "Valeur marchandise en attente",
  MISSING_HS_CODE: "Code HS a confirmer",
  PAD_CATEGORY_UNRESOLVED: "Categorie PAD a confirmer",
  PARTNER_COST_PENDING: "Cout partenaire en attente",
  RATE_PENDING_CONFIRMATION: "Certains tarifs restent a confirmer",
};

// deno-lint-ignore no-explicit-any
function resolveQuoteQualification(snapshot: any): QuoteQualification {
  const meta = snapshot?.meta;
  if (
    meta?.quoteQualification &&
    typeof meta.quoteQualification.level === "string" &&
    ["firm", "provisional", "partial"].includes(meta.quoteQualification.level)
  ) {
    return meta.quoteQualification as QuoteQualification;
  }
  const rawLines = Array.isArray(snapshot?.raw_lines) ? snapshot.raw_lines : [];
  // deno-lint-ignore no-explicit-any
  const hasToConfirm = rawLines.some((line: any) => line?.source?.type === "TO_CONFIRM");
  if (hasToConfirm) {
    return {
      level: "provisional",
      reasons: [{ code: "RATE_PENDING_CONFIRMATION", message: "Certains tarifs restent a confirmer" }],
      firmTotalPolicy: "excludes_reserved_items",
    };
  }
  return { level: "firm", reasons: [], firmTotalPolicy: "all_included" };
}

function getTotalLabel(q: QuoteQualification): string {
  if (q.level === "firm") return "TOTAL HT";
  if (q.level === "partial") return "TOTAL HT PARTIEL";
  // provisional
  if (q.firmTotalPolicy === "excludes_reserved_items") return "TOTAL HT FERME (hors elements en reserve)";
  return "TOTAL HT (sous reserve)";
}

// ============================================================================
// PDF GENERATION (pure projection from snapshot)
// ============================================================================

// deno-lint-ignore no-explicit-any
async function generateDraftPdf(snapshot: any, caseId: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const PAGE_W = 595;
  const PAGE_H = 842;
  const margin = 50;
  const lineHeight = 18;
  const sectionGap = 25;
  const bottomReserve = 80; // space for footer on last page

  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const primary = rgb(0.1, 0.3, 0.6);
  const draftRed = rgb(0.8, 0.2, 0.2);
  const lotBg = rgb(0.93, 0.95, 0.98);

  // Column positions for services table
  const colService = margin;
  const colDesc = margin + 100;
  const colQty = margin + 280;
  const colRate = margin + 330;
  const colAmount = margin + 400;

  // --- Pagination helpers ---
  let currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - margin;
  let pageNum = 1;

  function ensureSpace(needed: number) {
    if (y < margin + needed) {
      // Add page number to outgoing page
      currentPage.drawText(sanitize(`Page ${pageNum}`), {
        x: PAGE_W - margin - 40, y: margin - 15, size: 8, font, color: gray,
      });
      currentPage = pdfDoc.addPage([PAGE_W, PAGE_H]);
      pageNum++;
      y = PAGE_H - margin;
      // Continuation header
      currentPage.drawText('SODATRA SHIPPING & LOGISTICS', {
        x: margin, y, size: 10, font: fontBold, color: primary,
      });
      y -= lineHeight;
      currentPage.drawLine({
        start: { x: margin, y: y + 5 }, end: { x: PAGE_W - margin, y: y + 5 },
        thickness: 0.5, color: primary,
      });
      y -= lineHeight;
    }
  }

  function drawColumnHeaders() {
    ensureSpace(lineHeight * 2);
    currentPage.drawText('Service', { x: colService, y, size: 9, font: fontBold, color: gray });
    currentPage.drawText('Description', { x: colDesc, y, size: 9, font: fontBold, color: gray });
    currentPage.drawText('Qte', { x: colQty, y, size: 9, font: fontBold, color: gray });
    currentPage.drawText('Tarif', { x: colRate, y, size: 9, font: fontBold, color: gray });
    currentPage.drawText('Montant', { x: colAmount, y, size: 9, font: fontBold, color: gray });
    y -= lineHeight;
    currentPage.drawLine({
      start: { x: margin, y: y + 10 }, end: { x: PAGE_W - margin, y: y + 10 },
      thickness: 0.5, color: gray,
    });
    y -= 5;
  }

  // deno-lint-ignore no-explicit-any
  function drawLine(line: any) {
    ensureSpace(lineHeight + 5);
    const serviceText = sanitize((line.service_code || '').substring(0, 15));
    const descText = sanitize((line.description || '').substring(0, 25));
    const amount = line.amount || 0;
    currentPage.drawText(serviceText, { x: colService, y, size: 9, font, color: black });
    currentPage.drawText(descText, { x: colDesc, y, size: 9, font, color: black });
    currentPage.drawText((line.quantity || 1).toString(), { x: colQty, y, size: 9, font, color: black });
    currentPage.drawText(formatAmount(line.unit_price || 0), { x: colRate, y, size: 9, font, color: black });
    currentPage.drawText(formatAmount(amount), { x: colAmount, y, size: 9, font, color: black });
    y -= lineHeight;
  }

  // === HEADER ===
  currentPage.drawText('SODATRA SHIPPING & LOGISTICS', {
    x: margin, y, size: 16, font: fontBold, color: primary,
  });
  y -= lineHeight;
  currentPage.drawLine({
    start: { x: margin, y: y + 5 }, end: { x: PAGE_W - margin, y: y + 5 },
    thickness: 1, color: primary,
  });
  y -= lineHeight;

  const shortId = caseId.substring(0, 8).toUpperCase();
  currentPage.drawText(sanitize(`DEVIS N° QC-${shortId}`), {
    x: margin, y, size: 14, font: fontBold, color: black,
  });

  const versionText = `v${snapshot.meta?.version_number || 1}`;
  currentPage.drawText(`[${versionText}]`, {
    x: PAGE_W - margin - 140, y, size: 10, font: fontBold, color: primary,
  });
  currentPage.drawText('[DRAFT]', {
    x: PAGE_W - margin - 80, y, size: 12, font: fontBold, color: draftRed,
  });
  y -= lineHeight;

  currentPage.drawText(sanitize(`Date: ${formatDate(snapshot.meta?.created_at || new Date().toISOString())}`), {
    x: margin, y, size: 10, font, color: gray,
  });
  y -= sectionGap;

  // === CLIENT ===
  currentPage.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: PAGE_W - margin, y: y + 10 },
    thickness: 0.5, color: gray,
  });
  y -= 5;
  currentPage.drawText('CLIENT', { x: margin, y, size: 11, font: fontBold, color: primary });
  y -= lineHeight;
  if (snapshot.client?.email) {
    currentPage.drawText(sanitize(`Email: ${snapshot.client.email}`), { x: margin, y, size: 10, font, color: black });
    y -= lineHeight;
  }
  if (snapshot.client?.company) {
    currentPage.drawText(sanitize(`Societe: ${snapshot.client.company}`), { x: margin, y, size: 10, font, color: black });
    y -= lineHeight;
  }
  y -= sectionGap / 2;

  // === ROUTE ===
  currentPage.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: PAGE_W - margin, y: y + 10 },
    thickness: 0.5, color: gray,
  });
  y -= 5;
  currentPage.drawText('ROUTE', { x: margin, y, size: 11, font: fontBold, color: primary });
  y -= lineHeight;
  const routeParts = [
    snapshot.inputs?.origin, 'Dakar', snapshot.inputs?.destination,
  ].filter(Boolean);
  currentPage.drawText(sanitize(routeParts.join(' -> ') || 'Non specifie'), {
    x: margin, y, size: 10, font, color: black,
  });
  y -= lineHeight;
  if (snapshot.inputs?.incoterm) {
    currentPage.drawText(sanitize(`Incoterm: ${snapshot.inputs.incoterm}`), {
      x: margin, y, size: 10, font, color: black,
    });
    y -= lineHeight;
  }
  y -= sectionGap / 2;

  // === PRESTATIONS ===
  currentPage.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: PAGE_W - margin, y: y + 10 },
    thickness: 0.5, color: gray,
  });
  y -= 5;
  currentPage.drawText('PRESTATIONS', { x: margin, y, size: 11, font: fontBold, color: primary });
  y -= lineHeight + 5;

  // --- Multi-lot or flat rendering ---
  const isMultiLot = snapshot.is_multi_lot === true && Array.isArray(snapshot.lots) && snapshot.lots.length > 0;

  // Legacy fallback: group from raw_lines if lots[] absent but lot tags present
  // deno-lint-ignore no-explicit-any
  let effectiveLots: any[] | null = null;
  if (isMultiLot) {
    effectiveLots = snapshot.lots;
  } else if (Array.isArray(snapshot.raw_lines) && snapshot.raw_lines.some((r: any) => r.lot_index != null)) {
    // Build fallback lots from raw_lines + lines
    const lotMap = new Map<number, { label: string; lines: any[]; ht: number }>();
    const lines = snapshot.lines || [];
    for (let i = 0; i < lines.length; i++) {
      const raw = snapshot.raw_lines[i];
      const lotIdx = raw?.lot_index ?? 0;
      const lotLabel = raw?.lot_label ?? `Lot ${lotIdx}`;
      if (!lotMap.has(lotIdx)) lotMap.set(lotIdx, { label: lotLabel, lines: [], ht: 0 });
      const entry = lotMap.get(lotIdx)!;
      entry.lines.push(lines[i]);
      entry.ht += lines[i].amount || 0;
    }
    if (lotMap.size > 1) {
      effectiveLots = Array.from(lotMap.entries()).map(([idx, v]) => ({
        lot_index: idx, label: v.label, lines: v.lines,
        totals: { ht: v.ht, ttc: v.ht, currency: snapshot.totals?.currency || 'XOF' },
      }));
    }
  }

  if (effectiveLots && effectiveLots.length > 1) {
    // Render per-lot sections
    for (const lot of effectiveLots) {
      ensureSpace(lineHeight * 3);
      // Lot header with background
      currentPage.drawRectangle({
        x: margin, y: y - 4, width: PAGE_W - 2 * margin, height: lineHeight + 2,
        color: lotBg,
      });
      currentPage.drawText(sanitize(`Lot ${lot.lot_index} - ${lot.label}`), {
        x: margin + 5, y, size: 10, font: fontBold, color: primary,
      });
      y -= lineHeight + 5;

      drawColumnHeaders();

      const lotLines = lot.lines || [];
      for (const line of lotLines) {
        drawLine(line);
      }

      // Lot subtotal
      ensureSpace(lineHeight + 10);
      currentPage.drawLine({
        start: { x: colRate, y: y + 10 }, end: { x: PAGE_W - margin, y: y + 10 },
        thickness: 0.5, color: gray,
      });
      y -= 5;
      const lotTotal = lot.totals?.ht ?? 0;
      const lotCurrency = lot.totals?.currency ?? 'XOF';
      currentPage.drawText(sanitize(`Sous-total: ${formatAmount(lotTotal)} ${lotCurrency}`), {
        x: colRate, y, size: 10, font: fontBold, color: black,
      });
      y -= sectionGap;
    }
  } else {
    // Flat rendering (mono-lot or legacy without lot tags)
    drawColumnHeaders();
    const lines = snapshot.lines || [];
    for (const line of lines) {
      drawLine(line);
    }
  }

  y -= sectionGap / 2;

  // === TOTAL ===
  ensureSpace(bottomReserve + lineHeight * 6);
  currentPage.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: PAGE_W - margin, y: y + 10 },
    thickness: 1, color: primary,
  });
  y -= 5;
  const totalText = sanitize(`TOTAL HT: ${formatAmount(snapshot.totals?.total_ht || 0)} ${snapshot.totals?.currency || 'XOF'}`);
  currentPage.drawText(totalText, { x: margin, y, size: 14, font: fontBold, color: primary });
  y -= sectionGap;

  // === DRAFT FOOTER ===
  ensureSpace(lineHeight * 5);
  currentPage.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: PAGE_W - margin, y: y + 10 },
    thickness: 2, color: draftRed,
  });
  y -= 5;
  currentPage.drawText('*** DRAFT - DOCUMENT DE TRAVAIL ***', {
    x: margin, y, size: 12, font: fontBold, color: draftRed,
  });
  y -= lineHeight;
  currentPage.drawText('Non contractuel - A valider avant envoi au client', {
    x: margin, y, size: 10, font: fontBold, color: draftRed,
  });
  y -= lineHeight;
  currentPage.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: PAGE_W - margin, y: y + 10 },
    thickness: 2, color: draftRed,
  });
  y -= lineHeight;
  currentPage.drawText(`Genere le ${formatDate(new Date().toISOString())}`, {
    x: margin, y, size: 8, font, color: gray,
  });

  // Final page number
  currentPage.drawText(sanitize(`Page ${pageNum}`), {
    x: PAGE_W - margin - 40, y: margin - 15, size: 8, font, color: gray,
  });

  return await pdfDoc.save();
}

// ============================================================================
// HANDLER
// ============================================================================

Deno.serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  const t0 = Date.now();
  const correlationId = getCorrelationId(req);
  let userId: string | undefined;

  try {
    // --- Auth (verify_jwt=true guarantees JWT present) ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      // Unreachable with verify_jwt=true, but defensive
      return respondError({ code: 'AUTH_INVALID_JWT', message: 'Unauthorized', correlationId });
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await userClient.auth.getUser(token);
    if (authError || !user) {
      await logRuntimeEvent(
        createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
        {
          correlationId, functionName: FUNCTION_NAME, op: 'auth',
          status: 'fatal_error', errorCode: 'AUTH_INVALID_JWT',
          httpStatus: 401, durationMs: Date.now() - t0,
        },
      );
      return respondError({ code: 'AUTH_INVALID_JWT', message: 'Invalid or expired token', correlationId });
    }
    userId = user.id;

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // --- Parse body ---
    const { version_id } = await req.json();
    if (!version_id) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FUNCTION_NAME, op: 'validate',
        userId, status: 'fatal_error', errorCode: 'VALIDATION_FAILED',
        httpStatus: 400, durationMs: Date.now() - t0,
      });
      return respondError({ code: 'VALIDATION_FAILED', message: 'version_id is required', correlationId });
    }

    // --- Load version via userClient (RLS ownership check) ---
    const { data: version, error: versionError } = await userClient
      .from('quotation_versions')
      .select('id, case_id, version_number, status, snapshot')
      .eq('id', version_id)
      .maybeSingle();

    if (versionError || !version) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FUNCTION_NAME, op: 'load_version',
        userId, status: 'fatal_error', errorCode: 'VALIDATION_FAILED',
        httpStatus: 404, durationMs: Date.now() - t0,
        meta: { error: versionError?.message ?? 'not_found' },
      });
      return respondError({ code: 'VALIDATION_FAILED', message: 'Quotation version not found or access denied', correlationId });
    }

    // --- Guard: version must be draft ---
    if (version.status !== 'draft') {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FUNCTION_NAME, op: 'guard_version_status',
        userId, status: 'fatal_error', errorCode: 'CONFLICT_INVALID_STATE',
        httpStatus: 409, durationMs: Date.now() - t0,
        meta: { version_status: version.status },
      });
      return respondError({ code: 'CONFLICT_INVALID_STATE', message: `Version status must be draft, got ${version.status}`, correlationId });
    }

    // --- Guard FSM: quote_cases.status = QUOTED_VERSIONED (micro-fix 2: userClient for RLS) ---
    const { data: caseData, error: caseError } = await userClient
      .from('quote_cases')
      .select('status')
      .eq('id', version.case_id)
      .maybeSingle();

    if (caseError || !caseData) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FUNCTION_NAME, op: 'guard_fsm',
        userId, status: 'fatal_error', errorCode: 'VALIDATION_FAILED',
        httpStatus: 404, durationMs: Date.now() - t0,
      });
      return respondError({ code: 'VALIDATION_FAILED', message: 'Quote case not found', correlationId });
    }

    // Phase 19B C3: Allow QUOTED_VERSIONED and SENT (SENT = read-only idempotent)
    const ALLOWED_EXPORT_STATUSES = ['QUOTED_VERSIONED', 'SENT'];
    if (!ALLOWED_EXPORT_STATUSES.includes(caseData.status)) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FUNCTION_NAME, op: 'guard_fsm',
        userId, status: 'fatal_error', errorCode: 'CONFLICT_INVALID_STATE',
        httpStatus: 409, durationMs: Date.now() - t0,
        meta: { current_status: caseData.status, required: ALLOWED_EXPORT_STATUSES },
      });
      return respondError({
        code: 'CONFLICT_INVALID_STATE',
        message: `Case status must be one of ${ALLOWED_EXPORT_STATUSES.join(', ')}, got ${caseData.status}`,
        correlationId,
      });
    }

    // --- Snapshot check ---
    // deno-lint-ignore no-explicit-any
    const snapshot = version.snapshot as any;
    if (!snapshot) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FUNCTION_NAME, op: 'validate_snapshot',
        userId, status: 'fatal_error', errorCode: 'UPSTREAM_DB_ERROR',
        httpStatus: 500, durationMs: Date.now() - t0,
      });
      return respondError({ code: 'UPSTREAM_DB_ERROR', message: 'Version snapshot is empty', correlationId });
    }

    // --- Idempotence: check existing PDF for this version ---
    const { data: existingDoc } = await serviceClient
      .from('quotation_documents')
      .select('id, file_path, file_hash, file_size')
      .eq('quotation_version_id', version_id)
      .eq('document_type', 'pdf')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingDoc) {
      // Micro-fix 1: handle signedUrl failure explicitly
      const { data: existingSignedData, error: signedErr } = await serviceClient.storage
        .from('quotation-attachments')
        .createSignedUrl(existingDoc.file_path, 3600);

      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FUNCTION_NAME, op: 'idempotent_hit',
        userId, status: 'ok', httpStatus: 200,
        durationMs: Date.now() - t0,
        meta: {
          document_id: existingDoc.id,
          version_id,
          signed_url_error: signedErr?.message ?? null,
        },
      });

      return respondOk({
        case_id: version.case_id,
        version_id: version.id,
        document_id: existingDoc.id,
        file_path: existingDoc.file_path,
        file_hash: existingDoc.file_hash,
        file_size: existingDoc.file_size,
        url: existingSignedData?.signedUrl ?? null,
        idempotent: true,
      }, correlationId);
    }

    // Phase 19B C3-A: SENT without existing doc = cannot generate new PDF
    if (caseData.status === 'SENT') {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FUNCTION_NAME, op: 'guard_sent_generation',
        userId, status: 'fatal_error', errorCode: 'CONFLICT_INVALID_STATE',
        httpStatus: 409, durationMs: Date.now() - t0,
      });
      return respondError({
        code: 'CONFLICT_INVALID_STATE',
        message: 'Cannot generate new PDF after sending',
        correlationId,
      });
    }

    // --- Generate PDF (pure projection) ---
    const pdfBytes = await generateDraftPdf(snapshot, version.case_id);
    const fileHash = await sha256(pdfBytes);
    const fileSize = pdfBytes.length;

    // Storage path (versioned, non-overwriting)
    const timestamp = Date.now();
    const filePath = `QC-${version.case_id}/v${version.version_number}/draft-${timestamp}.pdf`;

    // --- Upload to storage ---
    const { error: uploadError } = await serviceClient.storage
      .from('quotation-attachments')
      .upload(filePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FUNCTION_NAME, op: 'upload_storage',
        userId, status: 'fatal_error', errorCode: 'UPSTREAM_DB_ERROR',
        httpStatus: 500, durationMs: Date.now() - t0,
        meta: { error: uploadError.message },
      });
      return respondError({ code: 'UPSTREAM_DB_ERROR', message: `Storage upload failed: ${uploadError.message}`, correlationId });
    }

    // --- Insert quotation_documents (BLOCKING) ---
    // Phase 17C: quotation_version_id is the primary link
    // quotation_id/root_quotation_id = null (no legacy quotation_history record)
    // Micro-fix 3: maybeSingle() + check docRecord.id
    const { data: docRecord, error: insertError } = await serviceClient
      .from('quotation_documents')
      .insert({
        quotation_id: null,
        root_quotation_id: null,
        quotation_version_id: version.id,
        version: version.version_number,
        status: 'generated',
        document_type: 'pdf',
        file_path: filePath,
        file_size: fileSize,
        file_hash: fileHash,
        created_by: user.id,
      })
      .select('id')
      .maybeSingle();

    if (insertError || !docRecord?.id) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FUNCTION_NAME, op: 'insert_document',
        userId, status: 'fatal_error', errorCode: 'UPSTREAM_DB_ERROR',
        httpStatus: 500, durationMs: Date.now() - t0,
        meta: { error: insertError?.message ?? 'no_id_returned' },
      });
      return respondError({ code: 'UPSTREAM_DB_ERROR', message: 'Failed to create document record', correlationId });
    }

    // --- Signed URL ---
    const { data: signedData, error: signError } = await serviceClient.storage
      .from('quotation-attachments')
      .createSignedUrl(filePath, 3600);

    if (signError) {
      await logRuntimeEvent(serviceClient, {
        correlationId, functionName: FUNCTION_NAME, op: 'sign_url',
        userId, status: 'fatal_error', errorCode: 'UPSTREAM_DB_ERROR',
        httpStatus: 500, durationMs: Date.now() - t0,
        meta: { error: signError.message },
      });
      return respondError({ code: 'UPSTREAM_DB_ERROR', message: 'Failed to create signed URL', correlationId });
    }

    // --- Success ---
    await logRuntimeEvent(serviceClient, {
      correlationId, functionName: FUNCTION_NAME, op: 'export_pdf',
      userId, status: 'ok', httpStatus: 200,
      durationMs: Date.now() - t0,
      meta: { document_id: docRecord.id, version_id: version.id, file_size: fileSize },
    });

    return respondOk({
      case_id: version.case_id,
      version_id: version.id,
      document_id: docRecord.id,
      file_path: filePath,
      file_hash: fileHash,
      file_size: fileSize,
      url: signedData.signedUrl,
    }, correlationId);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Internal error';
    try {
      const sc = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      );
      await logRuntimeEvent(sc, {
        correlationId, functionName: FUNCTION_NAME, op: 'unhandled',
        userId, status: 'fatal_error', errorCode: 'UNKNOWN',
        httpStatus: 500, durationMs: Date.now() - t0,
      });
    } catch (_) { /* best-effort */ }
    return respondError({ code: 'UNKNOWN', message: errMsg, correlationId });
  }
});
