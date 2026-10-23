import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import * as pdfjsLib from "npm:pdfjs-dist@4.4.168/legacy/build/pdf.mjs";
import {openIntakeTicket,completeIntakeTicket,ticketResponse,ticketUnknown,ticketFailure,type IntakeTicketContext} from "../_shared/intake-document-ticket.ts";
import { requireUser } from "../_shared/auth.ts";
import { DocumentExtractionError, EXTRACTION_CONTRACT, extractionOutcome, hasExtractedText, sanitizeDocumentText } from '../_shared/document-extraction.ts';

// Worker disabled (disableWorker: true used at call sites)

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'tif'];

export async function handleParseDocument(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  let intakeTicket:IntakeTicketContext|null=null;let ticketRequested=false;
  try {
    // Phase S0: Auth guard
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const formData = await req.formData();
    let file = formData.get('file') as File;
    let source: {id:string;case_id:string;file_name:string;storage_path:string;mime_type:string|null;extracted_text:string|null} | null = null;
    const caseDocumentId = formData.get('case_document_id') as string | null;
    if(formData.has('intake_operation_id')||formData.has('intake_claim_id')){
      ticketRequested=true;
      if(formData.has('case_document_id'))return Response.json({ok:false,error:{code:'DOCUMENT_TICKET_INVALID',outcome:'BLOCKED'}},{status:400,headers:corsHeaders});
      intakeTicket=await openIntakeTicket(auth,{operation_id:formData.get('intake_operation_id'),claim_id:formData.get('intake_claim_id')},'extraction');
      if(!intakeTicket.started)return ticketResponse(intakeTicket.operation);
      file=intakeTicket.file; // Exact immutable Blob whose bytes/hash were verified.
    }

    
    if (caseDocumentId) {
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
        global: {headers: {Authorization: req.headers.get('Authorization')!}}, auth: {persistSession:false},
      });
      const read = await userClient.from('case_documents')
        .select('id,case_id,file_name,storage_path,mime_type,extracted_text').eq('id', caseDocumentId).maybeSingle();
      if (read.error || !read.data) return Response.json({success:false,error:'Document inaccessible'}, {status:403,headers:corsHeaders});
      source = read.data;
      if (hasExtractedText(source!.extracted_text)) return Response.json({success:true,extraction_contract:EXTRACTION_CONTRACT,
        extraction:{...extractionOutcome('extracted',source!.extracted_text!.length,true),replayed:true},
        document:{id:source!.id,filename:source!.file_name,text_preview:source!.extracted_text!.slice(0,500)}}, {headers:corsHeaders});
      // The stored source is authoritative; caller-supplied bytes cannot replace its evidence.
      const stored = await supabase.storage.from('case-documents').download(source!.storage_path);
      if (stored.error || !stored.data) throw new DocumentExtractionError('DOCUMENT_READ_FAILED');
      file = new File([stored.data], source!.file_name, {type:source!.mime_type || stored.data.type});
    }
    if (!(file instanceof File)) {
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

    const fileExt = (file.name.split('.').pop() || '').toLowerCase();
    // Sanitize filename for storage - remove special chars, spaces, accents
    const sanitizedName = file.name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/[^a-zA-Z0-9.-]/g, '_') // Replace special chars with underscore
      .replace(/_+/g, '_'); // Remove multiple underscores
    const fileName = `${Date.now()}-${sanitizedName}`;
    
    // Upload to storage — only when NOT in case_document mode
    // (CaseDocumentsTab already uploaded to bucket "case-documents")
    if (!caseDocumentId && !intakeTicket) {
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, file);

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw new Error(`Upload failed: ${uploadError.message}`);
      }
    }

    // Extract text based on file type
    let extractedText = '';
    let extractedData: any = null;
    let extractionError: DocumentExtractionError | null = null;
    const arrayBuffer = await file.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    const sanitizeText = sanitizeDocumentText;

    if (fileExt === 'pdf') {
      try {
        // 1) Try local extraction with PDF.js (no network, avoids gibberish)
        try {
          const loadingTask = pdfjsLib.getDocument({
            data: uint8Array.slice(),
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

          if (!hasExtractedText(fullText)) {
            throw new Error('PDF.js extraction produced empty/short text');
          }

          extractedText = fullText;
          extractedData = {
            type: 'pdf',
            rawSize: file.size,
            pages: pdf.numPages,
            extractionMethod: 'pdfjs',
          };

          console.log('PDF.js extraction successful, text length:', extractedText.length);
        } catch (pdfjsError) {
          console.warn('PDF.js extraction failed, falling back to AI:', pdfjsError);

          // 2) Fallback: AI extraction (chunked base64 to avoid stack overflow)
          const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');

          if (!LOVABLE_API_KEY) {
            extractedText = '';
            extractionError = new DocumentExtractionError('OCR_NOT_CONFIGURED',503);
            extractedData = {
              type: 'pdf',
              rawSize: file.size,
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
              signal: AbortSignal.timeout(15000),
            });

            if (aiResponse.ok) {
              const aiData = await aiResponse.json();
              const content = aiData.choices?.[0]?.message?.content;
              const aiText = typeof content === 'string' ? content : '';

              extractedText = sanitizeText(aiText);
              extractedData = {
                type: 'pdf',
                rawSize: file.size,
                extractionMethod: 'ai',
              };

              console.log('AI extraction successful, text length:', extractedText.length);
            } else {
              console.error('AI extraction failed:', aiResponse.status);

              extractedText = '';
              extractionError = new DocumentExtractionError('OCR_PROVIDER_FAILED');
              extractedData = {
                type: 'pdf',
                rawSize: file.size,
                extractionMethod: 'ai',
                aiStatus: aiResponse.status,
              };
            }
          }
        }
      } catch (pdfError) {
        console.error('PDF parse error:', pdfError);
        extractedText = '';
        extractionError = new DocumentExtractionError('OCR_PROVIDER_FAILED');
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
          if (sanitizeText(textData)) extractedText += `\n=== ${sheetName} ===\n${textData}\n`;
        });
        
        extractedData = {
          sheets: workbook.SheetNames,
          sheetData: sheets,
        };
        console.log('Excel parsed, sheets:', workbook.SheetNames.length);
      } catch (xlsxError) {
        console.error('Excel parse error:', xlsxError);
        extractedText = '';
        extractionError = new DocumentExtractionError('DOCUMENT_READ_FAILED');
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
    } else if (IMAGE_EXTENSIONS.includes(fileExt!)) {
      try {
        extractedText = await extractTextFromImage(uint8Array, file.type, fileExt!);
        extractedData = {
          type: 'image',
          rawSize: file.size,
          extractionMethod: 'ocr_ai',
        };
        if (!extractedText) {
          (extractedData as any).extractionStatus = 'empty';
        }
        console.log('OCR extraction done, text length:', extractedText.length);
      } catch (ocrError) {
        console.error('OCR extraction failed');
        extractionError = ocrError instanceof DocumentExtractionError ? ocrError : new DocumentExtractionError('OCR_PROVIDER_FAILED');
        extractedText = '';
        extractedData = {
          type: 'image',
          rawSize: file.size,
          extractionMethod: 'none',
          extractionStatus: 'error',
        } as any;
      }
    } else if (fileExt === 'txt' || fileExt === 'md') {
      extractedText = sanitizeText(new TextDecoder().decode(uint8Array));
    } else {
      extractedText = '';
      extractionError = new DocumentExtractionError('DOCUMENT_FORMAT_UNSUPPORTED',422);
    }

    // Ensure text is sanitized before database insertion
    extractedText = sanitizeText(extractedText);
    if (!extractionError && !hasExtractedText(extractedText)) extractionError = new DocumentExtractionError('DOCUMENT_TEXT_EMPTY',422);
    const storedLength = Math.min(extractedText.length, source ? 200000 : 2000000);
    const outcome = extractionOutcome(extractionError?.code === 'DOCUMENT_TEXT_EMPTY' ? 'empty' : extractionError ? 'error' : 'extracted', extractionError ? 0 : storedLength, !extractionError, extractionError?.code);
    extractedData = {...extractedData, extractionStatus:outcome.status};

    // Detect document type based on content
    const docType = detectDocumentType(extractedText);

    if(intakeTicket){
      if(extractionError)return ticketUnknown();
      return await completeIntakeTicket(intakeTicket,extractedText.substring(0,2000000),extractedText.substring(0,200000),{
        extraction_contract:EXTRACTION_CONTRACT,text_length:Math.min(extractedText.length,2000000),
        filename:sanitizeText(file.name),file_type:fileExt,file_size:file.size,
        text_preview:extractedText.substring(0,500)+(extractedText.length>500?'...':''),
        extracted_data:extractedData,detected_type:docType,tags:docType.tags,
      });
    }

    let documentId: string | null = null;

    if (source) {
      documentId = source.id;
      if (!extractionError) {
        let write = supabase.from('case_documents').update({extracted_text:extractedText.slice(0,200000)})
          .eq('id',source.id).eq('case_id',source.case_id).eq('storage_path',source.storage_path);
        write = source.extracted_text === null ? write.is('extracted_text',null) : write.eq('extracted_text',source.extracted_text);
        const saved = await write.select('id,extracted_text');
        if (saved.error) throw new DocumentExtractionError('DOCUMENT_WRITE_FAILED',500);
        if (!saved.data?.some(row => row.id === source!.id && row.extracted_text === extractedText.slice(0,200000))) {
          throw new DocumentExtractionError('DOCUMENT_CHANGED',409);
        }
      }
    } else {
      // ── Standalone mode: insert into documents table (existing behaviour) ──
      const { data: docData, error: docError } = await supabase
        .from('documents')
        .insert({
          filename: sanitizeText(file.name),
          file_type: fileExt,
          file_size: file.size,
          content_text: extractedText.substring(0, 2000000),
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
      documentId = docData.id;
    }

    return new Response(
      JSON.stringify({
        success: !extractionError,
        extraction_contract: EXTRACTION_CONTRACT,
        extraction: outcome,
        ...(extractionError ? {error:extractionError.message} : {}),
        document: {
          id: documentId,
          filename: file.name,
          file_type: fileExt,
          file_size: file.size,
          text_preview: extractedText.substring(0, 500) + (extractedText.length > 500 ? '...' : ''),
          extracted_data: extractedData,
          detected_type: docType,
        }
      }),
      { status: extractionError?.httpStatus ?? 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    if(ticketRequested)return intakeTicket?ticketUnknown():ticketFailure(error);
    console.error('Parse document error:', error);
    const failure = error instanceof DocumentExtractionError ? error : new DocumentExtractionError('EXTRACTION_UNAVAILABLE',500);
    return new Response(
      JSON.stringify({success:false,extraction_contract:EXTRACTION_CONTRACT,error:failure.message,extraction:extractionOutcome('error',0,false,failure.code)}),
      { status: failure.httpStatus, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
}
if (import.meta.main) serve(handleParseDocument);

// --- OCR helpers ---

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    parts.push(String.fromCharCode(...chunk));
  }
  return btoa(parts.join(""));
}

async function extractTextFromImage(
  imageBytes: Uint8Array,
  mimeType: string,
  fileExt: string,
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new DocumentExtractionError('OCR_NOT_CONFIGURED',503);
  }
  if (imageBytes.length > 8_000_000) {
    throw new Error("Image trop volumineuse pour OCR (max 8MB)");
  }

  const mime = mimeType || `image/${fileExt}`;
  const base64 = uint8ToBase64(imageBytes);

  console.log('OCR: sending image to AI, size:', imageBytes.length, 'mime:', mime);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [{
            role: "user",
            content: [
              {
                type: "text",
                text: "Extrais tout le texte visible de cette image. " +
                  "C'est un document logistique, transport ou douane. " +
                  "Ne fais aucun commentaire. Ne fais aucun resume. " +
                  "Ne reformule rien. " +
                  "Retourne uniquement le texte brut tel qu'il apparait."
              },
              {
                type: "image_url",
                image_url: { url: `data:${mime};base64,${base64}` }
              }
            ]
          }],
          temperature: 0,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      console.error('OCR AI error:', response.status);
      throw new DocumentExtractionError('OCR_PROVIDER_FAILED');
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" ? content.trim() : "";
  } finally {
    clearTimeout(timeout);
  }
}

// --- Document type detection ---

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
