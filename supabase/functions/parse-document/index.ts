import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs";
import { requireUser } from "../_shared/auth.ts";

const PDF_WORKER_SRC =
  "https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.worker.mjs";

try {
  // Required by pdfjs-dist in non-browser runtimes
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
} catch (e) {
  console.warn("Unable to set PDF.js workerSrc:", e);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

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

    // Correctif 3: Validation taille côté serveur (10 MB max)
    const MAX_FILE_SIZE = 10 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return new Response(
        JSON.stringify({ error: 'Fichier trop volumineux (max 10 MB)' }),
        { status: 413, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const fileExt = file.name.split('.').pop()?.toLowerCase();
    // Sanitize filename for storage - remove special chars, spaces, accents
    const sanitizedName = file.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace special chars with underscore
      .replace(/_+/g, '_'); // Remove multiple underscores
    const fileName = `${Date.now()}-${sanitizedName}`;
    
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

    // Helper function to sanitize text for database storage
    const sanitizeText = (text: string): string => {
      return text
        .replace(/\u0000/g, '') // Remove null characters
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Remove control characters except newline, tab, carriage return
        .replace(/\\u0000/g, '') // Remove escaped null sequences
        .trim();
    };

    if (fileExt === 'pdf') {
      try {
        // 1) Try local extraction with PDF.js (no network, avoids gibberish)
        try {
          const loadingTask = pdfjsLib.getDocument({
            data: uint8Array,
            disableWorker: true,
          } as any);

          const pdf = await loadingTask.promise;
          const pagesText: string[] = [];

          for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
            const page = await pdf.getPage(pageNo);
            const textContent = await page.getTextContent();
            const pageText = (textContent.items as any[])
              .map((it) => (it?.str ?? ''))
              .filter((s) => typeof s === 'string' && s.trim().length > 0)
              .join(' ');
            pagesText.push(pageText);
          }

          const fullText = sanitizeText(pagesText.join('\n\n'));

          if (!fullText || fullText.length < 50) {
            throw new Error('PDF.js extraction produced empty/short text');
          }

          extractedText = fullText;
          extractedData = {
            type: 'pdf',
            rawSize: uint8Array.length,
            pages: pdf.numPages,
            extractionMethod: 'pdfjs',
          };

          console.log('PDF.js extraction successful, text length:', extractedText.length);
        } catch (pdfjsError) {
          console.warn('PDF.js extraction failed, falling back to AI:', pdfjsError);

          // 2) Fallback: AI extraction (chunked base64 to avoid stack overflow)
          const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

          if (!LOVABLE_API_KEY) {
            extractedText = '[PDF détecté - extraction texte indisponible]';
            extractedData = {
              type: 'pdf',
              rawSize: uint8Array.length,
              extractionMethod: 'none',
            };
          } else {
            const bytesToBase64 = (bytes: Uint8Array): string => {
              const chunkSize = 8192;
              let binary = '';
              for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
              }
              return btoa(binary);
            };

            const base64Pdf = bytesToBase64(uint8Array);

            console.log('Sending PDF to AI for text extraction...');

            const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash',
                messages: [
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: `Extrais TOUT le texte de ce document PDF. Conserve la structure (titres, paragraphes, tableaux, listes). Ne résume pas, ne commente pas, extrais simplement tout le contenu textuel visible.`
                      },
                      {
                        type: 'file',
                        file: {
                          filename: file.name,
                          file_data: `data:application/pdf;base64,${base64Pdf}`
                        }
                      }
                    ]
                  }
                ],
                max_tokens: 8192,
              }),
            });

            if (aiResponse.ok) {
              const aiData = await aiResponse.json();
              const content = aiData.choices?.[0]?.message?.content;
              const aiText = typeof content === 'string' ? content : JSON.stringify(content ?? '');

              extractedText = sanitizeText(aiText);
              extractedData = {
                type: 'pdf',
                rawSize: uint8Array.length,
                extractionMethod: 'ai',
              };

              console.log('AI extraction successful, text length:', extractedText.length);
            } else {
              const errorText = await aiResponse.text();
              console.error('AI extraction failed:', aiResponse.status, errorText);

              extractedText = '[Erreur lors de l\'extraction IA du PDF]';
              extractedData = {
                type: 'pdf',
                rawSize: uint8Array.length,
                extractionMethod: 'ai',
                aiStatus: aiResponse.status,
              };
            }
          }
        }
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
      extractedText = sanitizeText(new TextDecoder().decode(uint8Array));
    } else {
      extractedText = '[Format non supporté pour l\'extraction de texte]';
    }

    // Ensure text is sanitized before database insertion
    extractedText = sanitizeText(extractedText);

    // Detect document type based on content
    const docType = detectDocumentType(extractedText);
    
    // Save to database
    const { data: docData, error: docError } = await supabase
      .from('documents')
      .insert({
        filename: sanitizeText(file.name),
        file_type: fileExt,
        file_size: file.size,
        content_text: extractedText.substring(0, 2000000), // Limit text size
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
