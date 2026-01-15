import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface QuotationLine {
  category: string;
  service: string;
  unit: string;
  rate: number;
  quantity: number;
  amount: number;
  source: string;
  notes?: string;
}

interface CGVClause {
  code: string;
  title: string;
  content: string;
  isWarning: boolean;
}

interface ExclusionItem {
  service: string;
  rate: string;
  notes?: string;
}

interface QuotationRequest {
  reference?: string;
  client: string;
  destination: string;
  origin?: string;
  incoterm?: string;
  containerType?: string;
  currency?: string;
  lines: QuotationLine[];
  cgvClauses?: CGVClause[];
  exclusions?: ExclusionItem[];
  marginPercent?: number;
  validityDays?: number;
  includeScenarios?: boolean;
  scenarios?: {
    name: string;
    containerType: string;
    weight?: number;
    lines: QuotationLine[];
  }[];
}

// Detect destination country
function detectCountry(destination: string): string {
  const dest = destination.toLowerCase();
  if (dest.includes('mali') || dest.includes('bamako') || dest.includes('sikasso') || 
      dest.includes('kayes') || dest.includes('sirakoro') || dest.includes('kati')) {
    return 'MALI';
  }
  if (dest.includes('burkina') || dest.includes('ouagadougou')) return 'BURKINA';
  if (dest.includes('niger') || dest.includes('niamey')) return 'NIGER';
  return 'SENEGAL';
}

// Get default CGV clauses
function getDefaultCGV(country: string): CGVClause[] {
  const common: CGVClause[] = [
    { code: 'VALIDITY', title: 'Validité', content: 'Cotation valable 30 jours.', isWarning: false },
  ];

  if (country === 'MALI') {
    return [
      ...common,
      { code: 'TRANSIT', title: 'Transit Time', content: 'Transit estimé: 15-18 jours depuis arrivée navire Dakar.', isWarning: false },
      { code: 'DEMURRAGE', title: 'Demurrage', content: 'Demander 21 jours franchise demurrage au booking.', isWarning: true },
      { code: 'DETENTION', title: 'Détention COC', content: '20\' @€23/j, 40\' @€39/j + Addcom. Délai A/R estimé 8-13 jours.', isWarning: true },
      { code: 'CAUTION', title: 'Caution COC', content: '20\': $3,200 | 40\': $5,100. Maersk/Safmarine: dispensé.', isWarning: true },
      { code: 'TRUCK', title: 'Immobilisation', content: '48h franchise. Au-delà: €38.11/jour.', isWarning: false },
      { code: 'SECURITY', title: 'Sécurité Mali', content: 'Retards sécuritaires non imputables.', isWarning: true },
      { code: 'PAYMENT', title: 'Paiement', content: '80% avant arrivée, 10% TRIE, 10% POD.', isWarning: false },
    ];
  }

  return [
    ...common,
    { code: 'STORAGE', title: 'Magasinage', content: 'Franchise 10 jours PAD.', isWarning: false },
    { code: 'DEMURRAGE', title: 'Surestaries', content: 'Franchise 10 jours.', isWarning: false },
    { code: 'DETENTION', title: 'Détention', content: '48h après sortie port. 20\' @€27/j, 40\' @€45/j.', isWarning: false },
    { code: 'TRUCK', title: 'Immobilisation', content: '24h franchise. Au-delà: 100,000 FCFA/j.', isWarning: false },
  ];
}

// Get default exclusions
function getDefaultExclusions(country: string): ExclusionItem[] {
  const common: ExclusionItem[] = [
    { service: 'Droits et taxes douaniers', rate: 'Selon déclaration' },
    { service: 'Magasinage hors franchise', rate: 'Tarif DPW' },
    { service: 'Surestaries hors franchise', rate: 'Tarif armateur' },
  ];

  if (country === 'MALI') {
    return [
      ...common,
      { service: 'BL Charges', rate: '€100' },
      { service: 'Pre-import / ENS', rate: '€300' },
      { service: 'PVI', rate: '0.75% FOB' },
      { service: 'Assurance Mali', rate: '0.15% CIF' },
      { service: 'Road Tax Mali', rate: '0.25% CIF' },
    ];
  }

  return [
    ...common,
    { service: 'BL Charges', rate: '€100' },
  ];
}

