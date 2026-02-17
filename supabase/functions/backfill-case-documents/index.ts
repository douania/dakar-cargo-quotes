import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireAdmin } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Admin-only operation
    const auth = await requireAdmin(req);
    if (auth instanceof Response) return auth;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const { case_id } = await req.json().catch(() => ({ case_id: null }));

    // Find case_documents without extracted_text
    let query = supabase
      .from("case_documents")
      .select("id, case_id, file_name, storage_path, mime_type")
      .is("extracted_text", null);

    if (case_id) {
      query = query.eq("case_id", case_id);
    }

    const { data: docs, error: fetchError } = await query.limit(50);
    if (fetchError) throw fetchError;

    if (!docs || docs.length === 0) {
      return new Response(
        JSON.stringify({ message: "No documents to backfill", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Backfill: ${docs.length} documents to process`);

    const results: { id: string; file_name: string; status: string; error?: string }[] = [];

    for (const doc of docs) {
      try {
        // Download file from storage
        const { data: fileData, error: dlError } = await supabase.storage
          .from("case-documents")
          .download(doc.storage_path);

        if (dlError || !fileData) {
          results.push({ id: doc.id, file_name: doc.file_name, status: "error", error: `Download failed: ${dlError?.message}` });
          continue;
        }

        // Build FormData for parse-document
        const formData = new FormData();
        const file = new File([fileData], doc.file_name, { type: doc.mime_type || "application/octet-stream" });
        formData.append("file", file);
        formData.append("case_document_id", doc.id);

        // Call parse-document internally
        const parseResponse = await fetch(`${supabaseUrl}/functions/v1/parse-document`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${auth.token}`,
          },
          body: formData,
        });

        if (!parseResponse.ok) {
          const errText = await parseResponse.text();
          results.push({ id: doc.id, file_name: doc.file_name, status: "error", error: `parse-document ${parseResponse.status}: ${errText.slice(0, 200)}` });
          continue;
        }

        results.push({ id: doc.id, file_name: doc.file_name, status: "ok" });
        console.log(`Backfill OK: ${doc.file_name}`);
      } catch (docErr) {
        const msg = docErr instanceof Error ? docErr.message : String(docErr);
        results.push({ id: doc.id, file_name: doc.file_name, status: "error", error: msg });
      }
    }

    const okCount = results.filter((r) => r.status === "ok").length;
    const errCount = results.filter((r) => r.status === "error").length;

    return new Response(
      JSON.stringify({ processed: docs.length, ok: okCount, errors: errCount, results }),
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
