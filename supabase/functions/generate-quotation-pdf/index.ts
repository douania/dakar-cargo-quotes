/**
 * Edge Function: generate-quotation-pdf
 * Phase 6D.2 — Export PDF depuis snapshot validé
 * 
 * Génère un PDF professionnel depuis generated_snapshot (données figées)
 * Upload dans storage, trace dans quotation_documents
 * 
 * RÈGLES CTO :
 * - PDF = projection pure du snapshot (aucun recalcul)
 * - verify_jwt = true (document officiel)
 * - Ownership vérifié (created_by)
 * - Status vérifié (doit être 'generated')
 * 
 * Phase 14: Runtime observability integration
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders, handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { 
  getCorrelationId, 
  respondOk, 
  respondError as runtimeRespondError, 
  logRuntimeEvent,
} from "../_shared/runtime.ts";

// Types alignés sur GeneratedSnapshot (Phase 6D.1)
interface SnapshotMeta {
  quotation_id: string;
  version: number;
  generated_at: string;
  currency: string;
}

interface SnapshotClient {
  name: string | null;
  company: string | null;
  project_name: string | null;
  incoterm: string | null;
  route_origin: string | null;
  route_destination: string | null;
}

interface SnapshotCargoLine {
  id: string;
  description: string | null;
  cargo_type: string;
  container_type?: string | null;
  container_count?: number | null;
  weight_kg?: number | null;
  volume_cbm?: number | null;
}

interface SnapshotServiceLine {
  id: string;
  service: string;
  description: string | null;
  quantity: number;
  rate: number;
  currency: string;
  unit: string | null;
}

interface SnapshotTotals {
  subtotal: number;
  total: number;
  currency: string;
}

interface GeneratedSnapshot {
  meta: SnapshotMeta;
  client: SnapshotClient;
  cargo_lines: SnapshotCargoLine[];
  service_lines: SnapshotServiceLine[];
  totals: SnapshotTotals;
}

// Format montant avec séparateurs
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

// Génération du PDF depuis snapshot (projection pure)
async function generatePdfFromSnapshot(snapshot: GeneratedSnapshot): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4
  const { width, height } = page.getSize();
  
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  
  const margin = 50;
  let y = height - margin;
  const lineHeight = 18;
  const sectionGap = 25;
  
  // Couleurs
  const black = rgb(0, 0, 0);
  const gray = rgb(0.4, 0.4, 0.4);
  const primary = rgb(0.1, 0.3, 0.6);
  
  // === HEADER ===
  page.drawText('SODATRA SHIPPING & LOGISTICS', {
    x: margin,
    y,
    size: 16,
    font: fontBold,
    color: primary,
  });
  y -= lineHeight;
  
  // Ligne séparatrice
  page.drawLine({
    start: { x: margin, y: y + 5 },
    end: { x: width - margin, y: y + 5 },
    thickness: 1,
    color: primary,
  });
  y -= lineHeight;
  
  // Numéro devis + version (depuis snapshot.meta)
  const shortId = snapshot.meta.quotation_id.substring(0, 8).toUpperCase();
  page.drawText(`DEVIS N° Q-${shortId}`, {
    x: margin,
    y,
    size: 14,
    font: fontBold,
    color: black,
  });
  
  // Badge version + statut GÉNÉRÉ (à droite)
  const versionText = `v${snapshot.meta.version}`;
  page.drawText(`[${versionText}] [DOCUMENT OFFICIEL]`, {
    x: width - margin - 160,
    y,
    size: 10,
    font: fontBold,
    color: primary,
  });
  y -= lineHeight;
  
  // Date de génération (depuis snapshot.meta)
  page.drawText(`Date: ${formatDate(snapshot.meta.generated_at)}`, {
    x: margin,
    y,
    size: 10,
    font,
    color: gray,
  });
  y -= sectionGap;
  
  // === BLOC CLIENT (depuis snapshot.client) ===
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
  
  if (snapshot.client.name) {
    page.drawText(`Nom: ${snapshot.client.name}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: black,
    });
    y -= lineHeight;
  }
  
  if (snapshot.client.company) {
    page.drawText(`Société: ${snapshot.client.company}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: black,
    });
    y -= lineHeight;
  }
  
  if (snapshot.client.project_name) {
    page.drawText(`Projet: ${snapshot.client.project_name}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: black,
    });
    y -= lineHeight;
  }
  y -= sectionGap / 2;
  
  // === ROUTE (depuis snapshot.client) ===
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
    snapshot.client.route_origin,
    'Dakar',
    snapshot.client.route_destination,
  ].filter(Boolean);
  
  page.drawText(routeParts.join(' → '), {
    x: margin,
    y,
    size: 10,
    font,
    color: black,
  });
  y -= lineHeight;
  
  if (snapshot.client.incoterm) {
    page.drawText(`Incoterm: ${snapshot.client.incoterm}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: black,
    });
    y -= lineHeight;
  }
  y -= sectionGap / 2;
  
  // === MARCHANDISES (depuis snapshot.cargo_lines) ===
  if (snapshot.cargo_lines && snapshot.cargo_lines.length > 0) {
    page.drawLine({
      start: { x: margin, y: y + 10 },
      end: { x: width - margin, y: y + 10 },
      thickness: 0.5,
      color: gray,
    });
    y -= 5;
    
    page.drawText('MARCHANDISES', {
      x: margin,
      y,
      size: 11,
      font: fontBold,
      color: primary,
    });
    y -= lineHeight + 5;
    
    // En-tête tableau cargo
    page.drawText('Description', { x: margin, y, size: 9, font: fontBold, color: gray });
    page.drawText('Type', { x: margin + 200, y, size: 9, font: fontBold, color: gray });
    page.drawText('Conteneurs', { x: margin + 300, y, size: 9, font: fontBold, color: gray });
    page.drawText('Poids (kg)', { x: margin + 380, y, size: 9, font: fontBold, color: gray });
    y -= lineHeight;
    
    page.drawLine({
      start: { x: margin, y: y + 10 },
      end: { x: width - margin, y: y + 10 },
      thickness: 0.5,
      color: gray,
    });
    y -= 5;
    
    for (const cargo of snapshot.cargo_lines) {
      if (y < margin + 100) break;
      
      const descText = (cargo.description || cargo.cargo_type || '').substring(0, 30);
      const typeText = (cargo.container_type || '-').substring(0, 15);
      const countText = cargo.container_count?.toString() || '-';
      const weightText = cargo.weight_kg ? formatAmount(cargo.weight_kg) : '-';
      
      page.drawText(descText, { x: margin, y, size: 9, font, color: black });
      page.drawText(typeText, { x: margin + 200, y, size: 9, font, color: black });
      page.drawText(countText, { x: margin + 300, y, size: 9, font, color: black });
      page.drawText(weightText, { x: margin + 380, y, size: 9, font, color: black });
      y -= lineHeight;
    }
    y -= sectionGap / 2;
  }
  
  // === SERVICES (depuis snapshot.service_lines) ===
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
  
  // En-tête tableau services
  const colService = margin;
  const colDesc = margin + 120;
  const colQty = margin + 280;
  const colRate = margin + 330;
  const colAmount = margin + 400;
  const colCurrency = width - margin - 40;
  
  page.drawText('Service', { x: colService, y, size: 9, font: fontBold, color: gray });
  page.drawText('Description', { x: colDesc, y, size: 9, font: fontBold, color: gray });
  page.drawText('Qté', { x: colQty, y, size: 9, font: fontBold, color: gray });
  page.drawText('Tarif', { x: colRate, y, size: 9, font: fontBold, color: gray });
  page.drawText('Montant', { x: colAmount, y, size: 9, font: fontBold, color: gray });
  y -= lineHeight;
  
  // Ligne séparatrice en-tête
  page.drawLine({
    start: { x: margin, y: y + 10 },
    end: { x: width - margin, y: y + 10 },
    thickness: 0.5,
    color: gray,
  });
  y -= 5;
  
  // Lignes de services (depuis snapshot)
  const serviceLines = snapshot.service_lines || [];
  for (const line of serviceLines) {
    if (y < margin + 100) break;
    
    const serviceText = (line.service || '').substring(0, 18);
    const descText = (line.description || '').substring(0, 22);
    const amount = (line.rate || 0) * (line.quantity || 1);
    
    page.drawText(serviceText, { x: colService, y, size: 9, font, color: black });
    page.drawText(descText, { x: colDesc, y, size: 9, font, color: black });
    page.drawText(line.quantity?.toString() || '1', { x: colQty, y, size: 9, font, color: black });
    page.drawText(formatAmount(line.rate || 0), { x: colRate, y, size: 9, font, color: black });
    page.drawText(formatAmount(amount), { x: colAmount, y, size: 9, font, color: black });
    page.drawText(line.currency || 'FCFA', { x: colCurrency, y, size: 9, font, color: black });
    y -= lineHeight;
  }
  y -= sectionGap / 2;
  
  // === TOTAL (depuis snapshot.totals) ===
  page.drawLine({
    start: { x: margin, y: y + 10 },
    end: { x: width - margin, y: y + 10 },
    thickness: 1,
    color: primary,
  });
  y -= 5;
  
  const totalText = `TOTAL: ${formatAmount(snapshot.totals.total || 0)} ${snapshot.totals.currency || 'FCFA'}`;
  page.drawText(totalText, {
    x: margin,
    y,
    size: 14,
    font: fontBold,
    color: primary,
  });
  y -= sectionGap;
  
  // === FOOTER LÉGAL ===
  page.drawLine({
    start: { x: margin, y: y + 10 },
    end: { x: width - margin, y: y + 10 },
    thickness: 0.5,
    color: gray,
  });
  y -= 5;
  
  // Mention légale pour document officiel (status = generated)
  page.drawText('Document officiel — Offre valable 30 jours à compter de la date d\'émission', {
    x: margin,
    y,
    size: 10,
    font: fontBold,
    color: primary,
  });
  y -= lineHeight;
  
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
  
  // Phase 14: Correlation + timing
  const correlationId = getCorrelationId(req);
  const startTime = Date.now();
  let userId: string | undefined;

  // Service client créé tôt pour logging
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
  
  try {
    // Auth validation (JWT vérifié par Supabase gateway + getUser)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation-pdf',
        op: 'auth',
        status: 'fatal_error',
        errorCode: 'AUTH_MISSING_JWT',
        httpStatus: 401,
        durationMs: Date.now() - startTime,
      });
      return runtimeRespondError({
        code: 'AUTH_MISSING_JWT',
        message: 'Unauthorized',
        correlationId,
      });
    }
    
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    });
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation-pdf',
        op: 'auth',
        status: 'fatal_error',
        errorCode: 'AUTH_INVALID_JWT',
        httpStatus: 401,
        durationMs: Date.now() - startTime,
      });
      return runtimeRespondError({
        code: 'AUTH_INVALID_JWT',
        message: 'Unauthorized',
        correlationId,
      });
    }
    
    userId = user.id;
    
    // Parse body
    const { quotationId } = await req.json();
    if (!quotationId) {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation-pdf',
        op: 'validate',
        userId,
        status: 'fatal_error',
        errorCode: 'VALIDATION_FAILED',
        httpStatus: 400,
        durationMs: Date.now() - startTime,
        meta: { field: 'quotationId' },
      });
      return runtimeRespondError({
        code: 'VALIDATION_FAILED',
        message: 'quotationId is required',
        correlationId,
      });
    }
    
    // Fetch quotation avec generated_snapshot (source unique Phase 6D.2)
    const { data: quotation, error: fetchError } = await supabase
      .from('quotation_history')
      .select(`
        id,
        status,
        version,
        generated_snapshot,
        created_by
      `)
      .eq('id', quotationId)
      .single();
    
    if (fetchError || !quotation) {
      console.error('Fetch error:', fetchError);
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation-pdf',
        op: 'load_quotation',
        userId,
        status: 'fatal_error',
        errorCode: 'VALIDATION_FAILED',
        httpStatus: 404,
        durationMs: Date.now() - startTime,
        meta: { quotationId },
      });
      return runtimeRespondError({
        code: 'VALIDATION_FAILED',
        message: 'Quotation not found',
        correlationId,
      });
    }
    
    // Vérification ownership (règle CTO non négociable)
    if (quotation.created_by !== user.id) {
      console.error('Ownership violation:', { quotation_owner: quotation.created_by, requester: user.id });
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation-pdf',
        op: 'ownership',
        userId,
        status: 'fatal_error',
        errorCode: 'FORBIDDEN_OWNER',
        httpStatus: 403,
        durationMs: Date.now() - startTime,
        meta: { quotationId, owner: quotation.created_by },
      });
      return runtimeRespondError({
        code: 'FORBIDDEN_OWNER',
        message: 'Non autorisé',
        correlationId,
      });
    }
    
    // Vérification statut (PDF uniquement depuis snapshot validé)
    if (quotation.status !== 'generated') {
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation-pdf',
        op: 'status_check',
        userId,
        status: 'fatal_error',
        errorCode: 'CONFLICT_INVALID_STATE',
        httpStatus: 400,
        durationMs: Date.now() - startTime,
        meta: { quotationId, current_status: quotation.status },
      });
      return runtimeRespondError({
        code: 'CONFLICT_INVALID_STATE',
        message: 'Devis non généré - impossible de créer le PDF',
        correlationId,
        meta: { current_status: quotation.status },
      });
    }
    
    // Vérification snapshot présent
    if (!quotation.generated_snapshot) {
      console.error('Missing snapshot for quotation:', quotationId);
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation-pdf',
        op: 'validate_snapshot',
        userId,
        status: 'fatal_error',
        errorCode: 'UPSTREAM_DB_ERROR',
        httpStatus: 500,
        durationMs: Date.now() - startTime,
        meta: { quotationId },
      });
      return runtimeRespondError({
        code: 'UPSTREAM_DB_ERROR',
        message: 'Snapshot manquant - régénérez le devis',
        correlationId,
      });
    }
    
    // Cast snapshot (JSONB → type)
    const snapshot = quotation.generated_snapshot as GeneratedSnapshot;
    
    // Générer le PDF depuis snapshot (projection pure)
    const pdfBytes = await generatePdfFromSnapshot(snapshot);
    
    // Calculer hash et taille
    const fileHash = await sha256(pdfBytes);
    const fileSize = pdfBytes.length;
    
    // Chemin storage (non-écrasant, versionné)
    const version = quotation.version || 1;
    const timestamp = Date.now();
    const filePath = `Q-${quotationId}/v${version}/quote-${quotationId}-${timestamp}.pdf`;
    
    // Upload dans storage
    const { error: uploadError } = await supabase.storage
      .from('quotation-attachments')
      .upload(filePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });
    
    if (uploadError) {
      console.error('Upload error:', uploadError);
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation-pdf',
        op: 'storage_upload',
        userId,
        status: 'fatal_error',
        errorCode: 'UPSTREAM_DB_ERROR',
        httpStatus: 500,
        durationMs: Date.now() - startTime,
        meta: { quotationId, error: uploadError.message },
      });
      return runtimeRespondError({
        code: 'UPSTREAM_DB_ERROR',
        message: `Storage upload failed: ${uploadError.message}`,
        correlationId,
      });
    }
    
    // Insérer trace dans quotation_documents
    const { data: docRecord, error: insertError } = await supabase
      .from('quotation_documents')
      .insert({
        quotation_id: quotation.id,
        root_quotation_id: snapshot.meta.quotation_id,
        version,
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
      console.error('Insert error:', insertError);
      // Continue quand même, le PDF est uploadé
    }
    
    // Générer signed URL (1 heure)
    const { data: signedData, error: signError } = await supabase.storage
      .from('quotation-attachments')
      .createSignedUrl(filePath, 3600);
    
    if (signError) {
      console.error('Sign error:', signError);
      await logRuntimeEvent(serviceClient, {
        correlationId,
        functionName: 'generate-quotation-pdf',
        op: 'create_signed_url',
        userId,
        status: 'fatal_error',
        errorCode: 'UPSTREAM_DB_ERROR',
        httpStatus: 500,
        durationMs: Date.now() - startTime,
        meta: { quotationId, filePath },
      });
      return runtimeRespondError({
        code: 'UPSTREAM_DB_ERROR',
        message: 'Failed to create signed URL',
        correlationId,
      });
    }
    
    // Phase 14: Log runtime event
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: 'generate-quotation-pdf',
      op: 'generate',
      userId,
      status: 'ok',
      httpStatus: 200,
      durationMs: Date.now() - startTime,
      meta: { quotationId, filePath },
    });
    
    return respondOk({
      success: true,
      url: signedData.signedUrl,
      documentId: docRecord?.id,
      filePath,
      fileHash,
      fileSize,
    }, correlationId);
    
  } catch (error) {
    console.error('Generate PDF error:', error);
    
    // Phase 14: Log error (serviceClient déjà créé en haut)
    await logRuntimeEvent(serviceClient, {
      correlationId,
      functionName: 'generate-quotation-pdf',
      op: 'generate',
      userId,
      status: 'fatal_error',
      errorCode: 'UNKNOWN',
      httpStatus: 500,
      durationMs: Date.now() - startTime,
      meta: { error: String(error) },
    });

    return runtimeRespondError({
      code: 'UNKNOWN',
      message: error instanceof Error ? error.message : 'Internal error',
      correlationId,
    });
  }
});
