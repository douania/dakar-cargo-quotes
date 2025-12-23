import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface AttachmentPost {
  description: string;
  montant: number | string;
  devise: string;
  source?: string;
}

interface AttachmentData {
  filename?: string;
  posts: AttachmentPost[];
  total?: number;
  currency?: string;
  client_name?: string;
  destination?: string;
  incoterm?: string;
  validity_days?: number;
}

interface RequestBody {
  attachment_data: AttachmentData;
  email_id?: string;
  draft_id?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { attachment_data, email_id, draft_id }: RequestBody = await req.json();

    if (!attachment_data || !attachment_data.posts || attachment_data.posts.length === 0) {
      return new Response(
        JSON.stringify({ error: "attachment_data.posts is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Generating quotation attachment:", JSON.stringify(attachment_data));

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Generate date-based filename
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '');
    const timeStr = now.toISOString().split('T')[1].substring(0, 5).replace(':', '');
    const clientName = (attachment_data.client_name || 'Client').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = attachment_data.filename || `Cotation_${clientName}_${dateStr}_${timeStr}.html`;

    // Build HTML quotation document (more compatible than CSV for formatting)
    const htmlContent = generateHtmlQuotation(attachment_data);

    // Upload to Supabase Storage
    const storagePath = `quotations/${dateStr}/${filename}`;
    
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('quotation-attachments')
      .upload(storagePath, new TextEncoder().encode(htmlContent), {
        contentType: 'text/html; charset=utf-8',
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('quotation-attachments')
      .getPublicUrl(storagePath);

    const publicUrl = publicUrlData?.publicUrl;

    console.log("Quotation attachment uploaded:", storagePath, publicUrl);

    // Also generate CSV version for Excel compatibility
    const csvContent = generateCsvQuotation(attachment_data);
    const csvFilename = filename.replace('.html', '.csv');
    const csvPath = `quotations/${dateStr}/${csvFilename}`;

    await supabase.storage
      .from('quotation-attachments')
      .upload(csvPath, new TextEncoder().encode(csvContent), {
        contentType: 'text/csv; charset=utf-8',
        upsert: true,
      });

    const { data: csvUrlData } = supabase.storage
      .from('quotation-attachments')
      .getPublicUrl(csvPath);

    return new Response(
      JSON.stringify({
        success: true,
        attachment: {
          filename: filename,
          storage_path: storagePath,
          public_url: publicUrl,
          csv_url: csvUrlData?.publicUrl,
          content_type: 'text/html',
        },
        email_id,
        draft_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Generate quotation attachment error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function generateHtmlQuotation(data: AttachmentData): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('fr-FR', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  
  const validityDays = data.validity_days || 15;
  const validityDate = new Date(now.getTime() + validityDays * 24 * 60 * 60 * 1000);
  const validityStr = validityDate.toLocaleDateString('fr-FR', {
    year: 'numeric',
    month: 'long', 
    day: 'numeric'
  });

  // Calculate totals
  let totalAmount = 0;
  const currency = data.currency || 'FCFA';
  
  for (const post of data.posts) {
    const amount = typeof post.montant === 'number' ? post.montant : parseFloat(String(post.montant).replace(/[^\d.-]/g, '')) || 0;
    totalAmount += amount;
  }

  // Use provided total if available
  const displayTotal = data.total || totalAmount;

  const rows = data.posts.map(post => {
    const amount = typeof post.montant === 'number' 
      ? post.montant.toLocaleString('fr-FR')
      : post.montant;
    return `
      <tr>
        <td style="padding: 8px 12px; border: 1px solid #ddd;">${post.description}</td>
        <td style="padding: 8px 12px; border: 1px solid #ddd; text-align: right;">${amount}</td>
        <td style="padding: 8px 12px; border: 1px solid #ddd; text-align: center;">${post.devise || currency}</td>
        <td style="padding: 8px 12px; border: 1px solid #ddd; font-size: 11px; color: #666;">${post.source || '-'}</td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cotation SODATRA</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 20px; color: #333; }
    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #1a365d; padding-bottom: 20px; }
    .header h1 { color: #1a365d; margin: 0 0 5px 0; }
    .header p { color: #666; margin: 0; }
    .info-section { display: flex; justify-content: space-between; margin-bottom: 20px; }
    .info-block { }
    .info-block strong { color: #1a365d; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th { background: #1a365d; color: white; padding: 10px 12px; text-align: left; }
    th:nth-child(2), th:nth-child(3) { text-align: center; }
    .total-row { background: #f0f4f8; font-weight: bold; }
    .total-row td { border: 2px solid #1a365d !important; }
    .footer { margin-top: 30px; font-size: 12px; color: #666; border-top: 1px solid #ddd; padding-top: 15px; }
    .validity { background: #fffbeb; padding: 10px; border-left: 4px solid #f59e0b; margin: 20px 0; }
    .notes { background: #f0f9ff; padding: 10px; border-left: 4px solid #0284c7; margin: 20px 0; }
  </style>
</head>
<body>
  <div class="header">
    <h1>COTATION / QUOTATION</h1>
    <p>SODATRA - Transit & Commissionnaire en Douane</p>
  </div>

  <div class="info-section">
    <div class="info-block">
      <p><strong>Client:</strong> ${data.client_name || '-'}</p>
      <p><strong>Destination:</strong> ${data.destination || '-'}</p>
      <p><strong>Incoterm:</strong> ${data.incoterm || '-'}</p>
    </div>
    <div class="info-block" style="text-align: right;">
      <p><strong>Date:</strong> ${dateStr}</p>
      <p><strong>Référence:</strong> COT-${now.getTime().toString(36).toUpperCase()}</p>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Poste / Description</th>
        <th style="width: 120px;">Montant</th>
        <th style="width: 80px;">Devise</th>
        <th style="width: 120px;">Source</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
      <tr class="total-row">
        <td style="padding: 10px 12px; border: 2px solid #1a365d;"><strong>TOTAL</strong></td>
        <td style="padding: 10px 12px; border: 2px solid #1a365d; text-align: right;"><strong>${displayTotal.toLocaleString('fr-FR')}</strong></td>
        <td style="padding: 10px 12px; border: 2px solid #1a365d; text-align: center;"><strong>${currency}</strong></td>
        <td style="padding: 10px 12px; border: 2px solid #1a365d;"></td>
      </tr>
    </tbody>
  </table>

  <div class="validity">
    <strong>⏱️ Validité:</strong> Cette cotation est valable jusqu'au <strong>${validityStr}</strong> (${validityDays} jours).
  </div>

  <div class="notes">
    <strong>📋 Notes:</strong>
    <ul style="margin: 5px 0; padding-left: 20px;">
      <li>Les montants marqués "À CONFIRMER" seront précisés après réception des informations complémentaires.</li>
      <li>Les taxes et droits de douane sont calculés sur la valeur CAF selon le code HS déclaré.</li>
      <li>Cette cotation est sujette à confirmation des disponibilités.</li>
    </ul>
  </div>

  <div class="footer">
    <p><strong>SODATRA</strong> - Transit, Commissionnaire en Douane Agréé</p>
    <p>Dakar, Sénégal | contact@sodatra.sn</p>
    <p>Document généré automatiquement le ${new Date().toLocaleString('fr-FR')}</p>
  </div>
</body>
</html>`;
}

function generateCsvQuotation(data: AttachmentData): string {
  const lines: string[] = [];
  const currency = data.currency || 'FCFA';
  
  // Header
  lines.push('Poste,Montant,Devise,Source');
  
  // Data rows
  for (const post of data.posts) {
    const amount = typeof post.montant === 'number' 
      ? post.montant 
      : String(post.montant).replace(/[^\d.-]/g, '');
    const desc = String(post.description).replace(/,/g, ';').replace(/"/g, '""');
    const source = (post.source || '-').replace(/,/g, ';');
    lines.push(`"${desc}",${amount},${post.devise || currency},"${source}"`);
  }
  
  // Total row
  const total = data.total || data.posts.reduce((sum, p) => {
    const amt = typeof p.montant === 'number' ? p.montant : parseFloat(String(p.montant).replace(/[^\d.-]/g, '')) || 0;
    return sum + amt;
  }, 0);
  lines.push(`"TOTAL",${total},${currency},""`);
  
  return lines.join('\n');
}
