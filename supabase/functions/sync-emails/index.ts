import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Quotation-related keywords
const QUOTATION_KEYWORDS = [
  'cotation', 'devis', 'quote', 'quotation', 'pricing', 'tarif',
  'demande de prix', 'prix', 'offre', 'proposition', 'estimation',
  'import', 'export', 'transport', 'fret', 'freight', 'shipping',
  'conteneur', 'container', 'roro', 'breakbulk', 'maritime', 'aérien',
  'dédouanement', 'customs', 'clearance', 'transit'
];

function isQuotationRelated(subject: string, body: string): boolean {
  const text = `${subject} ${body}`.toLowerCase();
  return QUOTATION_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

function extractThreadId(messageId: string, references: string): string {
  // Use references or in-reply-to to group emails in threads
  if (references) {
    const refs = references.split(/\s+/);
    return refs[0] || messageId;
  }
  return messageId;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { configId, searchQuery, limit = 50 } = await req.json();
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Syncing emails for config:", configId);

    // Get email config
    const { data: config, error: configError } = await supabase
      .from('email_configs')
      .select('*')
      .eq('id', configId)
      .single();

    if (configError || !config) {
      throw new Error("Configuration email non trouvée");
    }

    // For now, simulate IMAP reading since Deno doesn't have native IMAP
    // In production, you would use a third-party service or a custom IMAP library
    // This is a placeholder that demonstrates the structure
    
    console.log(`Connecting to ${config.host}:${config.port} as ${config.username}`);
    
    // Simulated response structure - replace with real IMAP implementation
    // You could use services like: Nylas, Context.IO, or implement via webhook with n8n
    const simulatedEmails = [
      {
        messageId: `<simulated-${Date.now()}@example.com>`,
        from: "client@example.com",
        to: [config.username],
        subject: "Demande de cotation - Import conteneur 40' de Chine",
        body: `Bonjour,

Nous souhaitons importer un conteneur 40' HC de Shanghai vers Dakar.
Marchandise: Pièces automobiles
Incoterm: FOB Shanghai
Date d'expédition souhaitée: Janvier 2025

Merci de nous faire parvenir votre meilleure offre.

Cordialement,
Client Example`,
        date: new Date().toISOString(),
        references: ""
      }
    ];

    // Process and store emails
    const processedEmails = [];
    
    for (const email of simulatedEmails) {
      const isQuotation = isQuotationRelated(email.subject, email.body);
      const threadId = extractThreadId(email.messageId, email.references);
      
      // Check if email already exists
      const { data: existing } = await supabase
        .from('emails')
        .select('id')
        .eq('message_id', email.messageId)
        .maybeSingle();

      if (existing) {
        console.log("Email already exists:", email.messageId);
        continue;
      }

      const { data: inserted, error: insertError } = await supabase
        .from('emails')
        .insert({
          email_config_id: configId,
          message_id: email.messageId,
          thread_id: threadId,
          from_address: email.from,
          to_addresses: email.to,
          subject: email.subject,
          body_text: email.body,
          sent_at: email.date,
          is_quotation_request: isQuotation
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error inserting email:", insertError);
        continue;
      }

      processedEmails.push(inserted);
      
      // If it's a quotation request, trigger learning
      if (isQuotation && inserted) {
        console.log("Quotation detected, triggering learning...");
        // Learning will be done by learn-from-content function
      }
    }

    // Update last sync time
    await supabase
      .from('email_configs')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('id', configId);

    console.log(`Synced ${processedEmails.length} new emails`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        synced: processedEmails.length,
        emails: processedEmails,
        message: "Note: Implémentation IMAP complète requiert un service tiers (Nylas, n8n webhook, etc.)"
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Sync error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Erreur de synchronisation" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