// Generate CSV content (compatible with Excel)
function generateCSV(request: QuotationRequest): string {
  const date = new Date().toLocaleDateString('fr-FR');
  const reference = request.reference || `QT-${Date.now()}`;
  const country = detectCountry(request.destination);
  const cgv = request.cgvClauses || getDefaultCGV(country);
  const exclusions = request.exclusions || getDefaultExclusions(country);
  const currency = request.currency || 'EUR';
  
  let csv = '';
  
  // BOM for Excel UTF-8 compatibility
  csv += '\ufeff';
  
  // Header section
  csv += 'SODATRA SHIPPING & LOGISTICS\n';
  csv += `Cotation ${country === 'MALI' ? 'Transit Mali' : 'Import Sénégal'}\n`;
  csv += '\n';
  csv += `Référence;${reference}\n`;
  csv += `Client;${request.client}\n`;
  csv += `Date;${date}\n`;
  csv += `Validité;${request.validityDays || 30} jours\n`;
  csv += `Destination;${request.destination}\n`;
  if (request.origin) csv += `Origine;${request.origin}\n`;
  if (request.incoterm) csv += `Incoterm;${request.incoterm}\n`;
  if (request.containerType) csv += `Type Conteneur;${request.containerType}\n`;
  csv += '\n';
  
  // Cost breakdown section
  csv += '=== DÉTAIL DES COÛTS ===\n';
  csv += 'Catégorie;Service;Unité;Taux;Qté;Montant;Source\n';
  
  let subtotal = 0;
  let currentCategory = '';
  
  for (const line of request.lines) {
    if (line.category !== currentCategory) {
      currentCategory = line.category;
      csv += `\n${currentCategory};;;;\n`;
    }
    
    const amount = line.amount || (line.rate * line.quantity);
    subtotal += amount;
    
    csv += `;${line.service};${line.unit};${line.rate};${line.quantity};${amount};${line.source}\n`;
  }
  
  csv += '\n';
  csv += `SOUS-TOTAL;;;;;${subtotal};${currency}\n`;
  
  if (request.marginPercent && request.marginPercent > 0) {
    const margin = subtotal * (request.marginPercent / 100);
    const total = subtotal + margin;
    csv += `Marge (${request.marginPercent}%);;;;;${margin.toFixed(0)};${currency}\n`;
    csv += `TOTAL;;;;;${total.toFixed(0)};${currency}\n`;
  } else {
    csv += `TOTAL;;;;;${subtotal};${currency}\n`;
  }
  
  csv += '\n\n';
  
  // CGV section
  csv += '=== CONDITIONS GÉNÉRALES ===\n';
  for (const clause of cgv) {
    const warning = clause.isWarning ? '⚠️ ' : '';
    csv += `${warning}${clause.title}\n`;
    csv += `"${clause.content.replace(/"/g, '""')}"\n`;
    csv += '\n';
  }
  
  csv += '\n';
  
  // Exclusions section
  csv += '=== EXCLUSIONS ===\n';
  csv += 'Service;Taux;Notes\n';
  for (const excl of exclusions) {
    csv += `${excl.service};${excl.rate};${excl.notes || ''}\n`;
  }
  
  csv += '\n\n';
  csv += 'Document généré automatiquement par SODATRA Intelligence\n';
  csv += `Date de génération: ${new Date().toLocaleString('fr-FR')}\n`;
  
  return csv;
}

