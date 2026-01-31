/**
 * Edge Function: generate-quotation-pdf
 * Phase 5C — Export PDF versionné
 * 
 * Génère un PDF professionnel depuis quotation_history (données figées)
 * Upload dans storage, trace dans quotation_documents
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";
import { corsHeaders, handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

// Types
interface TariffLine {
  service: string;
  description?: string;
  amount: number;
  currency: string;
  unit?: string;
}

interface QuotationData {
  id: string;
  root_quotation_id: string | null;
  version: number;
  status: string;
  client_name: string | null;
  client_company: string | null;
  project_name: string | null;
  route_origin: string | null;
  route_port: string;
  route_destination: string;
  incoterm: string | null;
  tariff_lines: TariffLine[] | null;
  total_amount: number | null;
  total_currency: string | null;
  created_at: string;
}

// Mention légale selon statut
function getStatusMention(status: string): string {
  switch (status) {
    case 'draft':
      return 'BROUILLON — Document non contractuel';
    case 'sent':
      return 'Offre valable 30 jours à compter de la date d\'émission';
    case 'accepted':
      return 'Devis accepté';
    case 'rejected':
      return 'Offre déclinée';
    case 'expired':
      return 'Offre expirée';
    default:
      return '';
  }
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
  // Créer un ArrayBuffer propre à partir du Uint8Array
  const arrayBuffer = new ArrayBuffer(data.length);
  const view = new Uint8Array(arrayBuffer);
  view.set(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Génération du PDF avec pdf-lib
async function generatePdf(quotation: QuotationData): Promise<Uint8Array> {
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
  
  // Numéro devis + version + statut
  const shortId = quotation.id.substring(0, 8).toUpperCase();
  page.drawText(`DEVIS N° Q-${shortId}`, {
    x: margin,
    y,
    size: 14,
    font: fontBold,
    color: black,
  });
  
  // Badge version + statut (à droite)
  const versionText = `v${quotation.version}`;
  const statusText = quotation.status === 'draft' ? 'BROUILLON' : 
                     quotation.status === 'sent' ? 'ENVOYÉ' :
                     quotation.status === 'accepted' ? 'ACCEPTÉ' : 
                     quotation.status === 'rejected' ? 'REFUSÉ' : 'EXPIRÉ';
  
  page.drawText(`[${versionText}] [${statusText}]`, {
    x: width - margin - 120,
    y,
    size: 10,
    font: fontBold,
    color: gray,
  });
  y -= lineHeight;
  
  // Date
  page.drawText(`Date: ${formatDate(quotation.created_at)}`, {
    x: margin,
    y,
    size: 10,
    font,
    color: gray,
  });
  y -= sectionGap;
  
  // === BLOC CLIENT ===
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
  
  if (quotation.client_name) {
    page.drawText(`Nom: ${quotation.client_name}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: black,
    });
    y -= lineHeight;
  }
  
  if (quotation.client_company) {
    page.drawText(`Société: ${quotation.client_company}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: black,
    });
    y -= lineHeight;
  }
  
  if (quotation.project_name) {
    page.drawText(`Projet: ${quotation.project_name}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: black,
    });
    y -= lineHeight;
  }
  y -= sectionGap / 2;
  
  // === ROUTE ===
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
    quotation.route_origin,
    quotation.route_port,
    quotation.route_destination,
  ].filter(Boolean);
  
  page.drawText(routeParts.join(' → '), {
    x: margin,
    y,
    size: 10,
    font,
    color: black,
  });
  y -= lineHeight;
  
  if (quotation.incoterm) {
    page.drawText(`Incoterm: ${quotation.incoterm}`, {
      x: margin,
      y,
      size: 10,
      font,
      color: black,
    });
    y -= lineHeight;
  }
  y -= sectionGap / 2;
  
  // === SERVICES ===
  page.drawLine({
    start: { x: margin, y: y + 10 },
    end: { x: width - margin, y: y + 10 },
    thickness: 0.5,
    color: gray,
  });
  y -= 5;
  
  page.drawText('SERVICES', {
    x: margin,
    y,
    size: 11,
    font: fontBold,
    color: primary,
  });
  y -= lineHeight + 5;
  
  // En-tête tableau
  const colService = margin;
  const colDesc = margin + 150;
  const colAmount = width - margin - 100;
  const colCurrency = width - margin - 40;
  
  page.drawText('Service', { x: colService, y, size: 9, font: fontBold, color: gray });
  page.drawText('Description', { x: colDesc, y, size: 9, font: fontBold, color: gray });
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
  
  // Lignes de services
  const tariffLines = quotation.tariff_lines || [];
  for (const line of tariffLines) {
    if (y < margin + 100) break; // Protection bas de page
    
    // Tronquer le service si trop long
    const serviceText = (line.service || '').substring(0, 25);
    const descText = (line.description || '').substring(0, 30);
    
    page.drawText(serviceText, { x: colService, y, size: 9, font, color: black });
    page.drawText(descText, { x: colDesc, y, size: 9, font, color: black });
    page.drawText(formatAmount(line.amount || 0), { x: colAmount, y, size: 9, font, color: black });
    page.drawText(line.currency || 'FCFA', { x: colCurrency, y, size: 9, font, color: black });
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
  
  const totalText = `TOTAL: ${formatAmount(quotation.total_amount || 0)} ${quotation.total_currency || 'FCFA'}`;
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
  
  const mention = getStatusMention(quotation.status);
  page.drawText(mention, {
    x: margin,
    y,
    size: 10,
    font: fontBold,
    color: quotation.status === 'draft' ? rgb(0.7, 0.3, 0.3) : gray,
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
  
  try {
    // Auth validation (JWT requis)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Unauthorized', 401);
    }
    
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );
    
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse('Unauthorized', 401);
    }
    
    // Parse body
    const { quotationId } = await req.json();
    if (!quotationId) {
      return errorResponse('quotationId is required', 400);
    }
    
    // Fetch quotation_history (données figées)
    const { data: quotation, error: fetchError } = await supabase
      .from('quotation_history')
      .select(`
        id,
        root_quotation_id,
        version,
        status,
        client_name,
        client_company,
        project_name,
        route_origin,
        route_port,
        route_destination,
        incoterm,
        tariff_lines,
        total_amount,
        total_currency,
        created_at
      `)
      .eq('id', quotationId)
      .single();
    
    if (fetchError || !quotation) {
      console.error('Fetch error:', fetchError);
      return errorResponse('Quotation not found', 404);
    }
    
    // Générer le PDF
    const pdfBytes = await generatePdf(quotation as QuotationData);
    
    // Calculer hash et taille
    const fileHash = await sha256(pdfBytes);
    const fileSize = pdfBytes.length;
    
    // Chemin storage (non-écrasant)
    const rootId = quotation.root_quotation_id || quotation.id;
    const version = quotation.version || 1;
    const timestamp = Date.now();
    const filePath = `Q-${rootId}/v${version}/quote-${quotation.id}-${timestamp}.pdf`;
    
    // Upload dans storage
    const { error: uploadError } = await supabase.storage
      .from('quotation-attachments')
      .upload(filePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: false,
      });
    
    if (uploadError) {
      console.error('Upload error:', uploadError);
      return errorResponse(`Storage upload failed: ${uploadError.message}`, 500);
    }
    
    // Insérer trace dans quotation_documents
    const { data: docRecord, error: insertError } = await supabase
      .from('quotation_documents')
      .insert({
        quotation_id: quotation.id,
        root_quotation_id: rootId,
        version,
        status: quotation.status || 'draft',
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
      return errorResponse('Failed to create signed URL', 500);
    }
    
    return jsonResponse({
      success: true,
      url: signedData.signedUrl,
      documentId: docRecord?.id,
      filePath,
      fileHash,
      fileSize,
    });
    
  } catch (error) {
    console.error('Generate PDF error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Internal error', 500);
  }
});
