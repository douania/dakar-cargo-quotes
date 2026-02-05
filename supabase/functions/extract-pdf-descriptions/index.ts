import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExtractedCode {
  code: string;
  codeNormalized: string;
  description: string;
}

// Normalize HS code: remove dots and leading zeros inconsistencies
function normalizeCode(code: string): string {
  // Remove all dots and spaces
  let normalized = code.replace(/[\.\s]/g, '');
  // Remove leading zeros if the result is longer than 10 digits
  // Standard HS codes are 10 digits
  if (normalized.length > 10) {
    normalized = normalized.slice(0, 10);
  }
  // Pad with zeros if needed to get 10 digits
  while (normalized.length < 10) {
    normalized += '0';
  }
  return normalized;
}

// Parse PDF text to extract HS codes and descriptions
function extractCodesFromText(text: string): ExtractedCode[] {
  const codes: ExtractedCode[] = [];
  const lines = text.split('\n');
  
  // Pattern to match HS codes like "0101.21.00.00" or "01.01" etc.
  const codePattern = /^[\s]*(\d{2,4}(?:\.\d{2}){0,4}(?:\.\d{2})?(?:\s*\d{2,4})?)\s+(.+)$/;
  // Alternative pattern for codes at start of line
  const altPattern = /^(\d{4}\.\d{2}\.\d{2}\.\d{2})\s+(.+)$/;
  // Pattern for section headers like "0101" or "01.01"
  const headerPattern = /^(\d{2}(?:\.\d{2}){0,3})\s+[-–]\s*(.+)$/;
  
  let currentDescription = '';
  let currentCode = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Try to match full HS code (10 digits format: XXXX.XX.XX.XX)
    const fullMatch = line.match(/^(\d{4}\.\d{2}\.\d{2}\.\d{2})\s+(.+)$/);
    if (fullMatch) {
      const [, code, desc] = fullMatch;
      const normalized = normalizeCode(code);
      codes.push({
        code: code,
        codeNormalized: normalized,
        description: desc.trim()
      });
      continue;
    }
    
    // Try shorter format codes
    const shortMatch = line.match(/^(\d{4}\.\d{2}\.\d{2})\s+(.+)$/);
    if (shortMatch) {
      const [, code, desc] = shortMatch;
      const normalized = normalizeCode(code);
      codes.push({
        code: code,
        codeNormalized: normalized,
        description: desc.trim()
      });
      continue;
    }
    
    // Try even shorter format
    const veryShortMatch = line.match(/^(\d{4}\.\d{2})\s+(.+)$/);
    if (veryShortMatch) {
      const [, code, desc] = veryShortMatch;
      const normalized = normalizeCode(code);
      codes.push({
        code: code,
        codeNormalized: normalized,
        description: desc.trim()
      });
      continue;
    }
    
    // Try NTS column format (N.T.S. | Description)
    const ntsMatch = line.match(/(\d{4}\.\d{2}(?:\.\d{2}){0,2})\s*\|\s*(.+)/);
    if (ntsMatch) {
      const [, code, desc] = ntsMatch;
      const normalized = normalizeCode(code);
      codes.push({
        code: code,
        codeNormalized: normalized,
        description: desc.trim()
      });
      continue;
    }
  }
  
  return codes;
}

