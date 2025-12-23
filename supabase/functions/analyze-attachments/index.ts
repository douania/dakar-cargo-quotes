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
  container_type?: string;
  sheet_name?: string;
}

// Extract tariff lines from AI response
function extractTariffLines(aiResponse: any): TariffLine[] {
  const lines: TariffLine[] = [];
  
  if (aiResponse.tariff_lines && Array.isArray(aiResponse.tariff_lines)) {
    for (const line of aiResponse.tariff_lines) {
      if (line.service && (typeof line.amount === 'number' || typeof line.amount_xof === 'number')) {
        lines.push({
          service: line.service,
          description: line.description,
          amount: line.amount || line.amount_xof || 0,
          currency: normalizeCurrency(line.currency || 'FCFA'),
          unit: line.unit,
          container_type: line.container_type || line.container,
          sheet_name: line.sheet_name,
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
                currency: 'FCFA',
                unit: rate.container || tariff.unit,
                container_type: rate.container,
                sheet_name: sheet.name,
              });
            }
          } else {
            // Simple tariff structure
            lines.push({
              service: tariff.service,
              description: tariff.description || sheet.name,
              amount: tariff.amount || tariff.amount_xof || 0,
              currency: normalizeCurrency(tariff.currency || 'FCFA'),
              unit: tariff.unit,
              container_type: tariff.container_type,
              sheet_name: sheet.name,
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
        
        // Handle Excel files - send to AI with specialized prompt
        if (isExcel) {
          const mimeType = attachment.content_type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
          
          const excelPrompt = `Tu es un expert en analyse de fichiers Excel de cotation logistique et maritime.

Analyse ce fichier Excel de cotation et extrais TOUTES les données tarifaires.

INSTRUCTIONS IMPORTANTES:
1. Liste TOUS les onglets du fichier avec leur nom
2. Pour CHAQUE onglet, extrais TOUTES les lignes tarifaires avec montants
3. Identifie le type de cargo par onglet (dry containers, DG, OOG, transport, services)
4. Extrais les tarifs pour chaque type de conteneur (20', 40', etc.)
5. Préserve les catégories de poids (ex: <15t, <19t, <22t, <28t)
6. Extrais les tarifs de transport par destination si présents
7. Calcule les totaux par onglet si présents

Réponds UNIQUEMENT en JSON valide avec cette structure:
{
  "type": "quotation_excel",
  "sheetNames": ["Dry Containers", "DG Cargo", "Special IG", "Special OOG", "Services on Site", "Transport Tariffs"],
  "sheets": [
    {
      "name": "nom de l'onglet",
      "cargo_type": "container_dry|container_dg|container_oog|transport|services",
      "tariffs": [
        { "service": "DTHC", "amount": 182900, "currency": "FCFA", "unit": "20'", "container_type": "20' <15t", "notes": "TTC" }
      ],
      "totals": { "20_15t": 1168170, "40_22t": 1849584 }
    }
  ],
  "metadata": {
    "client": "nom si visible",
    "partner": "nom du partenaire/transitaire",
    "route": "origine -> destination", 
    "date": "date si visible",
    "incoterm": "DAP/FOB/etc si visible"
  },
  "tariff_lines": [
    { "service": "nom complet du service", "amount": 123456, "currency": "FCFA", "unit": "EVP", "container_type": "20'", "sheet_name": "Dry Containers" }
  ],
  "transport_destinations": [
    { "name": "Saint-Louis", "distance_km": 268, "rates": { "20_dry": 383500, "40_dry": 713900 } }
  ]
}`;

          console.log(`Sending Excel ${attachment.filename} to AI for analysis...`);
          
          // Send Excel file as base64 data URL
          const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${lovableApiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model: 'google/gemini-2.5-pro',  // Use Pro for complex Excel analysis
              messages: [
                { 
                  role: 'system', 
                  content: 'Tu es un expert en extraction de données de cotations logistiques depuis des fichiers Excel multi-onglets. Réponds uniquement en JSON valide.' 
                },
                { 
                  role: 'user', 
                  content: [
                    { type: 'text', text: excelPrompt },
                    { 
                      type: 'file', 
                      file: {
                        filename: attachment.filename,
                        file_data: `data:${mimeType};base64,${base64}`
                      }
                    }
                  ]
                }
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
          results.push({
            id: attachment.id,
            filename: attachment.filename,
            type: extractedData?.type || 'unknown',
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