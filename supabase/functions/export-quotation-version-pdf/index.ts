/**
 * Phase 17C: export-quotation-version-pdf
 * Generates a DRAFT PDF from quotation_versions.snapshot
 * 
 * Runtime Contract (Phase 14-16):
 * - verify_jwt = true (config.toml)
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
// PDF GENERATION (pure projection from snapshot)
// ============================================================================

// deno-lint-ignore no-explicit-any
async function generateDraftPdf(snapshot: any, caseId: string): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const margin = 50;
  let y = height - margin;
  const lineHeight = 18;
  const sectionGap = 25;

  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const primary = rgb(0.1, 0.3, 0.6);
  const draftRed = rgb(0.8, 0.2, 0.2);

  // === HEADER ===
  page.drawText('SODATRA SHIPPING & LOGISTICS', {
    x: margin, y, size: 16, font: fontBold, color: primary,
  });
  y -= lineHeight;

  page.drawLine({
    start: { x: margin, y: y + 5 }, end: { x: width - margin, y: y + 5 },
    thickness: 1, color: primary,
  });
  y -= lineHeight;

  const shortId = caseId.substring(0, 8).toUpperCase();
  page.drawText(sanitize(`DEVIS N° QC-${shortId}`), {
    x: margin, y, size: 14, font: fontBold, color: black,
  });

  const versionText = `v${snapshot.meta?.version_number || 1}`;
  page.drawText(`[${versionText}]`, {
    x: width - margin - 140, y, size: 10, font: fontBold, color: primary,
  });

  page.drawText('[DRAFT]', {
    x: width - margin - 80, y, size: 12, font: fontBold, color: draftRed,
  });
  y -= lineHeight;

  page.drawText(sanitize(`Date: ${formatDate(snapshot.meta?.created_at || new Date().toISOString())}`), {
    x: margin, y, size: 10, font, color: gray,
  });
  y -= sectionGap;

  // === CLIENT ===
  page.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: width - margin, y: y + 10 },
    thickness: 0.5, color: gray,
  });
  y -= 5;
  page.drawText('CLIENT', { x: margin, y, size: 11, font: fontBold, color: primary });
  y -= lineHeight;

  if (snapshot.client?.email) {
    page.drawText(sanitize(`Email: ${snapshot.client.email}`), { x: margin, y, size: 10, font, color: black });
    y -= lineHeight;
  }
  if (snapshot.client?.company) {
    page.drawText(sanitize(`Societe: ${snapshot.client.company}`), { x: margin, y, size: 10, font, color: black });
    y -= lineHeight;
  }
  y -= sectionGap / 2;

  // === ROUTE ===
  page.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: width - margin, y: y + 10 },
    thickness: 0.5, color: gray,
  });
  y -= 5;
  page.drawText('ROUTE', { x: margin, y, size: 11, font: fontBold, color: primary });
  y -= lineHeight;

  const routeParts = [
    snapshot.inputs?.origin, 'Dakar', snapshot.inputs?.destination,
  ].filter(Boolean);
  page.drawText(sanitize(routeParts.join(' -> ') || 'Non specifie'), {
    x: margin, y, size: 10, font, color: black,
  });
  y -= lineHeight;

  if (snapshot.inputs?.incoterm) {
    page.drawText(sanitize(`Incoterm: ${snapshot.inputs.incoterm}`), {
      x: margin, y, size: 10, font, color: black,
    });
    y -= lineHeight;
  }
  y -= sectionGap / 2;

  // === SERVICES TABLE ===
  page.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: width - margin, y: y + 10 },
    thickness: 0.5, color: gray,
  });
  y -= 5;
  page.drawText('PRESTATIONS', { x: margin, y, size: 11, font: fontBold, color: primary });
  y -= lineHeight + 5;

  const colService = margin;
  const colDesc = margin + 100;
  const colQty = margin + 280;
  const colRate = margin + 330;
  const colAmount = margin + 400;

  page.drawText('Service', { x: colService, y, size: 9, font: fontBold, color: gray });
  page.drawText('Description', { x: colDesc, y, size: 9, font: fontBold, color: gray });
  page.drawText('Qte', { x: colQty, y, size: 9, font: fontBold, color: gray });
  page.drawText('Tarif', { x: colRate, y, size: 9, font: fontBold, color: gray });
  page.drawText('Montant', { x: colAmount, y, size: 9, font: fontBold, color: gray });
  y -= lineHeight;

  page.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: width - margin, y: y + 10 },
    thickness: 0.5, color: gray,
  });
  y -= 5;

  const lines = snapshot.lines || [];
  for (const line of lines) {
    if (y < margin + 120) break;
    const serviceText = sanitize((line.service_code || '').substring(0, 15));
    const descText = sanitize((line.description || '').substring(0, 25));
    const amount = line.amount || 0;

    page.drawText(serviceText, { x: colService, y, size: 9, font, color: black });
    page.drawText(descText, { x: colDesc, y, size: 9, font, color: black });
    page.drawText((line.quantity || 1).toString(), { x: colQty, y, size: 9, font, color: black });
    page.drawText(formatAmount(line.unit_price || 0), { x: colRate, y, size: 9, font, color: black });
    page.drawText(formatAmount(amount), { x: colAmount, y, size: 9, font, color: black });
    y -= lineHeight;
  }
  y -= sectionGap / 2;

  // === TOTAL ===
  page.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: width - margin, y: y + 10 },
    thickness: 1, color: primary,
  });
  y -= 5;

  const totalText = sanitize(`TOTAL HT: ${formatAmount(snapshot.totals?.total_ht || 0)} ${snapshot.totals?.currency || 'XOF'}`);
  page.drawText(totalText, { x: margin, y, size: 14, font: fontBold, color: primary });
  y -= sectionGap;

  // === DRAFT FOOTER ===
  page.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: width - margin, y: y + 10 },
    thickness: 2, color: draftRed,
  });
  y -= 5;

  page.drawText('*** DRAFT - DOCUMENT DE TRAVAIL ***', {
    x: margin, y, size: 12, font: fontBold, color: draftRed,
  });
  y -= lineHeight;

  page.drawText('Non contractuel - A valider avant envoi au client', {
    x: margin, y, size: 10, font: fontBold, color: draftRed,
  });
  y -= lineHeight;

  page.drawLine({
    start: { x: margin, y: y + 10 }, end: { x: width - margin, y: y + 10 },
    thickness: 2, color: draftRed,
  });
  y -= lineHeight;

  page.drawText(`Genere le ${formatDate(new Date().toISOString())}`, {
    x: margin, y, size: 8, font, color: gray,
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

    const { data: { user }, error: authError } = await userClient.auth.getUser();
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
