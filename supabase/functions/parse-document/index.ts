import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const formData = await req.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing file:', file.name, 'Type:', file.type, 'Size:', file.size);

    const fileExt = file.name.split('.').pop()?.toLowerCase();
    const fileName = `${Date.now()}-${file.name}`;
    
    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('documents')
      .upload(fileName, file);

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    // Extract text based on file type
    let extractedText = '';
    let extractedData: any = null;
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    if (fileExt === 'pdf') {
      // For PDF, we'll extract what we can - basic text detection
      // Note: Full PDF parsing requires external service
      try {
        const textDecoder = new TextDecoder('utf-8', { fatal: false });
        const rawText = textDecoder.decode(uint8Array);
        
        // Extract readable text from PDF (basic approach)
        const textMatches = rawText.match(/\((.*?)\)/g) || [];
        const extractedParts = textMatches
          .map(m => m.slice(1, -1))
          .filter(t => t.length > 2 && /[a-zA-Z0-9àéèêëïîôùûüçÀÉÈÊËÏÎÔÙÛÜÇ]/.test(t))
          .join(' ');
        
        extractedText = extractedParts || '[PDF détecté - pour une extraction complète, utilisez l\'analyse IA]';
        extractedData = {
          type: 'pdf',
          rawSize: uint8Array.length,
        };
        console.log('PDF basic extraction done, text length:', extractedText.length);
      } catch (pdfError) {
        console.error('PDF parse error:', pdfError);
        extractedText = '[Erreur lors de la lecture du PDF]';
      }
    } else if (fileExt === 'xlsx' || fileExt === 'xls') {
      // Parse Excel using xlsx
      try {
        const workbook = XLSX.read(uint8Array, { type: 'array' });
        const sheets: any = {};
        
        workbook.SheetNames.forEach((sheetName: string) => {
          const sheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(sheet);
          const textData = XLSX.utils.sheet_to_csv(sheet, { FS: ';' });
          sheets[sheetName] = {
            rows: jsonData.length,
            data: jsonData.slice(0, 100), // Limit to first 100 rows
          };
          extractedText += `\n=== ${sheetName} ===\n${textData}\n`;
        });
        
        extractedData = {
          sheets: workbook.SheetNames,
          sheetData: sheets,
        };
        console.log('Excel parsed, sheets:', workbook.SheetNames.length);
      } catch (xlsxError) {
        console.error('Excel parse error:', xlsxError);
        extractedText = '[Erreur lors de la lecture du fichier Excel]';
      }
    } else if (fileExt === 'csv') {
      // Parse CSV
      try {
        const textContent = new TextDecoder().decode(uint8Array);
        extractedText = textContent;
        
        // Parse CSV to JSON
        const lines = textContent.split('\n').filter(l => l.trim());
        if (lines.length > 0) {
          const headers = lines[0].split(';').map(h => h.trim());
          const rows = lines.slice(1).map(line => {
            const values = line.split(';');
            const row: any = {};
            headers.forEach((h, i) => {
              row[h] = values[i]?.trim() || '';
            });
            return row;
          });
          extractedData = {
            headers,
            rowCount: rows.length,
            data: rows.slice(0, 100),
          };
        }
        console.log('CSV parsed, lines:', lines.length);
      } catch (csvError) {
        console.error('CSV parse error:', csvError);
      }
    } else if (fileExt === 'txt' || fileExt === 'md') {
      extractedText = new TextDecoder().decode(uint8Array);
    } else {
      extractedText = '[Format non supporté pour l\'extraction de texte]';
    }

    // Detect document type based on content
    const docType = detectDocumentType(extractedText);
    
    // Save to database
    const { data: docData, error: docError } = await supabase
      .from('documents')
      .insert({
        filename: file.name,
        file_type: fileExt,
        file_size: file.size,
        content_text: extractedText.substring(0, 100000), // Limit text size
        extracted_data: extractedData,
        source: 'upload',
        tags: docType.tags,
      })
      .select()
      .single();

    if (docError) {
      console.error('Database error:', docError);
      throw new Error(`Database insert failed: ${docError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        document: {
          id: docData.id,
          filename: file.name,
          file_type: fileExt,
          file_size: file.size,
          text_preview: extractedText.substring(0, 500) + (extractedText.length > 500 ? '...' : ''),
          extracted_data: extractedData,
          detected_type: docType,
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    console.error('Parse document error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function detectDocumentType(text: string): { type: string; tags: string[]; confidence: number } {
  const lowerText = text.toLowerCase();
  const tags: string[] = [];
  
  // Detect customs-related documents
  if (lowerText.includes('droit de douane') || lowerText.includes('débours') || lowerText.includes('dd ') || lowerText.includes('tva')) {
    tags.push('douane');
  }
  if (lowerText.includes('bl ') || lowerText.includes('bill of lading') || lowerText.includes('connaissement')) {
    tags.push('BL');
  }
  if (lowerText.includes('manifeste') || lowerText.includes('manifest')) {
    tags.push('manifeste');
  }
  if (lowerText.includes('facture') || lowerText.includes('invoice')) {
    tags.push('facture');
  }
  if (lowerText.includes('cotation') || lowerText.includes('devis') || lowerText.includes('quotation')) {
    tags.push('cotation');
  }
  if (lowerText.includes('proforma') || lowerText.includes('pro forma')) {
    tags.push('proforma');
  }
  if (lowerText.includes('dap ') || lowerText.includes('cif ') || lowerText.includes('fob ') || lowerText.includes('cfr ') || lowerText.includes('exw ')) {
    tags.push('incoterms');
  }
  if (lowerText.includes('conteneur') || lowerText.includes('container') || lowerText.includes('20\'') || lowerText.includes('40\'')) {
    tags.push('conteneur');
  }
  if (lowerText.includes('port autonome') || lowerText.includes('pad ') || lowerText.includes('dakar')) {
    tags.push('PAD');
  }
  
  // Determine main type
  let type = 'document';
  if (tags.includes('BL')) type = 'BL';
  else if (tags.includes('facture')) type = 'facture';
  else if (tags.includes('cotation')) type = 'cotation';
  else if (tags.includes('manifeste')) type = 'manifeste';
  else if (tags.includes('douane')) type = 'document_douanier';
  
  return {
    type,
    tags: tags.length > 0 ? tags : ['autre'],
    confidence: tags.length > 2 ? 0.9 : tags.length > 0 ? 0.7 : 0.3,
  };
}
