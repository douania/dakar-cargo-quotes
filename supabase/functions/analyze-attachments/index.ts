import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
        
        // Skip non-image files for now
        const isImage = attachment.content_type?.startsWith('image/');
        const isPdf = attachment.content_type === 'application/pdf';
        
        if (!isImage && !isPdf) {
          console.log(`Skipping non-visual file: ${attachment.content_type}`);
          // Mark as analyzed anyway
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
        
        // Convert to base64
        const arrayBuffer = await fileData.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        const mimeType = attachment.content_type || 'image/jpeg';
        const dataUrl = `data:${mimeType};base64,${base64}`;
        
        console.log(`Sending ${attachment.filename} to AI for analysis...`);
        
        // Analyze with Gemini Vision
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              {
                role: 'system',
                content: `Tu es un assistant expert en analyse de documents commerciaux et logistiques. 
Analyse l'image fournie et extrais toutes les informations pertinentes.
Pour les images de signatures email ou logos: identifie le nom, l'entreprise, le poste, les coordonnées.
Pour les documents: identifie le type (facture, bon de commande, connaissement, etc.), les données clés.
Réponds en JSON avec cette structure:
{
  "type": "signature|logo|document|image|unknown",
  "description": "description brève",
  "extracted_info": {
    // Informations extraites selon le type
  },
  "text_content": "tout texte visible dans l'image",
  "confidence": 0.0-1.0
}`
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Analyse cette image (${attachment.filename}) et extrais toutes les informations utiles.`
                  },
                  {
                    type: 'image_url',
                    image_url: { url: dataUrl }
                  }
                ]
              }
            ]
          }),
        });
        
        if (!aiResponse.ok) {
          const errorText = await aiResponse.text();
          console.error(`AI analysis failed for ${attachment.filename}:`, aiResponse.status, errorText);
          
          if (aiResponse.status === 402) {
            return new Response(
              JSON.stringify({ success: false, error: 'Crédits AI insuffisants. Veuillez recharger votre compte.' }),
              { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          
          continue;
        }
        
        const aiData = await aiResponse.json();
        const content = aiData.choices?.[0]?.message?.content || '';
        
        console.log(`AI response for ${attachment.filename}:`, content.substring(0, 200));
        
        // Parse the JSON response
        let extractedData: any = { raw_response: content };
        let extractedText = '';
        
        try {
          // Try to extract JSON from the response
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            extractedData = JSON.parse(jsonMatch[0]);
            extractedText = extractedData.text_content || extractedData.description || '';
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
