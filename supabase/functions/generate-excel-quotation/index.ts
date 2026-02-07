import { requireUser } from "../_shared/auth.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import ExcelJS from "https://esm.sh/exceljs@4.4.0";

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

interface ContainerScenario {
  name: string;
  containerType: string;
  weight?: number;
  lines: QuotationLine[];
  total: number;
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
  scenarios?: ContainerScenario[];
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
      { code: 'DEMURRAGE', title: 'Demurrage Free Time', content: 'Demander 21 jours franchise demurrage au booking (standard: 10 jours).', isWarning: true },
      { code: 'STORAGE', title: 'Magasinage DPW', content: 'Franchise magasinage Transit TRIE: 21 jours depuis arrivée navire.', isWarning: false },
      { code: 'MERCHANT_HAULAGE', title: 'Merchant Haulage Free Time', content: '23 jours depuis gate out full jusqu\'au gate in empty.', isWarning: false },
      { code: 'DETENTION', title: 'Détention COC', content: '20\' DRY: €23/jour + Addcom (MSC 5.5%, autres 2.8%)\n40\' DRY: €39/jour + Addcom\nDélai A/R estimé: 8-13 jours', isWarning: true },
      { code: 'CAUTION', title: 'Caution Conteneur COC', content: '20\': $3,200 USD | 40\': $5,100 USD\nAlternative broker: €150 (20\') / €250 (40\')\nMaersk/Safmarine: Dispensé', isWarning: true },
      { code: 'TRUCK', title: 'Immobilisation Camion', content: 'Franchise: 48h (frontière, Kati, site)\nAu-delà: €38.11/jour (~25,000 FCFA/jour)', isWarning: false },
      { code: 'SECURITY', title: 'Force Majeure / Sécurité', content: 'Grèves, émeutes, situation sécuritaire: retards non imputables.\nSurestaries et immobilisation camion restent applicables.', isWarning: true },
      { code: 'PAYMENT', title: 'Conditions Paiement', content: '80% avant arrivée navire\n10% passage frontière TRIE\n10% sur POD', isWarning: false },
    ];
  }

  return [
    ...common,
    { code: 'STORAGE', title: 'Franchise Magasinage', content: 'Franchise magasinage PAD: 10 jours.', isWarning: false },
    { code: 'DEMURRAGE', title: 'Surestaries', content: 'Franchise: 10 jours depuis arrivée navire.', isWarning: false },
    { code: 'DETENTION', title: 'Détention', content: '48h après sortie port. 20\' @€27/j, 40\' @€45/j.', isWarning: false },
    { code: 'TRUCK', title: 'Immobilisation Camion', content: '24h franchise. Au-delà: 100,000 FCFA/j.', isWarning: false },
  ];
}

// Get default exclusions
function getDefaultExclusions(country: string): ExclusionItem[] {
  const common: ExclusionItem[] = [
    { service: 'Droits et taxes douaniers', rate: 'Selon déclaration' },
    { service: 'Magasinage hors franchise', rate: 'Tarif DPW/PAD' },
    { service: 'Surestaries hors franchise', rate: 'Tarif armateur' },
  ];

  if (country === 'MALI') {
    return [
      ...common,
      { service: 'BL Charges', rate: '€100' },
      { service: 'Pre-import / ENS', rate: '€300' },
      { service: 'PVI (Inspection)', rate: '0.75% FOB' },
      { service: 'Assurance Mali', rate: '0.15% CIF' },
      { service: 'Road Tax Mali', rate: '0.25% CIF' },
    ];
  }

  return [
    ...common,
    { service: 'BL Charges', rate: '€100' },
  ];
}

