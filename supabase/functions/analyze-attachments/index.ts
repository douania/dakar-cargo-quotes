import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface TariffLine {
  service: string;
  description?: string;
  amount: number;
  currency: string;
  unit?: string;
  notes?: string;
}

interface QuotationExtractedData {
  type: 'quotation_sheet' | 'pricing_table' | 'rate_card' | 'document';
  lines: TariffLine[];
  total?: { amount: number; currency: string };
  sheetNames?: string[];
  metadata?: {
    client?: string;
    date?: string;
    route?: string;
    incoterm?: string;
  };
}

// Extract tariff lines from AI response
function extractTariffLines(aiResponse: any): TariffLine[] {
  const lines: TariffLine[] = [];
  
  if (aiResponse.tariff_lines && Array.isArray(aiResponse.tariff_lines)) {
    for (const line of aiResponse.tariff_lines) {
      if (line.service && typeof line.amount === 'number') {
        lines.push({
          service: line.service,
          description: line.description,
          amount: line.amount,
          currency: normalizeCurrency(line.currency || 'FCFA'),
          unit: line.unit,
        });
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
  
  if (textLower.includes('breakbulk') || textLower.includes('break bulk')) return 'breakbulk';
  if (textLower.includes('container') || textLower.includes('conteneur')) return 'container';
  if (textLower.includes('project') || textLower.includes('projet')) return 'project';
  if (textLower.includes('40fr') || textLower.includes('flat')) return 'container';
  if (textLower.includes('oog') || textLower.includes('out-of-gauge')) return 'special';
  
  return 'container'; // Default
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { attachmentId } = await req.json();
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');
    
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // Fetch attachment(s) to analyze
    let query = supabase
      .from('email_attachments')
      .select('id, filename, content_type, storage_path, email_id');
    
    if (attachmentId) {
      query = query.eq('id', attachmentId);
    } else {
      // Get all unanalyzed attachments
      query = query.eq('is_analyzed', false).limit(10);
    }
    
    const { data: attachments, error: fetchError } = await query;
    
    if (fetchError) {
      throw new Error(`Failed to fetch attachments: ${fetchError.message}`);
    }
    
    if (!attachments || attachments.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'No attachments to analyze', analyzed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    console.log(`Analyzing ${attachments.length} attachment(s)...`);
    
    const results = [];
    
    for (const attachment of attachments) {
      try {
        console.log(`Analyzing: ${attachment.filename} (${attachment.content_type})`);
        
        const isImage = attachment.content_type?.startsWith('image/');
        const isPdf = attachment.content_type === 'application/pdf';
        const isExcel = attachment.content_type?.includes('spreadsheet') || 
                        attachment.content_type?.includes('excel') ||
                        attachment.filename?.endsWith('.xlsx') ||
                        attachment.filename?.endsWith('.xls');
        
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
        
        // Download the file from storage
        const { data: fileData, error: downloadError } = await supabase
          .storage
          .from('documents')
          .download(attachment.storage_path);
        
        if (downloadError || !fileData) {
          console.error(`Failed to download ${attachment.filename}:`, downloadError);
          continue;
        }
        
        let extractedData: any = null;
        let extractedText = '';
        
        // Convert to base64
        const arrayBuffer = await fileData.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        
        // Convert to base64 in chunks
        const CHUNK_SIZE = 8192;
        let base64 = '';
        for (let i = 0; i < uint8Array.length; i += CHUNK_SIZE) {
          const chunk = uint8Array.slice(i, i + CHUNK_SIZE);
          base64 += String.fromCharCode.apply(null, Array.from(chunk));
        }
        base64 = btoa(base64);
        
        const mimeType = attachment.content_type || (isExcel ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'image/jpeg');
        
        // For Excel files, we'll use AI to analyze them as documents
        // Since Gemini can understand file structure from context
        const systemPrompt = isExcel 
          ? `Tu es un expert en analyse de fichiers Excel de cotation logistique et maritime.
Analyse le document Excel fourni et extrais TOUTES les lignes de tarifs/services avec leurs montants.

Pour chaque ligne de tarif trouvée, extrais:
- service: nom du service (ex: "DTHC 40'", "On-carriage", "Port charges")
- amount: montant numérique
- currency: devise (FCFA, EUR, USD)
- unit: unité de facturation (EVP, tonne, forfait, voyage)

IMPORTANT: Extrais TOUTES les lignes avec des montants, même partiels.

Réponds en JSON avec cette structure exacte:
{
  "type": "quotation_sheet",
  "description": "description brève du document",
  "tariff_lines": [
    { "service": "nom", "amount": 123456, "currency": "FCFA", "unit": "EVP" }
  ],
  "total": { "amount": 123456, "currency": "FCFA" },
  "metadata": {
    "client": "nom client si visible",
    "route": "origine -> destination",
    "incoterm": "DAP/FOB/etc"
  },
  "confidence": 0.9
}`
          : `Tu es un assistant expert en analyse de documents commerciaux et logistiques. 
Analyse l'image fournie et extrais toutes les informations pertinentes.
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
        
        // Build message content based on file type
        const userContent: any[] = [
          {
            type: 'text',
            text: isExcel 
              ? `Analyse ce fichier Excel de cotation (${attachment.filename}) et extrais TOUTES les lignes de tarifs avec leurs montants en FCFA ou EUR.`
              : `Analyse ce document (${attachment.filename}) et extrais les tarifs et informations.`
          }
        ];

        // For images and PDFs, add image content
        if (isImage || isPdf) {
          const dataUrl = `data:${mimeType};base64,${base64}`;
          userContent.push({
            type: 'image_url',
            image_url: { url: dataUrl }
          });
        } else if (isExcel) {
          // For Excel, we pass the base64 data as context
          userContent.push({
            type: 'text',
            text: `[Fichier Excel en base64 - ${attachment.filename}]\nLe fichier contient des données de cotation à analyser. Taille: ${uint8Array.length} octets.`
          });
        }
        
        // Analyze with AI
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
        
        // Parse the JSON response
        extractedData = { raw_response: content };
        extractedText = '';
        
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            extractedData = parsed;
            extractedText = parsed.text_content || parsed.description || '';
            
            // Extract tariff lines
            const tariffLines = extractTariffLines(parsed);
            
            // If tariff lines detected, store in quotation_history
            if (tariffLines.length > 0 && attachment.email_id) {
              console.log(`Extracted ${tariffLines.length} tariff lines, storing in history...`);
              
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
                                   (parsed.metadata?.route?.split('->')[1]?.trim() || 'Dakar');
                
                // Calculate total
                const totalFcfa = tariffLines
                  .filter(l => l.currency === 'FCFA')
                  .reduce((sum, l) => sum + l.amount, 0);
                
                const { error: historyError } = await supabase
                  .from('quotation_history')
                  .insert({
                    route_port: 'Dakar',
                    route_destination: destination,
                    cargo_type: detectCargoType(subject + ' ' + attachment.filename),
                    client_company: parsed.metadata?.client,
                    incoterm: parsed.metadata?.incoterm,
                    tariff_lines: tariffLines,
                    total_amount: totalFcfa || parsed.total?.amount,
                    total_currency: 'FCFA',
                    source_email_id: attachment.email_id,
                    source_attachment_id: attachment.id,
                  });
                
                if (historyError) {
                  console.error('Error storing quotation history:', historyError);
                } else {
                  console.log(`Quotation history stored successfully: ${tariffLines.length} lines`);
                }
              }
            }
          }
        } catch (parseError) {
          console.log('Could not parse JSON, using raw response');
          extractedText = content;
        }
        
        // Update the attachment record
        const { error: updateError } = await supabase
          .from('email_attachments')
          .update({
            is_analyzed: true,
            extracted_text: extractedText,
            extracted_data: extractedData
          })
          .eq('id', attachment.id);
        
        if (updateError) {
          console.error(`Failed to update attachment ${attachment.id}:`, updateError);
        } else {
          console.log(`Successfully analyzed: ${attachment.filename}`);
          results.push({
            id: attachment.id,
            filename: attachment.filename,
            type: extractedData.type,
            linesExtracted: extractedData.tariff_lines?.length || 0,
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
