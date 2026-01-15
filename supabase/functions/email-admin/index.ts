import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============ EMAIL FILTERING CONFIGURATION ============
// (Must match sync-emails function)

const EXCLUDED_SENDERS = [
  'banqueatlantique.net', 'banqueatlantique.com',
  'afrikabanque.sn', 'afrikabanque.com',
  'ecobank.com', 'ecobank.sn',
  'sgbs.sn', 'societegenerale.sn',
  'bicis.sn', 'bnpparibas',
  'cbao.sn', 'attijariwafa',
  'oaborable.sn', 'banque',
  'linkedin.com', 'linkedinmail.com',
  'facebook.com', 'facebookmail.com',
  'twitter.com', 'x.com',
  'broadcast@wcabroadcast.com', 'wcabroadcast.com',
  'newsletter', 'noreply', 'no-reply', 'donotreply', 'do-not-reply',
  'mailer-daemon', 'postmaster',
  'mailchimp', 'sendgrid', 'mailgun',
  '@sodatra.sn',
  'google.com', 'accounts.google',
  'microsoft.com', 'office365',
  'zoom.us', 'teams.microsoft',
  'dropbox.com', 'wetransfer.com'
];

// Subjects that indicate non-quotation emails (but check for false positives)
// Note: 'spam:' is handled specially - it's often just an Outlook tag, not real spam
const EXCLUDED_SUBJECTS = [
  // Notifications bancaires (hard exclusions)
  'notification de credit', 'notification de débit', 'notification de debit',
  'avis de credit', 'avis de débit', 'avis de debit',
  'encours ligne', 'relevé de compte', 'releve de compte',
  'virement reçu', 'virement recu', 'transfert reçu',
  'solde de compte', 'état de compte',
  'alerte compte', 'mouvement compte',
  // LinkedIn
  'a publié récemment', 'has posted', 'a partagé',
  'invitation à se connecter', 'wants to connect',
  'a consulté votre profil', 'viewed your profile',
  'new job', 'nouveau poste',
  // Newsletters/Marketing
  'holiday operating hours', 'operating hours update',
  'membership updates', 'membership renewal',
  'annual conference', 'webinar invitation',
  'unsubscribe', 'se désabonner',
  // Sécurité/Système
  'new login from', 'nouvelle connexion',
  'password reset', 'réinitialisation mot de passe',
  'verify your email', 'vérifiez votre email',
  'account security', 'sécurité du compte',
  // Autres
  'out of office', 'absence du bureau', 'automatic reply', 'réponse automatique'
];

// Clean Outlook spam prefix from subject
function cleanSpamPrefix(subject: string): string {
  return (subject || '')
    .replace(/^Spam:\**,?\s*/i, '')
    .replace(/^\[Spam\]\s*/i, '')
    .replace(/^\*+Spam\*+:?\s*/i, '')
    .trim();
}

const QUOTATION_KEYWORDS = [
  'demande de cotation', 'request for quotation', 'rfq',
  'demande de devis', 'request for quote', 'devis',
  'demande de prix', 'price request', 'pricing request',
  'besoin de cotation', 'need a quote', 'quote request',
  'dap ', 'cif ', 'fob ', 'exw ', 'cfr ', 'cpt ', 'cip ', 'ddp ',
  'dap:', 'cif:', 'fob:', 'exw:',
  'sea freight', 'ocean freight', 'fret maritime',
  'air freight', 'fret aérien', 'fret aerien',
  'door to door', 'port to port',
  'conteneur 20', 'conteneur 40', '20dv', '40dv', '40hc', '20gp', '40gp',
  'container 20', 'container 40', 'fcl', 'lcl',
  'breakbulk', 'roro', 'ro-ro', 'projet cargo', 'project cargo',
  'conventionnel', 'conventional cargo', 'vrac', 'bulk cargo',
  'dédouanement', 'dedouanement', 'customs clearance',
  'droits de douane', 'duty structure', 'hs code',
  'régime douanier', 'regime douanier', 'mise à la consommation',
  'transit request', 'trucking request', 'transport request',
  'livraison', 'delivery to', 'acheminement',
  'dakar port', 'port de dakar', 'pad ', 'dpw dakar'
];

