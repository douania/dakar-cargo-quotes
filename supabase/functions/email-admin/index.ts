import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { action, data } = await req.json();

    console.log(`Email admin action: ${action}`);

    switch (action) {
      case 'get_all': {
        // Fetch all email-related data
        const [configsRes, emailsRes, draftsRes, attachmentsRes] = await Promise.all([
          supabase.from('email_configs').select('*').order('created_at', { ascending: false }),
          supabase.from('emails').select('*').order('sent_at', { ascending: false }).limit(100),
          supabase.from('email_drafts').select('*').order('created_at', { ascending: false }),
          supabase.from('email_attachments').select('email_id')
        ]);

        // Mask passwords in configs
        const configs = (configsRes.data || []).map(config => ({
          ...config,
          password_encrypted: '********' // Never expose passwords
        }));

        return new Response(
          JSON.stringify({
            success: true,
            configs,
            emails: emailsRes.data || [],
            drafts: draftsRes.data || [],
            attachments: attachmentsRes.data || []
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'add_config': {
        const { name, host, port, username, password, folder, use_ssl } = data;
        
        if (!name || !host || !username || !password) {
          throw new Error("Champs requis manquants");
        }

        const { data: config, error } = await supabase
          .from('email_configs')
          .insert({
            name,
            host,
            port: port || 993,
            username,
            password_encrypted: password,
            folder: folder || 'INBOX',
            use_ssl: use_ssl !== false
          })
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ 
            success: true, 
            config: { ...config, password_encrypted: '********' }
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'delete_config': {
        const { configId } = data;
        
        if (!configId) throw new Error("configId requis");

        const { error } = await supabase
          .from('email_configs')
          .delete()
          .eq('id', configId);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'delete_email': {
        const { emailId } = data;
        
        if (!emailId) throw new Error("emailId requis");

        // Get attachments to delete from storage
        const { data: attachments } = await supabase
          .from('email_attachments')
          .select('storage_path')
          .eq('email_id', emailId);

        // Delete files from storage
        if (attachments && attachments.length > 0) {
          const paths = attachments
            .filter(a => a.storage_path)
            .map(a => a.storage_path as string);
          
          if (paths.length > 0) {
            await supabase.storage.from('documents').remove(paths);
          }
        }

        // Delete attachments
        await supabase
          .from('email_attachments')
          .delete()
          .eq('email_id', emailId);

        // Delete related learned knowledge
        await supabase
          .from('learned_knowledge')
          .delete()
          .eq('source_id', emailId)
          .eq('source_type', 'email');

        // Delete related drafts
        await supabase
          .from('email_drafts')
          .delete()
          .eq('original_email_id', emailId);

        // Delete the email
        const { error } = await supabase
          .from('emails')
          .delete()
          .eq('id', emailId);

        if (error) throw error;

        console.log(`Deleted email ${emailId} and related data`);

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'delete_emails': {
        const { emailIds } = data;
        
        if (!emailIds || !Array.isArray(emailIds) || emailIds.length === 0) {
          throw new Error("emailIds requis (tableau)");
        }

        let deletedCount = 0;

        for (const emailId of emailIds) {
          try {
            // Get attachments
            const { data: attachments } = await supabase
              .from('email_attachments')
              .select('storage_path')
              .eq('email_id', emailId);

            // Delete files from storage
            if (attachments && attachments.length > 0) {
              const paths = attachments
                .filter(a => a.storage_path)
                .map(a => a.storage_path as string);
              
              if (paths.length > 0) {
                await supabase.storage.from('documents').remove(paths);
              }
            }

            // Delete attachments
            await supabase
              .from('email_attachments')
              .delete()
              .eq('email_id', emailId);

            // Delete related learned knowledge
            await supabase
              .from('learned_knowledge')
              .delete()
              .eq('source_id', emailId)
              .eq('source_type', 'email');

            // Delete related drafts
            await supabase
              .from('email_drafts')
              .delete()
              .eq('original_email_id', emailId);

            // Delete the email
            await supabase
              .from('emails')
              .delete()
              .eq('id', emailId);

            deletedCount++;
          } catch (err) {
            console.error(`Error deleting email ${emailId}:`, err);
          }
        }

        console.log(`Deleted ${deletedCount}/${emailIds.length} emails`);

        return new Response(
          JSON.stringify({ success: true, deleted: deletedCount }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'purge_non_quotation': {
        // Get all non-quotation emails
        const { data: nonQuotationEmails, error: fetchError } = await supabase
          .from('emails')
          .select('id')
          .eq('is_quotation_request', false);

        if (fetchError) throw fetchError;

        if (!nonQuotationEmails || nonQuotationEmails.length === 0) {
          return new Response(
            JSON.stringify({ success: true, deleted: 0, message: "Aucun email à purger" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const emailIds = nonQuotationEmails.map(e => e.id);
        let deletedCount = 0;

        for (const emailId of emailIds) {
          try {
            // Get attachments
            const { data: attachments } = await supabase
              .from('email_attachments')
              .select('storage_path')
              .eq('email_id', emailId);

            // Delete files from storage
            if (attachments && attachments.length > 0) {
              const paths = attachments
                .filter(a => a.storage_path)
                .map(a => a.storage_path as string);
              
              if (paths.length > 0) {
                await supabase.storage.from('documents').remove(paths);
              }
            }

            // Delete attachments
            await supabase
              .from('email_attachments')
              .delete()
              .eq('email_id', emailId);

            // Delete related learned knowledge
            await supabase
              .from('learned_knowledge')
              .delete()
              .eq('source_id', emailId)
              .eq('source_type', 'email');

            // Delete related drafts
            await supabase
              .from('email_drafts')
              .delete()
              .eq('original_email_id', emailId);

            // Delete the email
            await supabase
              .from('emails')
              .delete()
              .eq('id', emailId);

            deletedCount++;
          } catch (err) {
            console.error(`Error deleting email ${emailId}:`, err);
          }
        }

        console.log(`Purged ${deletedCount} non-quotation emails`);

        return new Response(
          JSON.stringify({ success: true, deleted: deletedCount }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_email': {
        const { emailId } = data;
        
        if (!emailId) throw new Error("emailId requis");

        const { data: email, error } = await supabase
          .from('emails')
          .select('*')
          .eq('id', emailId)
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, email }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'get_drafts': {
        const { data: drafts, error } = await supabase
          .from('email_drafts')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, drafts }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'update_draft': {
        const { draftId, updates } = data;
        
        if (!draftId) throw new Error("draftId requis");

        const { data: draft, error } = await supabase
          .from('email_drafts')
          .update(updates)
          .eq('id', draftId)
          .select()
          .single();

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true, draft }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'delete_draft': {
        const { draftId } = data;
        
        if (!draftId) throw new Error("draftId requis");

        const { error } = await supabase
          .from('email_drafts')
          .delete()
          .eq('id', draftId);

        if (error) throw error;

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      default:
        throw new Error(`Action inconnue: ${action}`);
    }

  } catch (error) {
    console.error("Email admin error:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Erreur inconnue" 
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
