/**
 * backfill-case-documents
 *
 * DCQ-P0-CASE-DOCUMENT-BACKFILL-BEFORE-PUZZLE v2
 *
 * Repare la chaine document -> extracted_text -> build-case-puzzle pour les
 * dossiers deja crees avec des case_documents non textifies (ex: PNG/JPG
 * uploades depuis Intake avant la stabilisation v5).
 *
 * Securite:
 *   - requireUser (et plus requireAdmin) car l'action doit etre disponible
 *     a tout operateur authentifie depuis CaseView.
 *   - Verification d'acces au case_id via client anon avec JWT utilisateur
 *     (RLS), sur le modele de set-case-fact. Le service role n'est utilise
 *     qu'apres pour le download storage et l'update extracted_text.
 *
 * Comportement:
 *   - case_id obligatoire.
 *   - Traite UN seul case_documents avec extracted_text IS NULL.
 *   - PDF: extraction via pdfjs (existant), fallback IA si trop court.
 *   - Images png/jpg/jpeg/webp/gif/bmp/tiff: OCR IA aligne strictement
 *     sur parse-document (meme modele, memes limites, meme prompt).
 *   - Autres extensions textuelles (txt, csv, md): decode UTF-8.
 *   - Met a jour case_documents.extracted_text (max 200000 chars).
 *   - Reponse: { status, processed_file, processed_id, text_length, remaining }.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as pdfjsLib from "npm:pdfjs-dist@4.4.168/legacy/build/pdf.mjs";
import { corsHeaders } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";

// pdfjs worker disabled (disableWorker: true used at call sites)

const IMAGE_EXTENSIONS = new Set([
  "jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif",
]);
const TEXT_EXTENSIONS = new Set(["txt", "csv", "md"]);

const sanitizeText = (text: string): string =>
  text
    // eslint-disable-next-line no-control-regex -- intentional: strips null chars before DB write
    .replace(/\u0000/g, "")
    // eslint-disable-next-line no-control-regex -- intentional: strips non-printable control chars before DB write
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\\u0000/g, "")
    .trim();

function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, i + CHUNK);
    parts.push(String.fromCharCode(...chunk));
  }
  return btoa(parts.join(""));
}

/**
 * OCR helper aligne strictement sur parse-document::extractTextFromImage.
 * Meme modele Lovable AI, meme prompt, meme limite 8MB, meme timeout 15s.
 */
