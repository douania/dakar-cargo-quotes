import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ThreadEmail {
  id: string;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[] | null;
  subject: string | null;
  body_text: string | null;
  sent_at: string | null;
  is_quotation_request: boolean;
  attachmentCount?: number;
}

export interface ThreadWithEmails {
  id: string;
  subject_normalized: string;
  emails: ThreadEmail[];
  client_email: string | null;
  partner_email: string | null;
}

// SODATRA domain patterns for identifying internal emails
const SODATRA_DOMAINS = ['sodatra.sn', 'sodatra.com'];

export function isSodatraEmail(email: string): boolean {
  const parts = email.trim().toLowerCase().split('@');
  return parts.length === 2 && !!parts[0] && SODATRA_DOMAINS.includes(parts[1]);
}

export type SenderType = 'internal' | 'client' | 'partner' | 'unknown';

export function getSenderType(
  fromAddress: string, 
  clientEmail: string | null, 
  partnerEmail: string | null
): SenderType {
  const from = fromAddress.trim().toLowerCase();
  
  if (isSodatraEmail(from)) return 'internal';
  if (clientEmail && from === clientEmail.trim().toLowerCase()) return 'client';
  if (partnerEmail && from === partnerEmail.trim().toLowerCase()) return 'partner';
  
  return 'unknown';
}

export function useThreadEmails(threadId: string | null) {
  return useInfiniteQuery({
    queryKey: ['thread-emails', threadId],
    initialPageParam: 0,
    getNextPageParam: (page: ThreadWithEmails & { nextOffset: number | null }) => page.nextOffset ?? undefined,
    queryFn: async ({ pageParam }): Promise<ThreadWithEmails & { nextOffset: number | null }> => {
      if (!threadId) throw new Error('Fil absent');
      
      // Fetch thread info
      const { data: thread, error: threadError } = await supabase
        .from('email_threads')
        .select('id, subject_normalized, client_email, partner_email')
        .eq('id', threadId)
        .single();
      
      if (threadError) throw threadError;
      if (!thread) throw new Error('Fil inaccessible');
      
      // Server count and an advancing cursor prevent a server row cap from hiding history.
      const { data: emails, error: emailsError, count } = await supabase
        .from('emails')
        .select(`
          id,
          from_address,
          to_addresses,
          cc_addresses,
          subject,
          body_text,
          sent_at,
          is_quotation_request
        `, { count: 'exact' })
        .eq('thread_ref', threadId)
        .order('sent_at', { ascending: false, nullsFirst: false })
        .order('id', { ascending: false })
        .range(pageParam, pageParam + 49);
      
      if (emailsError) throw emailsError;
      if (!emails || !Number.isSafeInteger(count) || count === null || count < 0) {
        throw new Error('Étendue de l’historique indisponible');
      }
      
      // Fetch attachment counts
      const visibleEmails = (emails || []).slice(0, 50);
      if (visibleEmails.length === 0 && pageParam < count) throw new Error('Historique incomplet');
      const emailIds = visibleEmails.map(e => e.id);
      const attachmentCounts: Record<string, number> = {};
      if (emailIds.length > 0) {
        for (let offset = 0; ;) {
          const { data: attachments, error: attachmentError, count: total } = await supabase
            .from('email_attachments').select('email_id', { count: 'exact' }).in('email_id', emailIds)
            .order('id').range(offset, offset + 499);
          if (attachmentError || !attachments || total === null || !Number.isSafeInteger(total)
            || total < 0 || (attachments.length === 0 && offset < total)) throw new Error('Lecture des pièces jointes impossible');
          for (const att of attachments) {
            if (att.email_id) attachmentCounts[att.email_id] = (attachmentCounts[att.email_id] || 0) + 1;
          }
          offset += attachments.length;
          if (offset >= total) break;
        }
      }
      
      return {
        ...thread,
        nextOffset: pageParam + visibleEmails.length < count ? pageParam + visibleEmails.length : null,
        emails: visibleEmails.map(e => ({
          ...e,
          attachmentCount: attachmentCounts[e.id] || 0,
        })),
      };
    },
    enabled: !!threadId,
  });
}
