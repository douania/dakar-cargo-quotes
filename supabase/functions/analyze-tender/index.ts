import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TENDER_EXTRACTION_PROMPT = `Tu es un expert en extraction de données de tenders logistiques UN/MINUSCA.

Analyse ce document tender et extrais TOUTES les informations en JSON structuré:

{
  "metadata": {
    "reference": "RFPS-XXXX ou numéro de référence",
    "client": "MINUSCA, UNMISS, etc.",
    "tender_type": "un_demobilization | un_rotation | private | government",
    "origin_country": "RCA, Mali, etc.",
    "deadline": "YYYY-MM-DD si mentionné"
  },
  "contingents": [
    {
      "contingent_name": "PAKISTAN, EGYPT, SENEGAL, etc.",
      "origin_location": "Ville RCA: KAGA BANDORO, BAMBARI, NDELE, etc.",
      "destination_port": "Port final: Karachi, Alexandria, Dakar, etc.",
      "destination_site": "Site final si différent du port",
      "rfps_number": "Numéro RFPS spécifique si présent",
      "cargo_teus": "Nombre TEUs (conteneurs équivalent 20 pieds)",
      "cargo_vehicles": "Nombre de véhicules",
      "cargo_tonnes": "Tonnage total",
      "cargo_cbm": "Volume en m³",
      "cargo_readiness": "Date disponibilité cargo YYYY-MM-DD",
      "loading_date_pol": "Date chargement port YYYY-MM-DD",
      "deadline_ddd": "Delivery Deadline Date YYYY-MM-DD"
    }
  ],
  "segments_identified": [
    {
      "segment_order": 1,
      "segment_type": "inland_rca | transit_cameroon | ocean_freight",
      "origin": "Lieu départ",
      "destination": "Lieu arrivée",
      "transport_mode": "road | rail | sea",
      "notes": "Observations"
    }
  ],
  "cargo_summary": {
    "total_teus": 0,
    "total_vehicles": 0,
    "total_tonnes": 0,
    "total_cbm": 0,
    "contingent_count": 0
  },
  "extraction_notes": "Commentaires sur la qualité d'extraction, données manquantes, etc."
}

INSTRUCTIONS CRITIQUES:
1. Extrais CHAQUE ligne du tableau des contingents, même si les données sont partielles
2. Pour les dates, convertis au format YYYY-MM-DD
3. Pour les nombres, extrais uniquement la valeur numérique
4. Si une donnée est illisible ou manquante, mets null
5. Identifie les segments logiques du transport (RCA intérieur → Bangui → Douala → Destination finale)
6. Le cargo_summary doit additionner tous les contingents

Réponds UNIQUEMENT avec le JSON valide, sans texte avant ou après.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { attachmentId, documentText, emailId, createProject } = await req.json();
    
    console.log('[analyze-tender] Starting analysis', { attachmentId, emailId, hasText: !!documentText });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let textToAnalyze = documentText;

    // If attachmentId provided, fetch the extracted text
    if (attachmentId && !documentText) {
      console.log('[analyze-tender] Fetching attachment text', { attachmentId });
      
      const { data: attachment, error: attachmentError } = await supabase
        .from('email_attachments')
        .select('extracted_text, filename, email_id')
        .eq('id', attachmentId)
        .single();

      if (attachmentError || !attachment) {
        throw new Error(`Attachment not found: ${attachmentError?.message}`);
      }

      textToAnalyze = attachment.extracted_text;
      
      if (!textToAnalyze) {
        throw new Error('Attachment has no extracted text. Please analyze it first.');
      }
    }

    if (!textToAnalyze) {
      throw new Error('No document text provided for analysis');
    }

    console.log('[analyze-tender] Calling AI for extraction, text length:', textToAnalyze.length);

    // Call Lovable AI for extraction
    const lovableApiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const aiResponse = await fetch("https://api.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${lovableApiKey}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: TENDER_EXTRACTION_PROMPT },
          { role: "user", content: `Analyse ce document tender:\n\n${textToAnalyze.substring(0, 50000)}` }
        ],
        temperature: 0.1,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('[analyze-tender] AI API error:', errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const responseText = aiData.choices?.[0]?.message?.content || '';
    
    console.log('[analyze-tender] AI response received, length:', responseText.length);

    // Parse the JSON response
    let extractedData;
    try {
      // Clean the response - remove markdown code blocks if present
      let cleanedResponse = responseText.trim();
      if (cleanedResponse.startsWith('```json')) {
        cleanedResponse = cleanedResponse.slice(7);
      }
      if (cleanedResponse.startsWith('```')) {
        cleanedResponse = cleanedResponse.slice(3);
      }
      if (cleanedResponse.endsWith('```')) {
        cleanedResponse = cleanedResponse.slice(0, -3);
      }
      
      extractedData = JSON.parse(cleanedResponse.trim());
    } catch (parseError) {
      console.error('[analyze-tender] Failed to parse AI response:', responseText.substring(0, 500));
      throw new Error('Failed to parse tender extraction response');
    }

    console.log('[analyze-tender] Extracted data:', {
      contingentsCount: extractedData.contingents?.length || 0,
      segmentsCount: extractedData.segments_identified?.length || 0,
      metadata: extractedData.metadata
    });

    // If createProject is true, create the tender project in DB
    let projectId: string | null = null;
    if (createProject && extractedData.metadata) {
      console.log('[analyze-tender] Creating tender project in DB');

      const { data: project, error: projectError } = await supabase
        .from('tender_projects')
        .insert({
          reference: extractedData.metadata.reference || `TENDER-${Date.now()}`,
          client: extractedData.metadata.client,
          tender_type: extractedData.metadata.tender_type,
          origin_country: extractedData.metadata.origin_country,
          deadline: extractedData.metadata.deadline,
          source_email_id: emailId || null,
          source_attachment_id: attachmentId || null,
          cargo_summary: extractedData.cargo_summary || {},
          status: 'draft'
        })
        .select()
        .single();

      if (projectError) {
        console.error('[analyze-tender] Error creating project:', projectError);
      } else {
        projectId = project.id;
        console.log('[analyze-tender] Project created:', projectId);

        // Insert contingents
        if (extractedData.contingents && extractedData.contingents.length > 0) {
          const contingentsToInsert = extractedData.contingents.map((c: any) => ({
            tender_id: projectId,
            contingent_name: c.contingent_name || 'Unknown',
            origin_location: c.origin_location,
            destination_port: c.destination_port,
            destination_site: c.destination_site,
            rfps_number: c.rfps_number,
            cargo_teus: parseInt(c.cargo_teus) || 0,
            cargo_vehicles: parseInt(c.cargo_vehicles) || 0,
            cargo_tonnes: parseFloat(c.cargo_tonnes) || 0,
            cargo_cbm: parseFloat(c.cargo_cbm) || 0,
            deadline_ddd: c.deadline_ddd,
            cargo_readiness: c.cargo_readiness,
            loading_date_pol: c.loading_date_pol,
            status: 'pending'
          }));

          const { error: contingentsError } = await supabase
            .from('tender_contingents')
            .insert(contingentsToInsert);

          if (contingentsError) {
            console.error('[analyze-tender] Error inserting contingents:', contingentsError);
          } else {
            console.log('[analyze-tender] Inserted', contingentsToInsert.length, 'contingents');
          }
        }

        // Insert segments
        if (extractedData.segments_identified && extractedData.segments_identified.length > 0) {
          const segmentsToInsert = extractedData.segments_identified.map((s: any) => ({
            tender_id: projectId,
            segment_order: s.segment_order || 1,
            segment_type: s.segment_type || 'unknown',
            origin_location: s.origin || '',
            destination_location: s.destination || '',
            status: 'pending',
            notes: s.notes
          }));

          const { error: segmentsError } = await supabase
            .from('tender_segments')
            .insert(segmentsToInsert);

          if (segmentsError) {
            console.error('[analyze-tender] Error inserting segments:', segmentsError);
          } else {
            console.log('[analyze-tender] Inserted', segmentsToInsert.length, 'segments');
          }
        }
      }
    }

    return new Response(JSON.stringify({
      success: true,
      data: extractedData,
      projectId,
      contingentsCount: extractedData.contingents?.length || 0,
      segmentsCount: extractedData.segments_identified?.length || 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[analyze-tender] Error:', errorMessage);
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