function isQuotationRelated(from: string, subject: string, body: string): boolean {
  const fromLower = from.toLowerCase();
  // Clean spam prefix before checking subject
  const cleanedSubject = cleanSpamPrefix(subject);
  const subjectLower = cleanedSubject.toLowerCase();
  const bodyLower = body.toLowerCase();
  
  // 1. EXCLURE si expéditeur dans la liste noire
  if (EXCLUDED_SENDERS.some(sender => fromLower.includes(sender.toLowerCase()))) {
    return false;
  }
  
  // 2. EXCLURE si sujet (nettoyé) dans la liste noire
  if (EXCLUDED_SUBJECTS.some(subj => subjectLower.includes(subj.toLowerCase()))) {
    return false;
  }
  
  // 3. INCLURE si mots-clés positifs trouvés dans sujet ou corps
  const text = `${subjectLower} ${bodyLower}`;
  return QUOTATION_KEYWORDS.some(kw => text.includes(kw.toLowerCase()));
}

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
        const [configsRes, emailsRes, draftsRes, attachmentsRes, threadsRes] = await Promise.all([
          supabase.from('email_configs').select('*').order('created_at', { ascending: false }),
          supabase.from('emails').select('*').order('sent_at', { ascending: false }).limit(100),
          supabase.from('email_drafts').select('*').order('created_at', { ascending: false }),
          supabase.from('email_attachments').select('email_id'),
          supabase.from('email_threads').select('*').order('last_message_at', { ascending: false }).limit(50)
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
            attachments: attachmentsRes.data || [],
            threads: threadsRes.data || []
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

      case 'reclassify_emails': {
        // Recalculate is_quotation_request for all existing emails
        console.log('Starting email reclassification...');
        
        // Fetch all emails with pagination
        let allEmails: Array<{ id: string; from_address: string; subject: string | null; body_text: string | null; body_html: string | null }> = [];
        let offset = 0;
        const pageSize = 500;
        
        while (true) {
          const { data: batch, error } = await supabase
            .from('emails')
            .select('id, from_address, subject, body_text, body_html')
            .range(offset, offset + pageSize - 1);
          
          if (error) throw error;
          if (!batch || batch.length === 0) break;
          
          allEmails = allEmails.concat(batch);
          offset += pageSize;
          
          if (batch.length < pageSize) break;
        }
        
        console.log(`Found ${allEmails.length} emails to reclassify`);
        
        let quotationCount = 0;
        let nonQuotationCount = 0;
        
        for (const email of allEmails) {
          const from = email.from_address || '';
          const subject = email.subject || '';
          const body = email.body_text || email.body_html || '';
          
          const isQuotation = isQuotationRelated(from, subject, body);
          
          const { error: updateError } = await supabase
            .from('emails')
            .update({ is_quotation_request: isQuotation })
            .eq('id', email.id);
          
          if (updateError) {
            console.error(`Error updating email ${email.id}:`, updateError);
          } else {
            if (isQuotation) {
              quotationCount++;
            } else {
              nonQuotationCount++;
            }
          }
        }
        
        console.log(`Reclassification complete: ${quotationCount} quotations, ${nonQuotationCount} non-quotations`);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            total: allEmails.length,
            quotations: quotationCount,
            nonQuotations: nonQuotationCount
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      case 'reclassify_threads': {
        // Recalculate is_quotation_thread for all existing threads
        console.log('Starting thread reclassification...');
        
        // Fetch all threads
        const { data: threads, error: threadsError } = await supabase
          .from('email_threads')
          .select('id, subject_normalized');
        
        if (threadsError) throw threadsError;
        
        if (!threads || threads.length === 0) {
          return new Response(
            JSON.stringify({ success: true, updated: 0, message: "Aucun fil à reclassifier" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        
        // List of subjects that indicate non-quotation threads
        const EXCLUDED_THREAD_SUBJECTS = [
          'new login from', 'nouvelle connexion',
          'daily report', 'rapport journalier', 'reporting du',
          'notification de credit', 'notification de débit',
          'membership updates', 'membership renewal',
          'merry christmas', 'happy new year', 'joyeux noël', 'bonne année',
          'holiday operating hours', 'operating hours',
          'spam:', '[spam]',
          'out of office', 'absence du bureau', 'automatic reply',
          'unsubscribe', 'se désabonner',
          'password reset', 'réinitialisation',
          'verify your email', 'vérifiez votre',
          'account security', 'sécurité du compte',
          'newsletter', 'webinar', 'conference invitation'
        ];
        
        let quotationCount = 0;
        let nonQuotationCount = 0;
        
        for (const thread of threads) {
          const subjectLower = (thread.subject_normalized || '').toLowerCase();
          
          // Check if thread subject is blacklisted
          const isBlacklisted = EXCLUDED_THREAD_SUBJECTS.some(
            excl => subjectLower.includes(excl.toLowerCase())
          );
          
          if (isBlacklisted) {
            // Mark as non-quotation
            await supabase
              .from('email_threads')
              .update({ is_quotation_thread: false })
              .eq('id', thread.id);
            nonQuotationCount++;
            continue;
          }
          
          // Check if thread has at least one quotation email
          const { data: threadEmails } = await supabase
            .from('emails')
            .select('is_quotation_request')
            .eq('thread_ref', thread.id);
          
          const hasQuotationEmail = threadEmails?.some(e => e.is_quotation_request) || false;
          
          // Also check if subject contains quotation keywords
          const hasKeywordInSubject = QUOTATION_KEYWORDS.some(
            kw => subjectLower.includes(kw.toLowerCase())
          );
          
          const isQuotation = hasQuotationEmail || hasKeywordInSubject;
          
          await supabase
            .from('email_threads')
            .update({ is_quotation_thread: isQuotation })
            .eq('id', thread.id);
          
          if (isQuotation) {
            quotationCount++;
          } else {
            nonQuotationCount++;
          }
        }
        
        console.log(`Thread reclassification complete: ${quotationCount} quotation threads, ${nonQuotationCount} non-quotation threads`);
        
        return new Response(
          JSON.stringify({ 
            success: true, 
            total: threads.length,
            quotationThreads: quotationCount,
            nonQuotationThreads: nonQuotationCount
          }),
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
