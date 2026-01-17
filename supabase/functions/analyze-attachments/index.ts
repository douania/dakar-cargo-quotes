import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Priority keywords for relevant sheets (trucking, transport, pricing)
const PRIORITY_SHEET_KEYWORDS = ['transport', 'trucking', 'tarif', 'rate', 'price', 'dry', 'dg', 'oog', 'container', 'service'];
const MAX_TEXT_LENGTH = 15000; // Reduced to avoid timeout

// Parse Excel file using SheetJS and return optimized structured text
function parseExcelToText(arrayBuffer: ArrayBuffer): { text: string; sheets: Array<{ name: string; content: string; priority: boolean }> } {
  try {
    const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: 'array' });
    const sheets: Array<{ name: string; content: string; priority: boolean }> = [];
    
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      // Convert to CSV format for text analysis, skip blank rows
      const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
      
      // Skip nearly empty sheets
      const nonEmptyLines = csv.split('\n').filter(line => line.replace(/,/g, '').trim().length > 0);
      if (nonEmptyLines.length < 2) {
        console.log(`Skipping empty sheet: ${sheetName}`);
        continue;
      }
      
      // Check if this is a priority sheet
      const lowerName = sheetName.toLowerCase();
      const isPriority = PRIORITY_SHEET_KEYWORDS.some(kw => lowerName.includes(kw));
      
      sheets.push({ name: sheetName, content: nonEmptyLines.join('\n'), priority: isPriority });
    }
    
    // Sort by priority (priority sheets first)
    sheets.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));
    
    // Build text with length limit, prioritizing important sheets
    let fullText = '';
    for (const sheet of sheets) {
      const sheetContent = `=== ONGLET: ${sheet.name} ${sheet.priority ? '(PRIORITAIRE)' : ''} ===\n${sheet.content}\n\n`;
      
      if (fullText.length + sheetContent.length > MAX_TEXT_LENGTH) {
        // Add truncated version if we have room for at least the header
        const remainingSpace = MAX_TEXT_LENGTH - fullText.length;
        if (remainingSpace > 200) {
          fullText += sheetContent.substring(0, remainingSpace) + '\n... (tronqué)\n';
        }
        break;
      }
      fullText += sheetContent;
    }
    
    console.log(`Parsed Excel: ${sheets.length} sheets (${sheets.filter(s => s.priority).length} priority), ${fullText.length} chars`);
    return { text: fullText, sheets };
  } catch (e) {
    console.error('Excel parse error:', e);
    return { text: '', sheets: [] };
  }
}

// =============================================================================
// DOCUMENT TYPE DETECTION AND SPECIALIZED PROMPTS
// =============================================================================

type DocumentType = 'packing_list' | 'invoice' | 'bill_of_lading' | 'certificate' | 'tariff' | 'quotation' | 'generic';

interface DocumentTypeConfig {
  type: DocumentType;
  systemPrompt: string;
  knowledgeCategories: string[];
}

// Detect document type from filename and content preview
function detectDocumentType(filename: string, content: string): DocumentType {
  const lowerName = filename.toLowerCase();
  const lowerContent = content.toLowerCase().substring(0, 3000);
  
  // Packing list detection
  if (lowerName.includes('packing') || lowerName.includes('colisage') || lowerName.includes('liste_colisage')) {
    return 'packing_list';
  }
  if (lowerContent.includes('gross weight') || lowerContent.includes('net weight') ||
      lowerContent.includes('poids brut') || lowerContent.includes('poids net') ||
      (lowerContent.includes('dimensions') && lowerContent.includes('packages')) ||
      lowerContent.includes('nbr of packages') || lowerContent.includes('number of packages')) {
    return 'packing_list';
  }
  
  // Invoice detection
  if (lowerName.includes('invoice') || lowerName.includes('facture') || lowerName.includes('inv_')) {
    return 'invoice';
  }
  if (lowerContent.includes('invoice number') || lowerContent.includes('numéro facture') ||
      lowerContent.includes('total amount due') || lowerContent.includes('montant à payer') ||
      (lowerContent.includes('unit price') && lowerContent.includes('quantity'))) {
    return 'invoice';
  }
  
  // Bill of Lading detection
  if (lowerName.includes('bl') || lowerName.includes('lading') || lowerName.includes('connaissement')) {
    return 'bill_of_lading';
  }
  if (lowerContent.includes('bill of lading') || lowerContent.includes('shipper') ||
      lowerContent.includes('consignee') || lowerContent.includes('notify party') ||
      lowerContent.includes('port of loading') || lowerContent.includes('port of discharge')) {
    return 'bill_of_lading';
  }
  
  // Certificate detection
  if (lowerName.includes('certificat') || lowerName.includes('certificate') || 
      lowerName.includes('cert_') || lowerName.includes('origine')) {
    return 'certificate';
  }
  if (lowerContent.includes('certificate of origin') || lowerContent.includes('certificat d\'origine') ||
      lowerContent.includes('eur.1') || lowerContent.includes('form a')) {
    return 'certificate';
  }
  
  // Quotation detection
  if (lowerName.includes('cotation') || lowerName.includes('quote') || lowerName.includes('offre')) {
    return 'quotation';
  }
  if (lowerContent.includes('notre offre') || lowerContent.includes('our quotation') ||
      lowerContent.includes('prix unitaire') || lowerContent.includes('total ht')) {
    return 'quotation';
  }
  
  // Tariff detection
  if (lowerName.includes('tarif') || lowerName.includes('rate') || lowerName.includes('price')) {
    return 'tariff';
  }
  if (lowerContent.includes('trucking') || lowerContent.includes('transport rate') ||
      lowerContent.includes('freight rate') || lowerContent.includes('local charges')) {
    return 'tariff';
  }
  
  return 'generic';
}