// Enhanced extraction using AI for complex PDF parsing
async function extractWithAI(text: string, apiKey: string): Promise<ExtractedCode[]> {
  const chunks: string[] = [];
  const chunkSize = 15000; // Characters per chunk
  
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  
  const allCodes: ExtractedCode[] = [];
  
  for (const chunk of chunks) {
    try {
      const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            {
              role: 'system',
              content: `Tu es un expert en nomenclature douanière. Extrait les codes HS et leurs descriptions du texte fourni.
              
IMPORTANT:
- Les codes HS sont au format XXXX.XX.XX.XX (ex: 0101.21.00.00)
- Retourne UNIQUEMENT un tableau JSON avec les objets {code, description}
- Ne retourne PAS de markdown, juste le JSON brut
- Si tu ne trouves pas de codes, retourne []`
            },
            {
              role: 'user',
              content: `Extrait tous les codes HS et descriptions de ce texte. Retourne un tableau JSON:\n\n${chunk}`
            }
          ],
          temperature: 0.1,
          max_tokens: 8000
        }),
      });

      if (!response.ok) {
        console.error('AI API error:', response.status);
        continue;
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      
      // Clean the response - remove markdown code blocks if present
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7);
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3);
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3);
      }
      jsonStr = jsonStr.trim();
      
      try {
        const parsed = JSON.parse(jsonStr);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item.code && item.description) {
              const normalized = normalizeCode(item.code);
              allCodes.push({
                code: item.code,
                codeNormalized: normalized,
                description: item.description
              });
            }
          }
        }
      } catch (parseError) {
        console.error('JSON parse error:', parseError);
      }
    } catch (error) {
      console.error('AI extraction error:', error);
    }
  }
  
  return allCodes;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { documentId, pdfText, useAI = true } = await req.json();

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let effectiveText = typeof pdfText === 'string' ? pdfText : '';
    let sourceLabel = 'pdfText';

    if (documentId) {
      const { data: doc, error: docError } = await supabase
        .from('documents')
        .select('content_text, filename')
        .eq('id', documentId)
        .single();

      if (docError || !doc) {
        return new Response(
          JSON.stringify({ error: 'Document introuvable' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      effectiveText = doc.content_text || '';
      sourceLabel = doc.filename || 'document';
    }

    if (!effectiveText) {
      return new Response(
        JSON.stringify({ error: 'pdfText ou documentId est requis' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Starting extraction from PDF text...');
    console.log('Source:', sourceLabel);
    console.log('Text length:', effectiveText.length);

    let extractedCodes: ExtractedCode[] = [];

    // First try regex-based extraction
    extractedCodes = extractCodesFromText(effectiveText);
    console.log('Regex extraction found:', extractedCodes.length, 'codes');

    // If regex didn't find much and AI is enabled, use AI
    if (extractedCodes.length < 100 && useAI && lovableApiKey) {
      console.log('Using AI for enhanced extraction...');
      const aiCodes = await extractWithAI(effectiveText, lovableApiKey);
      console.log('AI extraction found:', aiCodes.length, 'codes');

      // Merge results, preferring AI descriptions
      const codeMap = new Map<string, ExtractedCode>();
      for (const code of extractedCodes) {
        codeMap.set(code.codeNormalized, code);
      }
      for (const code of aiCodes) {
        codeMap.set(code.codeNormalized, code);
      }
      extractedCodes = Array.from(codeMap.values());
    }
    
    console.log('Total unique codes extracted:', extractedCodes.length);
    
    // Update database with descriptions
    let updated = 0;
    let notFound = 0;
    const notFoundCodes: string[] = [];
    
    for (const item of extractedCodes) {
      // Try to find by normalized code
      const { data: existing, error: selectError } = await supabase
        .from('hs_codes')
        .select('id, code, code_normalized')
        .or(`code_normalized.eq.${item.codeNormalized},code.eq.${item.codeNormalized}`)
        .limit(1);
      
      if (selectError) {
        console.error('Select error:', selectError);
        continue;
      }
      
      if (existing && existing.length > 0) {
        const { error: updateError } = await supabase
          .from('hs_codes')
          .update({ description: item.description })
          .eq('id', existing[0].id);
        
        if (updateError) {
          console.error('Update error for', item.code, ':', updateError);
        } else {
          updated++;
        }
      } else {
        notFound++;
        if (notFoundCodes.length < 20) {
          notFoundCodes.push(item.code);
        }
      }
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        extracted: extractedCodes.length,
        updated,
        notFound,
        notFoundSample: notFoundCodes,
        message: `Extraction terminée: ${updated} descriptions mises à jour sur ${extractedCodes.length} codes extraits`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in extract-pdf-descriptions:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