// Format number for Excel
function formatNumber(num: number): number {
  return Math.round(num * 100) / 100;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

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
    const country = detectCountry(request.destination);
    const cgv = request.cgvClauses || getDefaultCGV(country);
    const exclusions = request.exclusions || getDefaultExclusions(country);
    const currency = request.currency || 'EUR';
    const date = new Date().toLocaleDateString('fr-FR');
    
    console.log(`Generating Excel quotation ${reference} for ${request.client} to ${request.destination}`);

    // Create workbook
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SODATRA Intelligence';
    workbook.created = new Date();
    workbook.modified = new Date();

    // ========================================
    // TAB 1: COTATION (Main Summary)
    // ========================================
    const mainSheet = workbook.addWorksheet('Cotation', {
      properties: { tabColor: { argb: '1E40AF' } }
    });

    // Set column widths
    mainSheet.columns = [
      { width: 5 },   // A - empty
      { width: 35 },  // B - Service
      { width: 12 },  // C - Unit
      { width: 15 },  // D - Rate
      { width: 8 },   // E - Qty
      { width: 18 },  // F - Amount
      { width: 15 },  // G - Source
    ];

    // Header section
    mainSheet.mergeCells('B2:G2');
    const titleCell = mainSheet.getCell('B2');
    titleCell.value = 'SODATRA SHIPPING & LOGISTICS';
    titleCell.font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    mainSheet.getRow(2).height = 30;

    mainSheet.mergeCells('B3:G3');
    const subtitleCell = mainSheet.getCell('B3');
    subtitleCell.value = `Cotation ${country === 'MALI' ? 'Transit Mali' : 'Import Sénégal'} - ${request.destination}`;
    subtitleCell.font = { name: 'Arial', size: 12, color: { argb: 'FF1E40AF' } };
    subtitleCell.alignment = { horizontal: 'center' };

    // Meta information
    const metaStart = 5;
    const metaData = [
      ['Référence', reference],
      ['Client', request.client],
      ['Date', date],
      ['Validité', `${request.validityDays || 30} jours`],
      ['Destination', request.destination],
    ];
    if (request.origin) metaData.push(['Origine', request.origin]);
    if (request.incoterm) metaData.push(['Incoterm', request.incoterm]);
    if (request.containerType) metaData.push(['Conteneur', request.containerType]);

    metaData.forEach((row, idx) => {
      const labelCell = mainSheet.getCell(`B${metaStart + idx}`);
      labelCell.value = row[0];
      labelCell.font = { name: 'Arial', size: 10, bold: true };
      labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
      
      const valueCell = mainSheet.getCell(`C${metaStart + idx}`);
      mainSheet.mergeCells(`C${metaStart + idx}:D${metaStart + idx}`);
      valueCell.value = row[1];
      valueCell.font = { name: 'Arial', size: 10 };
    });

    // Cost breakdown header
    const costHeaderRow = metaStart + metaData.length + 2;
    mainSheet.mergeCells(`B${costHeaderRow}:G${costHeaderRow}`);
    const costHeader = mainSheet.getCell(`B${costHeaderRow}`);
    costHeader.value = 'DÉTAIL DES COÛTS';
    costHeader.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FF1E40AF' } };
    costHeader.border = { bottom: { style: 'thick', color: { argb: 'FF1E40AF' } } };

    // Table headers
    const tableHeaderRow = costHeaderRow + 2;
    const headers = ['', 'Service', 'Unité', 'Taux', 'Qté', 'Montant', 'Source'];
    headers.forEach((header, idx) => {
      const cell = mainSheet.getCell(tableHeaderRow, idx + 1);
      cell.value = header;
      cell.font = { name: 'Arial', size: 10, bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      cell.border = { bottom: { style: 'medium', color: { argb: 'FFCBD5E1' } } };
      cell.alignment = { horizontal: idx >= 3 ? 'right' : 'left' };
    });

    // Cost lines
    let currentRow = tableHeaderRow + 1;
    let subtotal = 0;
    let currentCategory = '';

    for (const line of request.lines) {
      // Category row
      if (line.category !== currentCategory) {
        currentCategory = line.category;
        mainSheet.mergeCells(`B${currentRow}:G${currentRow}`);
        const catCell = mainSheet.getCell(`B${currentRow}`);
        catCell.value = currentCategory;
        catCell.font = { name: 'Arial', size: 10, bold: true };
        catCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        currentRow++;
      }

      // Line data
      const amount = line.amount || (line.rate * line.quantity);
      subtotal += amount;

      mainSheet.getCell(`B${currentRow}`).value = `  ${line.service}`;
      mainSheet.getCell(`C${currentRow}`).value = line.unit;
      mainSheet.getCell(`D${currentRow}`).value = formatNumber(line.rate);
      mainSheet.getCell(`D${currentRow}`).numFmt = '#,##0';
      mainSheet.getCell(`D${currentRow}`).alignment = { horizontal: 'right' };
      mainSheet.getCell(`E${currentRow}`).value = line.quantity;
      mainSheet.getCell(`E${currentRow}`).alignment = { horizontal: 'right' };
      mainSheet.getCell(`F${currentRow}`).value = formatNumber(amount);
      mainSheet.getCell(`F${currentRow}`).numFmt = '#,##0';
      mainSheet.getCell(`F${currentRow}`).alignment = { horizontal: 'right' };
      
      const sourceCell = mainSheet.getCell(`G${currentRow}`);
      sourceCell.value = line.source;
      sourceCell.font = { name: 'Arial', size: 9 };
      if (line.source === 'OFFICIEL') {
        sourceCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
        sourceCell.font = { name: 'Arial', size: 9, color: { argb: 'FF166534' } };
      } else if (line.source === 'HISTORIQUE') {
        sourceCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        sourceCell.font = { name: 'Arial', size: 9, color: { argb: 'FF92400E' } };
      }

      // Border
      for (let col = 2; col <= 7; col++) {
        mainSheet.getCell(currentRow, col).border = { 
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } } 
        };
      }

      currentRow++;
    }

    // Subtotal row
    currentRow++;
    mainSheet.getCell(`B${currentRow}`).value = 'SOUS-TOTAL';
    mainSheet.getCell(`B${currentRow}`).font = { name: 'Arial', size: 10, bold: true };
    mainSheet.getCell(`F${currentRow}`).value = formatNumber(subtotal);
    mainSheet.getCell(`F${currentRow}`).numFmt = '#,##0';
    mainSheet.getCell(`F${currentRow}`).font = { name: 'Arial', size: 10, bold: true };
    mainSheet.getCell(`F${currentRow}`).alignment = { horizontal: 'right' };
    mainSheet.getCell(`G${currentRow}`).value = currency;
    for (let col = 2; col <= 7; col++) {
      mainSheet.getCell(currentRow, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    }

    // Margin and total (if margin applied)
    let total = subtotal;
    if (request.marginPercent && request.marginPercent > 0) {
      const margin = subtotal * (request.marginPercent / 100);
      total = subtotal + margin;
      
      currentRow++;
      mainSheet.getCell(`B${currentRow}`).value = `Frais de service`;
      mainSheet.getCell(`F${currentRow}`).value = formatNumber(margin);
      mainSheet.getCell(`F${currentRow}`).numFmt = '#,##0';
      mainSheet.getCell(`F${currentRow}`).alignment = { horizontal: 'right' };
      mainSheet.getCell(`G${currentRow}`).value = currency;
    }

    // Total row
    currentRow++;
    mainSheet.mergeCells(`B${currentRow}:E${currentRow}`);
    const totalLabelCell = mainSheet.getCell(`B${currentRow}`);
    totalLabelCell.value = `TOTAL ${request.incoterm || ''} ${request.destination}`.trim();
    totalLabelCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    
    const totalValueCell = mainSheet.getCell(`F${currentRow}`);
    totalValueCell.value = formatNumber(total);
    totalValueCell.numFmt = '#,##0';
    totalValueCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
    totalValueCell.alignment = { horizontal: 'right' };
    
    const totalCurrencyCell = mainSheet.getCell(`G${currentRow}`);
    totalCurrencyCell.value = currency;
    totalCurrencyCell.font = { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };

    for (let col = 2; col <= 7; col++) {
      mainSheet.getCell(currentRow, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
    }
    mainSheet.getRow(currentRow).height = 25;

    // ========================================
    // TAB 2: DÉTAIL PAR CONTENEUR (Scenarios)
    // ========================================
    if (request.scenarios && request.scenarios.length > 0) {
      const scenarioSheet = workbook.addWorksheet('Détail par Conteneur', {
        properties: { tabColor: { argb: '059669' } }
      });

      scenarioSheet.columns = [
        { width: 5 },
        { width: 35 },
        { width: 12 },
        { width: 15 },
        ...request.scenarios.map(() => ({ width: 15 })),
      ];

      // Header
      scenarioSheet.mergeCells('B2:' + String.fromCharCode(67 + request.scenarios.length) + '2');
      const scenarioTitle = scenarioSheet.getCell('B2');
      scenarioTitle.value = 'DÉTAIL PAR CONTENEUR';
      scenarioTitle.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      scenarioTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
      scenarioTitle.alignment = { horizontal: 'center' };
      scenarioSheet.getRow(2).height = 25;

      // Column headers
      const scenarioHeaders = ['', 'Service', 'Unité', 'Taux', ...request.scenarios.map(s => s.name)];
      scenarioHeaders.forEach((header, idx) => {
        const cell = scenarioSheet.getCell(4, idx + 1);
        cell.value = header;
        cell.font = { name: 'Arial', size: 10, bold: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
        cell.alignment = { horizontal: idx >= 3 ? 'center' : 'left' };
      });

      // Group lines by category
      const categories = [...new Set(request.lines.map(l => l.category))];
      let scenarioRow = 5;

      categories.forEach(category => {
        // Category header
        scenarioSheet.mergeCells(`B${scenarioRow}:` + String.fromCharCode(67 + request.scenarios!.length) + scenarioRow);
        scenarioSheet.getCell(`B${scenarioRow}`).value = category;
        scenarioSheet.getCell(`B${scenarioRow}`).font = { name: 'Arial', size: 10, bold: true };
        scenarioSheet.getCell(`B${scenarioRow}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
        scenarioRow++;

        const categoryLines = request.lines.filter(l => l.category === category);
        categoryLines.forEach(line => {
          scenarioSheet.getCell(`B${scenarioRow}`).value = `  ${line.service}`;
          scenarioSheet.getCell(`C${scenarioRow}`).value = line.unit;
          scenarioSheet.getCell(`D${scenarioRow}`).value = line.rate;
          scenarioSheet.getCell(`D${scenarioRow}`).numFmt = '#,##0';

          // Scenario columns
          request.scenarios!.forEach((scenario, sIdx) => {
            const scenarioLine = scenario.lines.find(sl => sl.service === line.service);
            const cell = scenarioSheet.getCell(scenarioRow, 5 + sIdx);
            cell.value = scenarioLine ? formatNumber(scenarioLine.amount) : formatNumber(line.amount);
            cell.numFmt = '#,##0';
            cell.alignment = { horizontal: 'right' };
          });

          scenarioRow++;
        });
      });

      // Totals row
      scenarioRow++;
      scenarioSheet.getCell(`B${scenarioRow}`).value = 'TOTAL';
      scenarioSheet.getCell(`B${scenarioRow}`).font = { name: 'Arial', size: 11, bold: true };
      request.scenarios.forEach((scenario, sIdx) => {
        const cell = scenarioSheet.getCell(scenarioRow, 5 + sIdx);
        cell.value = formatNumber(scenario.total);
        cell.numFmt = '#,##0';
        cell.font = { name: 'Arial', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF059669' } };
        cell.alignment = { horizontal: 'right' };
      });
    }

    // ========================================
    // TAB 3: CGV - CONDITIONS
    // ========================================
    const cgvSheet = workbook.addWorksheet('CGV - Conditions', {
      properties: { tabColor: { argb: 'D97706' } }
    });

    cgvSheet.columns = [
      { width: 5 },
      { width: 25 },
      { width: 70 },
    ];

    // Header
    cgvSheet.mergeCells('B2:C2');
    const cgvTitle = cgvSheet.getCell('B2');
    cgvTitle.value = `CONDITIONS GÉNÉRALES - ${country === 'MALI' ? 'TRANSIT MALI' : 'IMPORT SÉNÉGAL'}`;
    cgvTitle.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    cgvTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD97706' } };
    cgvTitle.alignment = { horizontal: 'center' };
    cgvSheet.getRow(2).height = 25;

    let cgvRow = 4;
    cgv.forEach(clause => {
      const titleCell = cgvSheet.getCell(`B${cgvRow}`);
      titleCell.value = clause.isWarning ? `⚠️ ${clause.title}` : clause.title;
      titleCell.font = { name: 'Arial', size: 10, bold: true };
      
      const contentCell = cgvSheet.getCell(`C${cgvRow}`);
      contentCell.value = clause.content;
      contentCell.font = { name: 'Arial', size: 10 };
      contentCell.alignment = { wrapText: true, vertical: 'top' };
      
      if (clause.isWarning) {
        titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
        contentCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
      }

      // Calculate row height based on content
      const lines = clause.content.split('\n').length;
      cgvSheet.getRow(cgvRow).height = Math.max(20, lines * 15);
      
      cgvRow += 2;
    });

    // ========================================
    // TAB 4: EXCLUSIONS
    // ========================================
    const exclusionsSheet = workbook.addWorksheet('Exclusions', {
      properties: { tabColor: { argb: 'DC2626' } }
    });

    exclusionsSheet.columns = [
      { width: 5 },
      { width: 35 },
      { width: 20 },
      { width: 40 },
    ];

    // Header
    exclusionsSheet.mergeCells('B2:D2');
    const exclTitle = exclusionsSheet.getCell('B2');
    exclTitle.value = 'EXCLUSIONS';
    exclTitle.font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    exclTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDC2626' } };
    exclTitle.alignment = { horizontal: 'center' };
    exclusionsSheet.getRow(2).height = 25;

    // Table headers
    ['', 'Service', 'Taux/Montant', 'Notes'].forEach((header, idx) => {
      const cell = exclusionsSheet.getCell(4, idx + 1);
      cell.value = header;
      cell.font = { name: 'Arial', size: 10, bold: true };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
    });

    exclusions.forEach((excl, idx) => {
      const row = 5 + idx;
      exclusionsSheet.getCell(`B${row}`).value = excl.service;
      exclusionsSheet.getCell(`C${row}`).value = excl.rate;
      exclusionsSheet.getCell(`C${row}`).font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFDC2626' } };
      exclusionsSheet.getCell(`D${row}`).value = excl.notes || '';
      
      for (let col = 2; col <= 4; col++) {
        exclusionsSheet.getCell(row, col).border = { 
          bottom: { style: 'thin', color: { argb: 'FFFECACA' } } 
        };
      }
    });

    // ========================================
    // GENERATE FILE
    // ========================================
    const buffer = await workbook.xlsx.writeBuffer();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const filename = `Cotation_${reference}_${timestamp}.xlsx`;

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('quotation-attachments')
      .upload(`exports/${filename}`, buffer, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error(`Failed to upload Excel: ${uploadError.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('quotation-attachments')
      .getPublicUrl(`exports/${filename}`);

    console.log(`Excel quotation ${reference} generated successfully: ${filename}`);

    return new Response(
      JSON.stringify({
        success: true,
        reference,
        file: {
          filename,
          url: urlData.publicUrl,
          size: buffer.byteLength,
          format: 'xlsx',
          tabs: [
            'Cotation',
            ...(request.scenarios?.length ? ['Détail par Conteneur'] : []),
            'CGV - Conditions',
            'Exclusions'
          ]
        },
        summary: {
          client: request.client,
          destination: request.destination,
          country,
          currency,
          subtotal: formatNumber(subtotal),
          total: formatNumber(total),
          linesCount: request.lines.length,
          cgvCount: cgv.length,
          exclusionsCount: exclusions.length,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error generating Excel quotation:', errorMessage);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to generate Excel quotation', 
        details: errorMessage 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