// Specialized prompts for each document type
const DOCUMENT_PROMPTS: Record<DocumentType, DocumentTypeConfig> = {
  packing_list: {
    type: 'packing_list',
    systemPrompt: `Tu es un expert en extraction de données de packing lists / listes de colisage.

Extrais TOUTES les informations en JSON avec cette structure EXACTE:
{
  "document_type": "packing_list",
  "shipment_ref": "référence expédition",
  "items": [
    {
      "id": "identifiant unique (ligne 1, 2, 3...)",
      "description": "description complète",
      "quantity": 1,
      "gross_weight_kg": 0,
      "net_weight_kg": 0,
      "length_cm": 0,
      "width_cm": 0,
      "height_cm": 0,
      "volume_m3": 0,
      "package_type": "caisse/palette/nu",
      "marks": "marques"
    }
  ],
  "totals": {
    "packages": 0,
    "gross_weight_kg": 0,
    "net_weight_kg": 0,
    "volume_m3": 0
  },
  "shipper": "expéditeur",
  "consignee": "destinataire",
  "origin": "origine",
  "destination": "destination"
}

RÈGLES: Convertis dimensions en cm, poids en kg. Pour articles identiques: ID unique (1-A, 1-B...). JSON valide uniquement.`,
    knowledgeCategories: ['marchandise', 'route']
  },
  
  invoice: {
    type: 'invoice',
    systemPrompt: `Tu es un expert en extraction de factures commerciales.

Extrais en JSON:
{
  "document_type": "invoice",
  "invoice_number": "numéro",
  "invoice_date": "YYYY-MM-DD",
  "seller": { "name": "", "address": "", "country": "" },
  "buyer": { "name": "", "address": "", "country": "" },
  "items": [
    { "description": "", "quantity": 0, "unit_price": 0, "total": 0, "currency": "", "hs_code": "" }
  ],
  "subtotal": 0,
  "taxes": 0,
  "total": 0,
  "currency": "EUR/USD",
  "payment_terms": "",
  "incoterm": "FOB/CIF/DAP"
}

JSON valide uniquement.`,
    knowledgeCategories: ['fournisseur', 'tarif', 'marchandise']
  },
  
  bill_of_lading: {
    type: 'bill_of_lading',
    systemPrompt: `Tu es un expert en extraction de connaissements (Bill of Lading).

Extrais en JSON:
{
  "document_type": "bill_of_lading",
  "bl_number": "",
  "carrier": "",
  "vessel": "",
  "voyage": "",
  "shipper": { "name": "", "address": "" },
  "consignee": { "name": "", "address": "" },
  "notify_party": { "name": "", "address": "" },
  "port_of_loading": "",
  "port_of_discharge": "",
  "place_of_delivery": "",
  "containers": [
    { "number": "XXXX1234567", "type": "20'/40'", "seal": "", "weight_kg": 0 }
  ],
  "cargo_description": "",
  "gross_weight_kg": 0,
  "measurement_m3": 0,
  "freight_terms": "Prepaid/Collect",
  "date_of_issue": "YYYY-MM-DD"
}

JSON valide uniquement.`,
    knowledgeCategories: ['route', 'contact', 'marchandise']
  },
  
  certificate: {
    type: 'certificate',
    systemPrompt: `Tu es un expert en extraction de certificats (origine, qualité, conformité).

Extrais en JSON:
{
  "document_type": "certificate",
  "certificate_type": "origine/conformité/qualité",
  "certificate_number": "",
  "issue_date": "YYYY-MM-DD",
  "issuing_authority": "",
  "exporter": { "name": "", "country": "" },
  "importer": { "name": "", "country": "" },
  "goods_description": "",
  "origin_country": "",
  "hs_codes": []
}

JSON valide uniquement.`,
    knowledgeCategories: ['processus', 'marchandise']
  },
  
  quotation: {
    type: 'quotation',
    systemPrompt: `Tu es un expert en extraction de cotations/devis logistiques.

Extrais en JSON:
{
  "document_type": "quotation",
  "quotation_number": "",
  "quotation_date": "YYYY-MM-DD",
  "from_company": "",
  "to_company": "",
  "route": { "origin": "", "destination": "", "incoterm": "" },
  "cargo": { "description": "", "weight_kg": 0, "volume_m3": 0 },
  "cost_breakdown": [
    { "category": "", "description": "", "amount": 0, "currency": "" }
  ],
  "total": 0,
  "currency": ""
}

JSON valide uniquement.`,
    knowledgeCategories: ['tarif', 'template', 'processus']
  },
  
  tariff: {
    type: 'tariff',
    systemPrompt: `Tu es un expert en extraction de tarifs logistiques depuis Excel.
RÈGLES: Réponds UNIQUEMENT en JSON valide. Pour onglets Trucking/Transport: COLONNES = VILLES/DESTINATIONS.`,
    knowledgeCategories: ['tarif']
  },
  
  generic: {
    type: 'generic',
    systemPrompt: `Tu es un expert en extraction de données de documents logistiques.

Extrais en JSON:
{
  "document_type": "generic",
  "detected_content_type": "tarif/contact/processus/autre",
  "key_information": {
    "companies": [],
    "contacts": [],
    "locations": [],
    "amounts": []
  },
  "raw_text_summary": "résumé"
}

JSON valide uniquement.`,
    knowledgeCategories: ['contact', 'tarif', 'processus']
  }
};

function getPromptForDocumentType(docType: DocumentType): DocumentTypeConfig {
  return DOCUMENT_PROMPTS[docType] || DOCUMENT_PROMPTS.generic;
}

// =============================================================================
// TARIFF LINE EXTRACTION
// =============================================================================

interface TariffLine {
  service: string;
  description?: string;
  amount: number;
  currency: string;
  unit?: string;
  notes?: string;
  container_type?: string;
  sheet_name?: string;
  destination?: string;
  cargo_category?: string;
}