// Generate HTML version (for preview)
function generateHTML(request: QuotationRequest): string {
  const date = new Date().toLocaleDateString('fr-FR');
  const reference = request.reference || `QT-${Date.now()}`;
  const country = detectCountry(request.destination);
  const cgv = request.cgvClauses || getDefaultCGV(country);
  const exclusions = request.exclusions || getDefaultExclusions(country);
  const currency = request.currency || 'EUR';
  
  let subtotal = 0;
  request.lines.forEach(l => subtotal += l.amount || (l.rate * l.quantity));
  
  const margin = request.marginPercent ? subtotal * (request.marginPercent / 100) : 0;
  const total = subtotal + margin;
  
  const formatAmount = (amt: number) => {
    return new Intl.NumberFormat('fr-FR').format(Math.round(amt));
  };

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cotation ${reference}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 11px; line-height: 1.4; color: #333; padding: 20px; max-width: 900px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, #1e40af 0%, #3b82f6 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .header h1 { font-size: 18px; margin-bottom: 4px; }
    .header p { opacity: 0.9; font-size: 12px; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; padding: 15px; background: #f8fafc; border: 1px solid #e2e8f0; }
    .meta-item { }
    .meta-label { font-size: 9px; color: #64748b; text-transform: uppercase; }
    .meta-value { font-weight: 600; color: #1e293b; }
    .section { margin-top: 20px; }
    .section-title { font-size: 12px; font-weight: 600; color: #1e40af; border-bottom: 2px solid #1e40af; padding-bottom: 4px; margin-bottom: 10px; }
    table { width: 100%; border-collapse: collapse; font-size: 10px; }
    th { background: #f1f5f9; padding: 8px; text-align: left; font-weight: 600; border-bottom: 2px solid #cbd5e1; }
    td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; }
    .category-row { background: #f8fafc; font-weight: 600; }
    .amount { text-align: right; font-family: monospace; }
    .source { font-size: 8px; padding: 2px 6px; border-radius: 10px; }
    .source-official { background: #dcfce7; color: #166534; }
    .source-historical { background: #fef3c7; color: #92400e; }
    .source-estimated { background: #e0e7ff; color: #3730a3; }
    .total-row { background: #1e40af; color: white; font-weight: 600; }
    .total-row td { padding: 10px 8px; }
    .subtotal-row { background: #f1f5f9; font-weight: 600; }
    .cgv-item { margin-bottom: 12px; padding: 10px; background: #f8fafc; border-radius: 6px; border-left: 3px solid #3b82f6; }
    .cgv-warning { border-left-color: #f59e0b; background: #fffbeb; }
    .cgv-title { font-weight: 600; color: #1e293b; margin-bottom: 4px; }
    .cgv-content { color: #64748b; white-space: pre-line; }
    .exclusions { display: grid; gap: 8px; }
    .exclusion-item { display: flex; justify-content: space-between; padding: 6px 10px; background: #fef2f2; border-radius: 4px; }
    .exclusion-service { color: #991b1b; }
    .exclusion-rate { font-weight: 600; color: #dc2626; }
    .footer { margin-top: 30px; padding-top: 15px; border-top: 1px solid #e2e8f0; text-align: center; color: #64748b; font-size: 9px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>SODATRA SHIPPING & LOGISTICS</h1>
    <p>Cotation ${country === 'MALI' ? 'Transit Mali' : 'Import Sénégal'} - ${request.destination}</p>
  </div>
  
  <div class="meta">
    <div class="meta-item">
      <div class="meta-label">Référence</div>
      <div class="meta-value">${reference}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Client</div>
      <div class="meta-value">${request.client}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Date</div>
      <div class="meta-value">${date}</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">Validité</div>
      <div class="meta-value">${request.validityDays || 30} jours</div>
    </div>
    ${request.origin ? `
    <div class="meta-item">
      <div class="meta-label">Origine</div>
      <div class="meta-value">${request.origin}</div>
    </div>` : ''}
    ${request.incoterm ? `
    <div class="meta-item">
      <div class="meta-label">Incoterm</div>
      <div class="meta-value">${request.incoterm}</div>
    </div>` : ''}
    ${request.containerType ? `
    <div class="meta-item">
      <div class="meta-label">Conteneur</div>
      <div class="meta-value">${request.containerType}</div>
    </div>` : ''}
  </div>
  
  <div class="section">
    <div class="section-title">DÉTAIL DES COÛTS</div>
    <table>
      <thead>
        <tr>
          <th style="width: 35%">Service</th>
          <th style="width: 10%">Unité</th>
          <th style="width: 15%">Taux</th>
          <th style="width: 8%">Qté</th>
          <th style="width: 17%">Montant</th>
          <th style="width: 15%">Source</th>
        </tr>
      </thead>
      <tbody>
        ${(() => {
          let html = '';
          let currentCat = '';
          for (const line of request.lines) {
            if (line.category !== currentCat) {
              currentCat = line.category;
              html += `<tr class="category-row"><td colspan="6">${currentCat}</td></tr>`;
            }
            const amt = line.amount || (line.rate * line.quantity);
            const sourceClass = line.source === 'OFFICIEL' ? 'source-official' : 
                               line.source === 'HISTORIQUE' ? 'source-historical' : 'source-estimated';
            html += `<tr>
              <td style="padding-left: 20px">${line.service}</td>
              <td>${line.unit}</td>
              <td class="amount">${formatAmount(line.rate)}</td>
              <td class="amount">${line.quantity}</td>
              <td class="amount">${formatAmount(amt)} ${currency}</td>
              <td><span class="source ${sourceClass}">${line.source}</span></td>
            </tr>`;
          }
          return html;
        })()}
        <tr class="subtotal-row">
          <td colspan="4">SOUS-TOTAL</td>
          <td class="amount">${formatAmount(subtotal)} ${currency}</td>
          <td></td>
        </tr>
        ${request.marginPercent ? `
        <tr>
          <td colspan="4">Marge (${request.marginPercent}%)</td>
          <td class="amount">${formatAmount(margin)} ${currency}</td>
          <td></td>
        </tr>` : ''}
        <tr class="total-row">
          <td colspan="4">TOTAL ${request.incoterm || ''} ${request.destination}</td>
          <td class="amount">${formatAmount(total)} ${currency}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  </div>
  
  <div class="section">
    <div class="section-title">CONDITIONS GÉNÉRALES - ${country === 'MALI' ? 'TRANSIT MALI' : 'IMPORT SÉNÉGAL'}</div>
    ${cgv.map(c => `
      <div class="cgv-item ${c.isWarning ? 'cgv-warning' : ''}">
        <div class="cgv-title">${c.isWarning ? '⚠️ ' : ''}${c.title}</div>
        <div class="cgv-content">${c.content}</div>
      </div>
    `).join('')}
  </div>
  
  <div class="section">
    <div class="section-title">EXCLUSIONS</div>
    <div class="exclusions">
      ${exclusions.map(e => `
        <div class="exclusion-item">
          <span class="exclusion-service">${e.service}</span>
          <span class="exclusion-rate">${e.rate}</span>
        </div>
      `).join('')}
    </div>
  </div>
  
  <div class="footer">
    <p>Document généré automatiquement par SODATRA Intelligence</p>
    <p>Date de génération: ${new Date().toLocaleString('fr-FR')}</p>
  </div>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const request: QuotationRequest = await req.json();
    
    if (!request.client || !request.destination || !request.lines?.length) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: client, destination, lines' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const reference = request.reference || `QT-${Date.now()}`;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Generate CSV
    const csvContent = generateCSV(request);
    const csvFilename = `cotation-${reference}-${timestamp}.csv`;
    
    // Generate HTML
    const htmlContent = generateHTML(request);
    const htmlFilename = `cotation-${reference}-${timestamp}.html`;
    
    // Upload CSV to storage
    const { data: csvUpload, error: csvError } = await supabase.storage
      .from('quotation-attachments')
      .upload(`exports/${csvFilename}`, new Blob([csvContent], { type: 'text/csv;charset=utf-8' }), {
        contentType: 'text/csv;charset=utf-8',
        upsert: true,
      });

    if (csvError) {
      console.error('CSV upload error:', csvError);
      throw new Error(`Failed to upload CSV: ${csvError.message}`);
    }

    // Upload HTML to storage
    const { data: htmlUpload, error: htmlError } = await supabase.storage
      .from('quotation-attachments')
      .upload(`exports/${htmlFilename}`, new Blob([htmlContent], { type: 'text/html;charset=utf-8' }), {
        contentType: 'text/html;charset=utf-8',
        upsert: true,
      });

    if (htmlError) {
      console.error('HTML upload error:', htmlError);
      throw new Error(`Failed to upload HTML: ${htmlError.message}`);
    }

    // Get public URLs
    const { data: csvUrl } = supabase.storage
      .from('quotation-attachments')
      .getPublicUrl(`exports/${csvFilename}`);

    const { data: htmlUrl } = supabase.storage
      .from('quotation-attachments')
      .getPublicUrl(`exports/${htmlFilename}`);

    console.log(`Generated quotation ${reference} for ${request.client} to ${request.destination}`);

    return new Response(
      JSON.stringify({
        success: true,
        reference,
        files: {
          csv: {
            filename: csvFilename,
            url: csvUrl.publicUrl,
            size: csvContent.length,
          },
          html: {
            filename: htmlFilename,
            url: htmlUrl.publicUrl,
            size: htmlContent.length,
          },
        },
        summary: {
          client: request.client,
          destination: request.destination,
          country: detectCountry(request.destination),
          lineCount: request.lines.length,
          currency: request.currency || 'EUR',
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error generating Excel quotation:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