async function extractTextFromImage(
  imageBytes: Uint8Array,
  mimeType: string,
  fileExt: string,
): Promise<string> {
  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    throw new Error("LOVABLE_API_KEY non configure pour OCR");
  }
  if (imageBytes.length > 8_000_000) {
    throw new Error("Image trop volumineuse pour OCR (max 8MB)");
  }

  const mime = mimeType || `image/${fileExt}`;
  const base64 = uint8ToBase64(imageBytes);

  console.log(
    "[backfill] OCR: sending image to AI, size:",
    imageBytes.length,
    "mime:",
    mime,
  );

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
                  "Retourne uniquement le texte brut tel qu'il apparait.",
              },
              {
                type: "image_url",
                image_url: { url: `data:${mime};base64,${base64}` },
              },
            ],
          }],
          temperature: 0,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[backfill] OCR AI error:", response.status, errorText);
      throw new Error(`OCR AI error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return typeof content === "string" ? content.trim() : "";
  } finally {
    clearTimeout(timeout);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // 1. Auth: any authenticated operator
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;

    const { case_id } = await req.json().catch(() => ({ case_id: null }));
    if (!case_id || typeof case_id !== "string") {
      return new Response(
        JSON.stringify({ error: "case_id is required" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 2. Ownership check via user-scoped client (RLS) — same pattern as set-case-fact
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });
    const { data: caseRow, error: caseErr } = await userClient
      .from("quote_cases")
      .select("id")
      .eq("id", case_id)
      .single();
    if (caseErr || !caseRow) {
      return new Response(
        JSON.stringify({ error: "Case not found or access denied" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 3. Service role for storage download + extracted_text update
    const supabase = createClient(supabaseUrl, serviceKey);

    // 4. Find ONE case_document for this case_id without extracted_text
    const { data: docs, error: fetchError } = await supabase
      .from("case_documents")
      .select("id, case_id, file_name, storage_path, mime_type")
      .eq("case_id", case_id)
      .is("extracted_text", null)
      .limit(1);
    if (fetchError) throw fetchError;

    if (!docs || docs.length === 0) {
      const { count } = await supabase
        .from("case_documents")
        .select("id", { count: "exact", head: true })
        .eq("case_id", case_id)
        .is("extracted_text", null);
      return new Response(
        JSON.stringify({
          status: "ok",
          message: "All documents already have extracted_text",
          remaining: count ?? 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const doc = docs[0];
    console.log(`[backfill] processing ${doc.file_name} (${doc.id})`);

    // 5. Download from storage
    const { data: fileData, error: dlError } = await supabase.storage
      .from("case-documents")
      .download(doc.storage_path);
    if (dlError || !fileData) {
      throw new Error(
        `Download failed for ${doc.file_name}: ${dlError?.message ?? "no data"}`,
      );
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const ext = (doc.file_name.split(".").pop() || "").toLowerCase();

    let extractedText = "";

    if (ext === "pdf") {
      // PDF: pdfjs first, AI fallback if too short
      try {
        const loadingTask = pdfjsLib.getDocument({
          data: uint8Array,
          disableWorker: true,
        // deno-lint-ignore no-explicit-any
        } as any);
        const pdf = await loadingTask.promise;
        const pages: string[] = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const tc = await page.getTextContent();
          pages.push(
            // deno-lint-ignore no-explicit-any
            (tc.items as any[])
              // deno-lint-ignore no-explicit-any
              .map((it: any) => it?.str ?? "")
              .filter((s: string) => s.trim().length > 0)
              .join(" "),
          );
        }
        extractedText = sanitizeText(pages.join("\n\n"));
        console.log(
          `[backfill] pdfjs OK: ${extractedText.length} chars, ${pdf.numPages} pages`,
        );
      } catch (pdfjsErr) {
        console.warn("[backfill] pdfjs failed, will try AI fallback:", pdfjsErr);
      }

      if (extractedText.length < 50) {
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        if (LOVABLE_API_KEY) {
          const base64Pdf = uint8ToBase64(uint8Array);
          const aiResp = await fetch(
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
                      text:
                        "Extrais TOUT le texte de ce document PDF. Conserve la structure. Ne resume pas.",
                    },
                    {
                      type: "file",
                      file: {
                        filename: doc.file_name,
                        file_data: `data:application/pdf;base64,${base64Pdf}`,
                      },
                    },
                  ],
                }],
                max_tokens: 8192,
              }),
            },
          );
          if (aiResp.ok) {
            const aiData = await aiResp.json();
            const content = aiData.choices?.[0]?.message?.content;
            extractedText = sanitizeText(
              typeof content === "string"
                ? content
                : JSON.stringify(content ?? ""),
            );
            console.log(`[backfill] AI PDF OK: ${extractedText.length} chars`);
          } else {
            console.error("[backfill] AI PDF failed:", aiResp.status);
            extractedText = "[Extraction echouee]";
          }
        } else {
          extractedText = "[PDF - extraction indisponible]";
        }
      }
    } else if (IMAGE_EXTENSIONS.has(ext)) {
      // Images: OCR IA aligne sur parse-document
      try {
        extractedText = sanitizeText(
          await extractTextFromImage(
            uint8Array,
            doc.mime_type || `image/${ext}`,
            ext,
          ),
        );
        if (!extractedText) {
          extractedText = "[OCR vide]";
        }
      } catch (ocrErr) {
        console.error("[backfill] OCR failed:", ocrErr);
        extractedText = "[Extraction echouee]";
      }
    } else if (TEXT_EXTENSIONS.has(ext)) {
      extractedText = sanitizeText(new TextDecoder().decode(uint8Array));
    } else {
      extractedText = "[Format non supporte pour l'extraction de texte]";
    }

    // 6. Update extracted_text (max 200000 chars)
    const { error: updateError } = await supabase
      .from("case_documents")
      .update({ extracted_text: extractedText.substring(0, 200000) })
      .eq("id", doc.id);
    if (updateError) throw new Error(`Update failed: ${updateError.message}`);

    // 7. Count remaining for this case_id
    const { count: remaining } = await supabase
      .from("case_documents")
      .select("id", { count: "exact", head: true })
      .eq("case_id", case_id)
      .is("extracted_text", null);

    console.log(
      `[backfill] OK: ${doc.file_name}, text_length=${extractedText.length}, remaining=${remaining}`,
    );

    return new Response(
      JSON.stringify({
        status: "ok",
        processed_file: doc.file_name,
        processed_id: doc.id,
        text_length: extractedText.length,
        remaining: remaining ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[backfill] error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