// Extract tariff lines from AI response
function extractTariffLines(aiResponse: any): TariffLine[] {
  const lines: TariffLine[] = [];
  
  // Extract transport_rates first (destination-based tariffs)
  if (aiResponse.transport_rates && Array.isArray(aiResponse.transport_rates)) {
    for (const rate of aiResponse.transport_rates) {
      if (rate.destination && (typeof rate.amount === 'number' || rate.amount > 0)) {
        lines.push({
          service: `Transport ${rate.destination}`,
          description: rate.notes || `Transport vers ${rate.destination}`,
          amount: rate.amount || 0,
          currency: normalizeCurrency(rate.currency || 'XOF'),
          container_type: rate.container_type,
          sheet_name: rate.sheet_name || 'Transport',
          destination: rate.destination,
          cargo_category: rate.cargo_category || 'Dry',
        });
      }
    }
  }
  
  if (aiResponse.tariff_lines && Array.isArray(aiResponse.tariff_lines)) {
    for (const line of aiResponse.tariff_lines) {
      if (line.service && (typeof line.amount === 'number' || typeof line.amount_xof === 'number')) {
        lines.push({
          service: line.service,
          description: line.description,
          amount: line.amount || line.amount_xof || 0,
          currency: normalizeCurrency(line.currency || 'XOF'),
          unit: line.unit,
          container_type: line.container_type || line.container,
          sheet_name: line.sheet_name,
          destination: line.destination,
          cargo_category: line.cargo_category,
        });
      }
    }
  }
  
  // Also handle sheets structure for Excel
  if (aiResponse.sheets && Array.isArray(aiResponse.sheets)) {
    for (const sheet of aiResponse.sheets) {
      if (sheet.tariffs && Array.isArray(sheet.tariffs)) {
        for (const tariff of sheet.tariffs) {
          // Handle rates array structure (multi-container)
          if (tariff.rates && Array.isArray(tariff.rates)) {
            for (const rate of tariff.rates) {
              lines.push({
                service: tariff.service,
                description: tariff.category || sheet.name,
                amount: rate.amount_xof || rate.amount || 0,
                currency: 'XOF',
                unit: rate.container || tariff.unit,
                container_type: rate.container,
                sheet_name: sheet.name,
                destination: tariff.destination,
                cargo_category: sheet.cargo_type,
              });
            }
          } else {
            // Simple tariff structure
            lines.push({
              service: tariff.service,
              description: tariff.description || sheet.name,
              amount: tariff.amount || tariff.amount_xof || 0,
              currency: normalizeCurrency(tariff.currency || 'XOF'),
              unit: tariff.unit,
              container_type: tariff.container_type,
              sheet_name: sheet.name,
              destination: tariff.destination,
              cargo_category: sheet.cargo_type,
            });
          }
        }
      }
    }
  }
  
  return lines;
}

function normalizeCurrency(currency: string): string {
  const upper = (currency || 'FCFA').toUpperCase().trim();
  if (['XOF', 'CFA', 'F CFA', 'FCFA'].includes(upper)) return 'FCFA';
  if (['EUR', 'EURO', '€'].includes(upper)) return 'EUR';
  if (['USD', 'US$', '$'].includes(upper)) return 'USD';
  return upper || 'FCFA';
}

function detectCargoType(text: string): string {
  const textLower = text.toLowerCase();
  
  if (textLower.includes('dg') || textLower.includes('dangerous')) return 'container_dg';
  if (textLower.includes('oog') || textLower.includes('out-of-gauge') || textLower.includes('special')) return 'container_special';
  if (textLower.includes('breakbulk') || textLower.includes('break bulk')) return 'breakbulk';
  if (textLower.includes('container') || textLower.includes('conteneur') || textLower.includes('dry')) return 'container_dry';
  if (textLower.includes('project') || textLower.includes('projet')) return 'project';
  if (textLower.includes('flat') || textLower.includes('40fr')) return 'container_flat';
  
  return 'container'; // Default
}

function detectCargoTypeFromSheet(sheetName: string): string {
  const name = sheetName.toLowerCase();
  if (name.includes('dry')) return 'container_dry';
  if (name.includes('dg')) return 'container_dg';
  if (name.includes('oog')) return 'container_oog';
  if (name.includes('ig') || name.includes('special')) return 'container_special';
  if (name.includes('transport')) return 'transport';
  if (name.includes('service')) return 'services';
  return 'container';
}

// Store packing list data as learned knowledge (marchandise category)
async function storePackingListKnowledge(
  supabase: any, 
  attachment: any, 
  extractedData: any
): Promise<void> {
  if (extractedData?.document_type !== 'packing_list') {
    console.log(`[Knowledge] Skipping - not a packing list: ${extractedData?.document_type}`);
    return;
  }
  
  const items = extractedData.items || [];
  const totals = extractedData.totals;
  
  if (items.length === 0) {
    console.log(`[Knowledge] Skipping - no items in packing list`);
    return;
  }
  
  // Filter main heavy items (>5 tonnes)
  const mainItems = items
    .filter((i: any) => (i.gross_weight_kg || 0) > 5000)
    .map((i: any) => ({
      id: i.id,
      description: i.description,
      weight_kg: i.gross_weight_kg,
      dimensions_cm: { 
        l: i.length_cm, 
        w: i.width_cm, 
        h: i.height_cm 
      },
      volume_m3: i.volume_m3
    }));
  
  const shipmentRef = extractedData.shipment_ref || extractedData.po_number || attachment.filename;
  const totalWeight = totals?.gross_weight_kg || items.reduce((sum: number, i: any) => sum + (i.gross_weight_kg || 0), 0);
  const totalVolume = totals?.volume_m3 || items.reduce((sum: number, i: any) => sum + (i.volume_m3 || 0), 0);
  
  const knowledgeEntry = {
    category: 'marchandise',
    name: `Packing List: ${shipmentRef}`,
    description: `${items.length} colis, ${Math.round(totalWeight).toLocaleString()} kg brut, ${totalVolume.toFixed(1)} m³. ${mainItems.length > 0 ? `Inclut ${mainItems.length} pièce(s) lourde(s) >5t.` : ''} Origine: ${extractedData.origin || 'N/A'}, Destination: ${extractedData.destination || 'N/A'}`,
    data: {
      type: 'packing_list_summary',
      shipment_ref: shipmentRef,
      items_count: items.length,
      main_items: mainItems,
      all_items: items.slice(0, 50), // Limit to 50 items to avoid huge payloads
      totals: {
        packages: totals?.packages || items.length,
        gross_weight_kg: totalWeight,
        net_weight_kg: totals?.net_weight_kg,
        volume_m3: totalVolume
      },
      origin: extractedData.origin,
      destination: extractedData.destination,
      consignee: extractedData.consignee,
      shipper: extractedData.shipper,
      source_attachment_id: attachment.id,
      source_filename: attachment.filename
    },
    source_type: 'attachment',
    source_id: attachment.id,
    confidence: 0.95,
    is_validated: false,
    matching_criteria: {
      cargo_type: mainItems.length > 0 ? 'heavy_lift' : 'general',
      max_piece_weight_kg: mainItems.length > 0 ? Math.max(...mainItems.map((i: any) => i.weight_kg || 0)) : null,
      keywords: ['transformateur', 'transformer', 'breakbulk', 'heavy', 'packing', 'colisage']
    }
  };
  
  const { error } = await supabase.from('learned_knowledge').insert(knowledgeEntry);
  
  if (error) {
    console.error(`[Knowledge] Error storing packing list knowledge:`, error);
  } else {
    console.log(`[Knowledge] Stored packing list as marchandise: ${items.length} items, ${mainItems.length} heavy pieces`);
  }
}

