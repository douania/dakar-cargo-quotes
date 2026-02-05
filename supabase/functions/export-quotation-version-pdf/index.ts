/**
 * Phase 12: export-quotation-version-pdf
 * Generates a DRAFT PDF from quotation_versions.snapshot
 * 
 * CTO Rules:
 * - verify_jwt = true (document export)
 * - PDF = pure projection from snapshot (no recalculation)
 * - Mandatory "DRAFT" mention
 * - CTO ADJUSTMENT #6: Store in quotation_documents with quotation_version_id
 * - Hash for audit trail
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders, handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

// Format amount with separators
function formatAmount(amount: number): string {
  return new Intl.NumberFormat('fr-FR').format(amount);
}

// Format date FR
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// SHA-256 hash
async function sha256(data: Uint8Array): Promise<string> {
  const arrayBuffer = new ArrayBuffer(data.length);
  const view = new Uint8Array(arrayBuffer);
  view.set(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Generate PDF from snapshot (pure projection)
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
  
  // Colors
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const primary = rgb(0.1, 0.3, 0.6);
  const draftRed = rgb(0.8, 0.2, 0.2);
  
  // === HEADER ===
  page.drawText('SODATRA SHIPPING & LOGISTICS', {
    x: margin,
    y,
    size: 16,
    font: fontBold,
    color: primary,
  });
  y -= lineHeight;
  
  // Separator line
  page.drawLine({
    start: { x: margin, y: y + 5 },
    end: { x: width - margin, y: y + 5 },
    thickness: 1,
    color: primary,
  });
  y -= lineHeight;
  
  // Quote number + version
  const shortId = caseId.substring(0, 8).toUpperCase();
  page.drawText(`DEVIS N° QC-${shortId}`, {
    x: margin,
    y,
    size: 14,
    font: fontBold,
    color: black,
  });
  
  // Version badge + DRAFT status (right side)
  const versionText = `v${snapshot.meta?.version_number || 1}`;
  page.drawText(`[${versionText}]`, {
    x: width - margin - 140,
    y,
    size: 10,
    font: fontBold,
    color: primary,
  });
  
  // DRAFT badge - prominent red
  page.drawText('[DRAFT]', {
    x: width - margin - 80,
    y,
    size: 12,
    font: fontBold,
    color: draftRed,
  });
  y -= lineHeight;
  
  // Creation date
  page.drawText(`Date: ${formatDate(snapshot.meta?.created_at || new Date().toISOString())}`, {
    x: margin,
    y,
    size: 10,
    font,
    color: gray,
  });
  y -= sectionGap;
  
  // === CLIENT SECTION ===
  page.drawLine({
    start: { x: margin, y: y + 10 },
    end: { x: width - margin, y: y + 10 },
    thickness: 0.5,
    color: gray,
  });
  y -= 5;
  
  page.drawText('CLIENT', {
    x: margin,
    y,
    size: 11,
    font: fontBold,
    color: primary,
  });
  y -= lineHeight;
  
  if (snapshot.client?.email) {
    page.drawText(`Email: ${snapshot.client.email}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: black,
    });
    y -= lineHeight;
  }
  
  if (snapshot.client?.company) {
    page.drawText(`Société: ${snapshot.client.company}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: black,
    });
    y -= lineHeight;
  }
  y -= sectionGap / 2;
  
  // === ROUTE SECTION ===
  page.drawLine({
    start: { x: margin, y: y + 10 },
    end: { x: width - margin, y: y + 10 },
    thickness: 0.5,
    color: gray,
  });
  y -= 5;
  
  page.drawText('ROUTE', {
    x: margin,
    y,
    size: 11,
    font: fontBold,
    color: primary,
  });
  y -= lineHeight;
  
  const routeParts = [
    snapshot.inputs?.origin,
    'Dakar',
    snapshot.inputs?.destination,
  ].filter(Boolean);
  
  page.drawText(routeParts.join(' → ') || 'Non spécifié', {
    x: margin,
    y,
    size: 10,
    font,
    color: black,
  });
  y -= lineHeight;
  
  if (snapshot.inputs?.incoterm) {
    page.drawText(`Incoterm: ${snapshot.inputs.incoterm}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: black,
    });
    y -= lineHeight;
  }
  y -= sectionGap / 2;
  
  // === SERVICES TABLE ===
  page.drawLine({
    start: { x: margin, y: y + 10 },
    end: { x: width - margin, y: y + 10 },
    thickness: 0.5,
    color: gray,
  });
  y -= 5;
  
  page.drawText('PRESTATIONS', {
    x: margin,
    y,
    size: 11,
    font: fontBold,
    color: primary,
  });
  y -= lineHeight + 5;
  
  // Table header
  const colService = margin;
  const colDesc = margin + 100;
  const colQty = margin + 280;
  const colRate = margin + 330;
  const colAmount = margin + 400;
  
  page.drawText('Service', { x: colService, y, size: 9, font: fontBold, color: gray });
  page.drawText('Description', { x: colDesc, y, size: 9, font: fontBold, color: gray });
  page.drawText('Qté', { x: colQty, y, size: 9, font: fontBold, color: gray });
  page.drawText('Tarif', { x: colRate, y, size: 9, font: fontBold, color: gray });
  page.drawText('Montant', { x: colAmount, y, size: 9, font: fontBold, color: gray });
  y -= lineHeight;
  
  // Header separator
  page.drawLine({
    start: { x: margin, y: y + 10 },
    end: { x: width - margin, y: y + 10 },
    thickness: 0.5,
    color: gray,
  });
  y -= 5;
  
  // Service lines from snapshot
  const lines = snapshot.lines || [];
  for (const line of lines) {
    if (y < margin + 120) break; // Keep space for footer
    
    const serviceText = (line.service_code || '').substring(0, 15);
    const descText = (line.description || '').substring(0, 25);
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
    start: { x: margin, y: y + 10 },
    end: { x: width - margin, y: y + 10 },
    thickness: 1,
    color: primary,
  });
  y -= 5;
  
  const totalText = `TOTAL HT: ${formatAmount(snapshot.totals?.total_ht || 0)} ${snapshot.totals?.currency || 'XOF'}`;
  page.drawText(totalText, {
    x: margin,
    y,
    size: 14,
    font: fontBold,
    color: primary,
  });
  y -= sectionGap;
  
  // === DRAFT FOOTER ===
  page.drawLine({
    start: { x: margin, y: y + 10 },
    end: { x: width - margin, y: y + 10 },
    thickness: 2,
    color: draftRed,
  });
  y -= 5;
  
  // DRAFT warning box
  page.drawText('*** DRAFT - DOCUMENT DE TRAVAIL ***', {
    x: margin,
    y,
    size: 12,
    font: fontBold,
    color: draftRed,
  });
  y -= lineHeight;
  
  page.drawText('Non contractuel - À valider avant envoi au client', {
    x: margin,
    y,
    size: 10,
    font: fontBold,
    color: draftRed,
  });
  y -= lineHeight;
  
  page.drawLine({
    start: { x: margin, y: y + 10 },
    end: { x: width - margin, y: y + 10 },
    thickness: 2,
    color: draftRed,
  });
  y -= lineHeight;
  
  // Generation info
  page.drawText(`Généré le ${formatDate(new Date().toISOString())}`, {
    x: margin,
    y,
    size: 8,
    font,
    color: gray,
  });
  
  return await pdfDoc.save();
}

Deno.serve(async (req) => {
  // CORS
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    // Auth validation
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Unauthorized', 401);
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return errorResponse('Unauthorized', 401);
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Parse body
    const { version_id } = await req.json();
    if (!version_id) {
      return errorResponse('version_id is required', 400);
    }

    // Load quotation version with ownership check via quote_cases
    const { data: version, error: versionError } = await userClient
      .from('quotation_versions')
      .select(`
        id,
        case_id,
        version_number,
        status,
        snapshot
      `)
      .eq('id', version_id)
      .single();

    if (versionError || !version) {
      console.error('Version load error:', versionError);
      return errorResponse('Quotation version not found or access denied', 404);
    }

    // Verify status is draft (can only export draft PDFs in Phase 12)
    if (version.status !== 'draft') {
      return errorResponse('Only draft versions can be exported in Phase 12', 400);
    }

    const snapshot = version.snapshot as any;
    if (!snapshot) {
      return errorResponse('Version snapshot is empty', 500);
    }

    // Generate PDF from snapshot (pure projection)
    const pdfBytes = await generateDraftPdf(snapshot, version.case_id);

    // Calculate hash and size
    const fileHash = await sha256(pdfBytes);
    const fileSize = pdfBytes.length;

    // Storage path (versioned, non-overwriting)
    const timestamp = Date.now();
    const filePath = `QC-${version.case_id}/v${version.version_number}/draft-${timestamp}.pdf`;

    // Upload to storage
    const { error: uploadError } = await serviceClient.storage
      .from('quotation-attachments')
      .upload(filePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return errorResponse(`Storage upload failed: ${uploadError.message}`, 500);
    }

    // CTO ADJUSTMENT #6: Insert into quotation_documents with quotation_version_id
    const { data: docRecord, error: insertError } = await serviceClient
      .from('quotation_documents')
      .insert({
        quotation_id: version.id, // Use version.id as quotation_id
        root_quotation_id: version.id,
        quotation_version_id: version.id, // CTO #6: Link to version
        version: version.version_number,
        status: 'generated',
        document_type: 'pdf',
        file_path: filePath,
        file_size: fileSize,
        file_hash: fileHash,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Document insert error:', insertError);
      // Non-blocking - PDF is uploaded
    }

    // Generate signed URL (1 hour)
    const { data: signedData, error: signError } = await serviceClient.storage
      .from('quotation-attachments')
      .createSignedUrl(filePath, 3600);

    if (signError) {
      console.error('Sign error:', signError);
      return errorResponse('Failed to create signed URL', 500);
    }

    console.log(`[Phase 12] Exported draft PDF v${version.version_number} for case ${version.case_id}`);

    return jsonResponse({
      success: true,
      url: signedData.signedUrl,
      document_id: docRecord?.id,
      file_path: filePath,
      file_hash: fileHash,
      file_size: fileSize,
      version_number: version.version_number,
    });

  } catch (error) {
    console.error('Export PDF error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Internal error', 500);
  }
});
