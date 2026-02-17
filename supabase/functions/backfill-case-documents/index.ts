import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.mjs";
import { corsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

try {
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc =
    "https://esm.sh/pdfjs-dist@4.0.379/legacy/build/pdf.worker.mjs";
} catch (_) { /* ignore */ }

const sanitizeText = (text: string): string =>
  text
    .replace(/\u0000/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\\u0000/g, "")
    .trim();

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { case_id } = await req.json().catch(() => ({ case_id: null }));

    // Find ONE document without extracted_text
    let query = supabase
      .from("case_documents")
      .select("id, case_id, file_name, storage_path, mime_type")
      .is("extracted_text", null)
      .limit(1);

    if (case_id) query = query.eq("case_id", case_id);

    const { data: docs, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    if (!docs || docs.length === 0) {
      let cq = supabase.from("case_documents").select("id", { count: "exact", head: true });
      if (case_id) cq = cq.eq("case_id", case_id);
      const { count } = await cq;
      return new Response(
        JSON.stringify({ message: "All documents already have extracted_text", total_documents: count, remaining: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const doc = docs[0];
    console.log(`Backfill: processing ${doc.file_name} (${doc.id})`);

    // Download file from storage
    const { data: fileData, error: dlError } = await supabase.storage
      .from("case-documents")
      .download(doc.storage_path);

    if (dlError || !fileData) {
      throw new Error(`Download failed for ${doc.file_name}: ${dlError?.message}`);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    const ext = doc.file_name.split(".").pop()?.toLowerCase();
    let extractedText = "";

    if (ext === "pdf") {
      // Try pdfjs first
      try {
        const loadingTask = pdfjsLib.getDocument({ data: uint8Array, disableWorker: true } as any);
        const pdf = await loadingTask.promise;
        const pages: string[] = [];
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const tc = await page.getTextContent();
          pages.push(
            (tc.items as any[]).map((it) => it?.str ?? "").filter((s: string) => s.trim().length > 0).join(" ")
          );
        }
        extractedText = sanitizeText(pages.join("\n\n"));
        console.log(`pdfjs OK: ${extractedText.length} chars, ${pdf.numPages} pages`);
      } catch (pdfjsErr) {
        console.warn("pdfjs failed, trying AI fallback:", pdfjsErr);
      }

      // If pdfjs gave too little text, try AI
      if (extractedText.length < 50) {
        const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
        if (LOVABLE_API_KEY) {
          const chunkSize = 8192;
          let binary = "";
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            binary += String.fromCharCode(...uint8Array.subarray(i, i + chunkSize));
          }
          const base64Pdf = btoa(binary);

          const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [{
                role: "user",
                content: [
                  { type: "text", text: "Extrais TOUT le texte de ce document PDF. Conserve la structure. Ne résume pas." },
                  { type: "file", file: { filename: doc.file_name, file_data: `data:application/pdf;base64,${base64Pdf}` } },
                ],
              }],
              max_tokens: 8192,
            }),
          });

          if (aiResp.ok) {
            const aiData = await aiResp.json();
            const content = aiData.choices?.[0]?.message?.content;
            extractedText = sanitizeText(typeof content === "string" ? content : JSON.stringify(content ?? ""));
            console.log(`AI extraction OK: ${extractedText.length} chars`);
          } else {
            console.error("AI extraction failed:", aiResp.status);
            extractedText = "[Extraction échouée]";
          }
        } else {
          extractedText = "[PDF - extraction indisponible]";
        }
      }
    } else {
      // Non-PDF: just decode as text
      extractedText = sanitizeText(new TextDecoder().decode(uint8Array));
    }

    // Update case_documents.extracted_text directly
    const { error: updateError } = await supabase
      .from("case_documents")
      .update({ extracted_text: extractedText.substring(0, 200000) })
      .eq("id", doc.id);

    if (updateError) throw new Error(`Update failed: ${updateError.message}`);

    // Count remaining
    let rq = supabase.from("case_documents").select("id", { count: "exact", head: true }).is("extracted_text", null);
    if (case_id) rq = rq.eq("case_id", case_id);
    const { count: remaining } = await rq;

    console.log(`Backfill OK: ${doc.file_name}, text_length=${extractedText.length}, remaining=${remaining}`);

    return new Response(
      JSON.stringify({
        status: "ok",
        processed_file: doc.file_name,
        processed_id: doc.id,
        text_length: extractedText.length,
        remaining: remaining ?? 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Backfill error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