// Background analysis function
async function analyzeAttachmentInBackground(
  supabase: any, 
  attachment: any, 
  lovableApiKey: string
): Promise<{ success: boolean; filename: string; error?: string }> {
  try {
    console.log(`[BG] Starting analysis: ${attachment.filename}`);
    
    const isExcel = attachment.content_type?.includes('spreadsheet') || 
                    attachment.content_type?.includes('excel') ||
                    attachment.content_type?.includes('openxmlformats-officedocument') ||
                    attachment.filename?.toLowerCase().endsWith('.xlsx') ||
                    attachment.filename?.toLowerCase().endsWith('.xls');
    
    const isImage = attachment.content_type?.startsWith('image/');
    const isPdf = attachment.content_type === 'application/pdf';
    
    if (!isImage && !isPdf && !isExcel) {
      await supabase.from('email_attachments').update({ 
        is_analyzed: true,
        extracted_data: { type: 'unsupported', content_type: attachment.content_type }
      }).eq('id', attachment.id);
      return { success: true, filename: attachment.filename };
    }
    
    // Download the file
    const { data: fileData, error: downloadError } = await supabase
      .storage.from('documents').download(attachment.storage_path);
    
    if (downloadError || !fileData) {
      console.error(`[BG] Download failed: ${attachment.filename}`, downloadError);
      await supabase.from('email_attachments').update({ 
        is_analyzed: true,
        extracted_data: { type: 'error', message: 'Download failed' }
      }).eq('id', attachment.id);
      return { success: false, filename: attachment.filename, error: 'Download failed' };
    }
    
    const arrayBuffer = await fileData.arrayBuffer();
    let extractedData: any = null;
    let extractedText = '';
    
    if (isExcel) {
      const { text: excelText, sheets } = parseExcelToText(arrayBuffer);
      
      if (!excelText || excelText.length < 50) {
        await supabase.from('email_attachments').update({ 
          is_analyzed: true,
          extracted_data: { type: 'error', message: 'Empty Excel file' }
        }).eq('id', attachment.id);
        return { success: false, filename: attachment.filename, error: 'Empty file' };
      }
      
      // DETECT DOCUMENT TYPE from filename and content
      const docType = detectDocumentType(attachment.filename, excelText);
      const promptConfig = getPromptForDocumentType(docType);
      
      console.log(`[BG] Detected document type: ${docType} for ${attachment.filename}`);
      console.log(`[BG] Sending ${excelText.length} chars to AI with ${docType} prompt...`);
      
      // Build the appropriate prompt based on document type
      let systemPrompt = promptConfig.systemPrompt;
      let userPrompt = '';
      
      if (docType === 'tariff') {
        // Special handling for tariff Excel files (existing logic)
        const hasTruckingTab = sheets.some(s => 
          s.name.toLowerCase().includes('trucking') || 
          s.name.toLowerCase().includes('transport') ||
          s.name.toLowerCase().includes('other city')
        );
        
        userPrompt = hasTruckingTab 
          ? `Analyse ce fichier Excel de tarifs transport.

STRUCTURE JSON ATTENDUE:
{
  "document_type": "transport_tariffs",
  "transport_rates": [
    {
      "destination": "NOM_VILLE",
      "container_type": "20' Dry" ou "40' Dry" ou "40' HC",
      "amount": MONTANT_NUMERIQUE,
      "currency": "XOF",
      "cargo_category": "Dry" ou "DG" ou "OOG",
      "sheet_name": "NOM_ONGLET"
    }
  ],
  "tariff_lines": [...autres tarifs fixes...],
  "summary": { "total_destinations": N, "total_rates": N }
}

INSTRUCTIONS CRITIQUES pour les onglets Trucking/Transport:
- La PREMIÈRE ligne contient souvent les NOMS DE VILLES en colonnes
- La PREMIÈRE colonne contient les TYPES DE CONTENEURS
- CHAQUE CELLULE avec un montant = un tarif de transport vers cette destination
- Les montants sont généralement en FCFA/XOF (6 chiffres: 850000, 1200000, etc.)

Contenu du fichier:
${excelText}`
          : `Analyse ce fichier Excel et extrais les tarifs.

STRUCTURE JSON ATTENDUE:
{
  "document_type": "quotation_excel",
  "tariff_lines": [
    {"service": "nom", "amount": montant, "currency": "XOF", "unit": "unité", "container_type": "type"}
  ],
  "transport_rates": [...si présent...],
  "summary": { "total_lines": N }
}

Contenu:
${excelText}`;
      } else {
        // Use specialized prompt for other document types
        userPrompt = `Analyse ce fichier (${attachment.filename}):\n\n${excelText}`;
      }

      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        }),
      });
      
      if (!aiResponse.ok) {
        console.error(`[BG] AI error: ${aiResponse.status}`);
        await supabase.from('email_attachments').update({ 
          is_analyzed: true,
          extracted_data: { type: 'error', message: `AI error: ${aiResponse.status}` }
        }).eq('id', attachment.id);
        return { success: false, filename: attachment.filename, error: `AI error: ${aiResponse.status}` };
      }
      
      const aiData = await aiResponse.json();
      const content = aiData.choices?.[0]?.message?.content || '';
      
      console.log(`[BG] AI response received (${content.length} chars)`);
      
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          extractedData = JSON.parse(jsonMatch[0]);
          extractedText = `Excel analysé: ${sheets.length} onglets`;
        } else {
          extractedData = { type: 'quotation_excel', raw_response: content };
          extractedText = content.substring(0, 500);
        }
      } catch (e) {
        extractedData = { type: 'quotation_excel', raw_response: content };
        extractedText = content.substring(0, 500);
      }
    } else {
      // Handle images/PDFs with existing logic
      const uint8Array = new Uint8Array(arrayBuffer);
      const CHUNK_SIZE = 8192;
      let base64 = '';
      for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
        const chunk = uint8Array.slice(i, i + CHUNK_SIZE);
        base64 += String.fromCharCode.apply(null, Array.from(chunk));
      }
      base64 = btoa(base64);
      
      const mimeType = attachment.content_type || 'image/jpeg';
      
      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash-lite',
          messages: [
            { role: 'system', content: 'Analyse ce document et extrais les tarifs en JSON: {type, tariff_lines: [{service, amount, currency}]}' },
            { role: 'user', content: [
              { type: 'text', text: `Analyse: ${attachment.filename}` },
              { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
            ]}
          ]
        }),
      });
      
      if (aiResponse.ok) {
        const aiData = await aiResponse.json();
        const content = aiData.choices?.[0]?.message?.content || '';
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) extractedData = JSON.parse(jsonMatch[0]);
          else extractedData = { raw_response: content };
        } catch { extractedData = { raw_response: content }; }
        extractedText = extractedData.text_content || '';
      }
    }
    
    // Store tariff lines if found
    const tariffLines = extractTariffLines(extractedData);
    if (tariffLines.length > 0 && attachment.email_id) {
      const { data: emailData } = await supabase
        .from('emails')
        .select('subject')
        .eq('id', attachment.email_id)
        .single();
      
      const subject = emailData?.subject || '';
      const routeMatch = subject.match(/(?:DAP|DDP|CIF|CFR)\s+([A-Za-z\s-]+)/i);
      const destination = routeMatch ? routeMatch[1].trim() : 'Dakar';
      
      await supabase.from('quotation_history').insert({
        route_port: 'Dakar',
        route_destination: destination,
        cargo_type: detectCargoType(subject),
        tariff_lines: tariffLines,
        total_amount: tariffLines.reduce((sum, l) => sum + l.amount, 0),
        total_currency: 'FCFA',
        source_email_id: attachment.email_id,
        source_attachment_id: attachment.id,
      });
      console.log(`[BG] Stored ${tariffLines.length} tariff lines`);
    }
    
    // Update attachment
    await supabase.from('email_attachments').update({
      is_analyzed: true,
      extracted_text: extractedText?.substring(0, 5000) || '',
      extracted_data: extractedData
    }).eq('id', attachment.id);
    
    // Store packing list data as learned knowledge (marchandise category)
    if (extractedData?.document_type === 'packing_list') {
      await storePackingListKnowledge(supabase, attachment, extractedData);
    }
    
    console.log(`[BG] ✓ Analysis complete: ${attachment.filename}`);
    return { success: true, filename: attachment.filename };
    
  } catch (error) {
    console.error(`[BG] Error: ${attachment.filename}`, error);
    return { success: false, filename: attachment.filename, error: String(error) };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { attachmentId, background = true, bulk = false, emailIds = [] } = await req.json();
    
    console.log(`Request params: attachmentId=${attachmentId}, background=${background}, bulk=${bulk}, emailIds=${emailIds?.length || 0}`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Temporary file and signature patterns to skip
    const isTemporaryOrSignatureFile = (filename: string, contentType: string, size?: number): boolean => {
      const patterns = [
        /^~\$/,           // Word temp files
        /^~WRD/i,         // Word recovery
        /^~WRL/i,         // Word lock
        /\.tmp$/i,        // Temp files
        /^Thumbs\.db$/i,  // Windows thumbnails
        /^\.DS_Store$/,   // Mac files
        /^~\$[^.]+\.docx?$/i,  // Word lock files
        /^image00\d+\.(jpg|png|gif)$/i, // Outlook inline images
        /^cid:/i,         // Content-ID references
      ];
      
      // Skip small images (likely signatures) < 50KB
      if (contentType?.startsWith('image/') && size && size < 50000) {
        return true;
      }
      
      return patterns.some(pattern => pattern.test(filename));
    };
    
    // Fetch attachment(s) to analyze
    let query = supabase
      .from('email_attachments')
      .select('id, filename, content_type, storage_path, email_id, size');
    
    if (attachmentId) {
      query = query.eq('id', attachmentId);
    } else if (bulk && emailIds && emailIds.length > 0) {
      // Mode bulk après import : cibler les emails spécifiques
      console.log(`Bulk mode: targeting ${emailIds.length} specific emails`);
      query = query.in('email_id', emailIds).eq('is_analyzed', false);
    } else if (bulk) {
      // Mode bulk général : prioriser les fichiers récents
      console.log('Bulk mode: targeting recent unanalyzed files');
      query = query.eq('is_analyzed', false).order('created_at', { ascending: false }).limit(50);
    } else {
      // Mode par défaut : 10 fichiers
      query = query.eq('is_analyzed', false).limit(10);
    }
    
    const { data: rawAttachments, error: fetchError } = await query;
    
    if (fetchError) {
      throw new Error(`Failed to fetch attachments: ${fetchError.message}`);
    }
    
    // Filter out temporary files and mark them as skipped
    const attachments = [];
    const skippedFiles = [];
    
    for (const att of (rawAttachments || [])) {
      if (isTemporaryOrSignatureFile(att.filename, att.content_type, att.size)) {
        skippedFiles.push(att);
        // Mark as analyzed with skip reason
        await supabase.from('email_attachments').update({
          is_analyzed: true,
          extracted_data: { 
            type: 'skipped', 
            reason: 'Fichier temporaire', 
            message: 'Fichier Word/Outlook temporaire ignoré automatiquement' 
          }
        }).eq('id', att.id);
      } else {
        attachments.push(att);
      }
    }
    
    if (skippedFiles.length > 0) {
      console.log(`Skipped ${skippedFiles.length} temporary file(s): ${skippedFiles.map(f => f.filename).join(', ')}`);
    }
    
    if (!attachments || attachments.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: skippedFiles.length > 0 
            ? `${skippedFiles.length} fichier(s) temporaire(s) ignoré(s), aucun à analyser` 
            : 'No attachments to analyze', 
          analyzed: 0,
          skipped: skippedFiles.length 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Analyzing ${attachments.length} attachment(s) (background: ${background})...`);
    
    // Use background processing for Excel files to avoid timeout
    if (background) {
      const excelAttachments = attachments.filter(a => 
        a.content_type?.includes('spreadsheet') || 
        a.content_type?.includes('excel') ||
        a.filename?.toLowerCase().endsWith('.xlsx')
      );
      
      if (excelAttachments.length > 0) {
        // Start background analysis and return immediately
        const backgroundPromise = Promise.all(
          excelAttachments.map(att => analyzeAttachmentInBackground(supabase, att, lovableApiKey))
        );
        
        // Use EdgeRuntime.waitUntil to continue processing after response
        (globalThis as any).EdgeRuntime?.waitUntil?.(backgroundPromise);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            status: 'processing',
            message: `${excelAttachments.length} fichier(s) Excel en cours d'analyse en arrière-plan. Rafraîchissez dans quelques secondes.`,
            attachments: excelAttachments.map(a => ({ id: a.id, filename: a.filename }))
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }
    
    // For non-Excel or non-background: process synchronously
    const results = [];
    
    for (const attachment of attachments) {
      try {
        console.log(`Analyzing: ${attachment.filename} (${attachment.content_type})`);
        
        const isImage = attachment.content_type?.startsWith('image/');
        const isPdf = attachment.content_type === 'application/pdf';
        const isExcel = attachment.content_type?.includes('spreadsheet') || 
                        attachment.content_type?.includes('excel') ||
                        attachment.content_type?.includes('openxmlformats-officedocument') ||
                        attachment.filename?.toLowerCase().endsWith('.xlsx') ||
                        attachment.filename?.toLowerCase().endsWith('.xls');
        
        // Skip unsupported files
        if (!isImage && !isPdf && !isExcel) {
          console.log(`Skipping unsupported file: ${attachment.content_type}`);
          await supabase
            .from('email_attachments')
            .update({ 
              is_analyzed: true,
              extracted_text: null,
              extracted_data: { type: 'unsupported', content_type: attachment.content_type }
            })
            .eq('id', attachment.id);
          continue;
        }
        
        // Check if storage_path exists (file may not have been uploaded due to timeout)
        if (!attachment.storage_path) {
          console.error(`Missing storage_path for ${attachment.filename} - file was not uploaded to storage`);
          await supabase
            .from('email_attachments')
            .update({ 
              is_analyzed: true,
              extracted_text: null,
              extracted_data: { 
                type: 'error', 
                message: 'File not uploaded to storage (storage_path is null)', 
                requires_reimport: true,
                email_id: attachment.email_id
              }
            })
            .eq('id', attachment.id);
          results.push({
            id: attachment.id,
            filename: attachment.filename,
            success: false,
            error: 'Missing storage_path - requires reimport from email'
          });
          continue;
        }
        
        // Download the file from storage
        const { data: fileData, error: downloadError } = await supabase
          .storage
          .from('documents')
          .download(attachment.storage_path);
        
        if (downloadError || !fileData) {
          console.error(`Failed to download ${attachment.filename}:`, downloadError);
          await supabase
            .from('email_attachments')
            .update({ 
              is_analyzed: true,
              extracted_text: null,
              extracted_data: { type: 'error', message: 'Download failed', error: downloadError?.message }
            })
            .eq('id', attachment.id);
          continue;
        }
        
        let extractedData: any = null;
        let extractedText = '';
        
        // Convert to ArrayBuffer and base64
        const arrayBuffer = await fileData.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Check if file is too small (likely corrupted)
        if (uint8Array.length < 100) {
          console.error(`File too small (${uint8Array.length} bytes): ${attachment.filename}`);
          await supabase
            .from('email_attachments')
            .update({ 
              is_analyzed: true,
              extracted_text: null,
              extracted_data: { type: 'error', message: 'File too small or corrupted', size: uint8Array.length }
            })
            .eq('id', attachment.id);
          continue;
        }
        
        // Convert to base64 in chunks
        const CHUNK_SIZE = 8192;
        let base64 = '';
        for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
          const chunk = uint8Array.slice(i, i + CHUNK_SIZE);
          base64 += String.fromCharCode.apply(null, Array.from(chunk));
        }
        base64 = btoa(base64);
        
        console.log(`File converted to base64: ${attachment.filename} (${uint8Array.length} bytes)`);
        
        // Handle Excel files - use document type detection (unified with background mode)
        if (isExcel) {
          console.log(`Parsing Excel ${attachment.filename} with SheetJS...`);
          
          // Parse Excel using SheetJS first
          const { text: excelText, sheets: excelSheets } = parseExcelToText(arrayBuffer);
          
          if (!excelText || excelText.length < 50) {
            console.error(`Failed to parse Excel or empty file: ${attachment.filename}`);
            await supabase
              .from('email_attachments')
              .update({ 
                is_analyzed: true,
                extracted_text: 'Fichier Excel vide ou non lisible',
                extracted_data: { type: 'error', message: 'Excel parsing failed or empty file' }
              })
              .eq('id', attachment.id);
            continue;
          }
          
          // DETECT DOCUMENT TYPE - same logic as background mode
          const docType = detectDocumentType(attachment.filename, excelText);
          const promptConfig = DOCUMENT_PROMPTS[docType];
          
          console.log(`Detected document type: ${docType} for ${attachment.filename}`);
          console.log(`Excel parsed: ${excelSheets.length} sheets, ${excelText.length} chars. Sending to AI with ${docType} prompt...`);
          
          // Build the appropriate prompt based on document type
          let systemPrompt = promptConfig.systemPrompt;
          let userPrompt = '';
          
          if (docType === 'tariff') {
            // Special handling for tariff Excel files - check for transport tabs
            const hasTruckingTab = excelSheets.some(s => 
              s.name.toLowerCase().includes('trucking') || 
              s.name.toLowerCase().includes('transport') ||
              s.name.toLowerCase().includes('camionnage')
            );
            
            if (hasTruckingTab) {
              userPrompt = `Analyse ce fichier Excel de tarifs transport.
PRIORITÉ: Extrais les tarifs de transport terrestre par destination.
Les onglets Transport/Trucking contiennent les prix par ville de destination.

Voici le contenu COMPLET du fichier Excel parsé (tous les onglets):

${excelText.substring(0, 50000)}`;
            } else {
              userPrompt = `Analyse ce fichier Excel et extrais les tarifs.

Voici le contenu COMPLET du fichier Excel parsé (tous les onglets):

${excelText.substring(0, 50000)}`;
            }
          } else {
            // Use specialized prompt for packing_list, invoice, etc.
            userPrompt = `Analyse ce fichier Excel (${attachment.filename}):

${excelText.substring(0, 50000)}`;
          }
          
          // Send parsed text to AI with appropriate prompt
          const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${lovableApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
              ]
            }),
          });
          
          if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            console.error(`AI analysis failed for Excel:`, aiResponse.status, errorText);
            
            if (aiResponse.status === 402) {
              return new Response(
                JSON.stringify({ success: false, error: 'Crédits AI insuffisants.' }),
                { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            if (aiResponse.status === 429) {
              return new Response(
                JSON.stringify({ success: false, error: 'Limite de requêtes atteinte, réessayez plus tard.' }),
                { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            
            // Mark as analyzed with error
            await supabase
              .from('email_attachments')
              .update({ 
                is_analyzed: true,
                extracted_text: null,
                extracted_data: { type: 'error', message: 'AI analysis failed', status: aiResponse.status }
              })
              .eq('id', attachment.id);
            continue;
          }
          
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || '';
          
          console.log(`AI response for Excel (first 800 chars):`, content.substring(0, 800));
          
          // Parse AI response
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              extractedData = JSON.parse(jsonMatch[0]);
              extractedText = `Excel analysé: ${extractedData.sheetNames?.join(', ') || 'onglets détectés'}`;
            } else {
              extractedData = { type: 'quotation_excel', raw_response: content };
              extractedText = content.substring(0, 1000);
            }
          } catch (parseError) {
            console.error('Failed to parse AI JSON response:', parseError);
            extractedData = { type: 'quotation_excel', raw_response: content };
            extractedText = content.substring(0, 1000);
          }
          
        } else {
          // Handle images and PDFs
          const mimeType = attachment.content_type || 'image/jpeg';
          
          const systemPrompt = `Tu es un assistant expert en analyse de documents commerciaux et logistiques. 
Analyse l'image/document fourni et extrais toutes les informations pertinentes.
Pour les cotations et tarifs: identifie les lignes de services avec montants, devises, unités.
Pour les documents: identifie le type, les données clés.
Réponds en JSON avec cette structure:
{
  "type": "quotation|invoice|document|signature|logo|unknown",
  "description": "description brève",
  "tariff_lines": [
    { "service": "nom du service", "amount": 1234, "currency": "FCFA", "unit": "EVP" }
  ],
  "extracted_info": { /* autres informations */ },
  "text_content": "tout texte visible",
  "confidence": 0.0-1.0
}`;

          console.log(`Sending ${attachment.filename} to AI for analysis...`);
          
          const userContent = [
            { type: 'text', text: `Analyse ce document (${attachment.filename}) et extrais les tarifs et informations.` },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
          ];
          
          const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${lovableApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-flash',
              messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
              ]
            }),
          });
          
          if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            console.error(`AI analysis failed for ${attachment.filename}:`, aiResponse.status, errorText);
            
            if (aiResponse.status === 402) {
              return new Response(
                JSON.stringify({ success: false, error: 'Crédits AI insuffisants.' }),
                { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            if (aiResponse.status === 429) {
              return new Response(
                JSON.stringify({ success: false, error: 'Limite de requêtes atteinte, réessayez plus tard.' }),
                { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
              );
            }
            continue;
          }
          
          const aiData = await aiResponse.json();
          const content = aiData.choices?.[0]?.message?.content || '';
          
          console.log(`AI response for ${attachment.filename}:`, content.substring(0, 300));
          
          extractedData = { raw_response: content };
          
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              extractedData = JSON.parse(jsonMatch[0]);
              extractedText = extractedData.text_content || extractedData.description || '';
            }
          } catch (parseError) {
            console.log('Could not parse JSON, using raw response');
            extractedText = content;
          }
        }
        
        // Extract tariff lines and store in quotation_history
        const tariffLines = extractTariffLines(extractedData);
        
        console.log(`Extracted ${tariffLines.length} tariff lines from ${attachment.filename}`);
        
        if (tariffLines.length > 0 && attachment.email_id) {
          console.log(`Storing ${tariffLines.length} tariff lines in quotation_history...`);
          
          // Get email info for route detection
          const { data: emailData } = await supabase
            .from('emails')
            .select('subject, from_address, extracted_data')
            .eq('id', attachment.email_id)
            .single();
          
          if (emailData) {
            const subject = emailData.subject || '';
            const routeMatch = subject.match(/(?:DAP|DDP|CIF|CFR)\s+([A-Za-z\s-]+)/i);
            const destination = routeMatch ? routeMatch[1].trim() : 
                               (extractedData.metadata?.route?.split('->')[1]?.trim() || 'Dakar');
            
            // Get unique cargo types from sheet names or tariff lines
            const cargoTypes = new Set<string>();
            if (extractedData.sheets && Array.isArray(extractedData.sheets)) {
              for (const sheet of extractedData.sheets) {
                const cargoType = sheet.cargo_type || detectCargoTypeFromSheet(sheet.name);
                cargoTypes.add(cargoType);
              }
            }
            if (cargoTypes.size === 0) {
              cargoTypes.add(detectCargoType(subject + ' ' + attachment.filename));
            }
            
            // Store one quotation_history entry per cargo type
            for (const cargoType of cargoTypes) {
              const relevantLines = extractedData.sheets 
                ? tariffLines.filter(l => {
                    if (!l.sheet_name) return true;
                    const sheetCargoType = detectCargoTypeFromSheet(l.sheet_name);
                    return sheetCargoType === cargoType;
                  })
                : tariffLines;
              
              if (relevantLines.length === 0) continue;
              
              const totalFcfa = relevantLines
                .filter(l => l.currency === 'FCFA')
                .reduce((sum, l) => sum + l.amount, 0);
              
              const { error: historyError } = await supabase
                .from('quotation_history')
                .insert({
                  route_port: 'Dakar',
                  route_destination: destination,
                  cargo_type: cargoType,
                  client_company: extractedData.metadata?.client,
                  partner_company: extractedData.metadata?.partner,
                  incoterm: extractedData.metadata?.incoterm,
                  tariff_lines: relevantLines,
                  total_amount: totalFcfa || extractedData.total?.amount,
                  total_currency: 'FCFA',
                  source_email_id: attachment.email_id,
                  source_attachment_id: attachment.id,
                });
              
              if (historyError) {
                console.error('Error storing quotation history:', historyError);
              } else {
                console.log(`Quotation history stored: ${cargoType} - ${relevantLines.length} lines`);
            }
          }
          
          // Extract and store local transport rates
          if (extractedData.transport_destinations && Array.isArray(extractedData.transport_destinations)) {
            console.log(`Found ${extractedData.transport_destinations.length} transport destinations to store`);
            
            for (const dest of extractedData.transport_destinations) {
              if (!dest.name || !dest.rates) continue;
              
              // Insert transport rates for each container type
              for (const [rateKey, rateAmount] of Object.entries(dest.rates)) {
                if (typeof rateAmount !== 'number' || rateAmount <= 0) continue;
                
                // Parse rate key like "20_dry", "40_dg", etc.
                const containerMatch = rateKey.match(/^(\d+)(?:')?(?:_)?(.*)$/);
                let containerType = '20DV';
                let cargoCategory = 'Dry';
                
                if (containerMatch) {
                  const size = containerMatch[1];
                  const suffix = containerMatch[2]?.toLowerCase() || 'dry';
                  
                  containerType = size === '40' ? '40DV' : '20DV';
                  if (suffix.includes('hc') || suffix.includes('high')) containerType = '40HC';
                  if (suffix.includes('fr') || suffix.includes('flat')) containerType = '40FR';
                  if (suffix.includes('ot') || suffix.includes('open')) containerType = size + 'OT';
                  
                  if (suffix.includes('dg')) cargoCategory = 'DG';
                  else if (suffix.includes('oog') || suffix.includes('special')) cargoCategory = 'Special';
                  else if (suffix.includes('reefer') || suffix.includes('rf')) cargoCategory = 'Reefer';
                  else cargoCategory = 'Dry';
                }
                
                const { error: transportError } = await supabase
                  .from('local_transport_rates')
                  .insert({
                    origin: 'Dakar Port',
                    destination: dest.name,
                    container_type: containerType,
                    cargo_category: cargoCategory,
                    rate_amount: rateAmount,
                    rate_currency: 'XOF',
                    source_document: `Excel: ${attachment.filename}`,
                    provider: extractedData.metadata?.partner || 'Unknown',
                    notes: dest.distance_km ? `Distance: ${dest.distance_km} km` : null,
                  });
                
                if (transportError) {
                  console.error(`Error storing transport rate for ${dest.name}:`, transportError);
                } else {
                  console.log(`Transport rate stored: ${dest.name} ${containerType} ${cargoCategory} = ${rateAmount} FCFA`);
                }
              }
            }
          }
        }
        }
        
        // Update the attachment record
        const { error: updateError } = await supabase
          .from('email_attachments')
          .update({
            is_analyzed: true,
            extracted_text: extractedText?.substring(0, 10000) || '', // Limit text length
            extracted_data: extractedData
          })
          .eq('id', attachment.id);
        
        if (updateError) {
          console.error(`Failed to update attachment ${attachment.id}:`, updateError);
        } else {
          console.log(`Successfully analyzed: ${attachment.filename}`);
          
          // Store packing list data as learned knowledge (marchandise category)
          if (extractedData?.document_type === 'packing_list') {
            await storePackingListKnowledge(supabase, attachment, extractedData);
          }
          
          results.push({
            id: attachment.id,
            filename: attachment.filename,
            type: extractedData?.type || extractedData?.document_type || 'unknown',
            sheetsFound: extractedData?.sheetNames?.length || 0,
            linesExtracted: tariffLines.length,
            success: true
          });
        }
        
      } catch (attachmentError) {
        console.error(`Error processing ${attachment.filename}:`, attachmentError);
        results.push({
          id: attachment.id,
          filename: attachment.filename,
          success: false,
          error: attachmentError instanceof Error ? attachmentError.message : 'Unknown error'
        });
      }
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        analyzed: results.filter(r => r.success).length,
        total: attachments.length,
        results 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } catch (error) {
    console.error('Error in analyze-attachments:', error);
    return new Response(
      JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});