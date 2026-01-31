/**
 * Service de chargement des threads email
 * Phase 4B.3 — Extraction pure de fetchThreadData
 * 
 * Fonctions pures pour le chargement et la transformation des données email.
 * Ne modifie aucun state React directement.
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeSubject } from '../utils/consolidation';
import type { ThreadEmail, ExtractedData } from '../types';

/**
 * Type pour les enregistrements bruts Supabase
 */
interface RawEmailRecord {
  id: string;
  subject: string | null;
  from_address: string;
  to_addresses: string[];
  cc_addresses: string[] | null;
  body_text: string | null;
  received_at: string | null;
  created_at: string | null;
  sent_at: string | null;
  extracted_data: unknown;
  thread_ref: string | null;
}

/**
 * Convertit un enregistrement brut Supabase en ThreadEmail
 */
export function mapRawEmailToThreadEmail(raw: RawEmailRecord): ThreadEmail {
  return {
    id: raw.id,
    subject: raw.subject,
    from_address: raw.from_address,
    to_addresses: raw.to_addresses,
    cc_addresses: raw.cc_addresses ?? undefined,
    body_text: raw.body_text,
    received_at: raw.received_at || raw.created_at || '',
    sent_at: raw.sent_at,
    extracted_data: raw.extracted_data as ExtractedData | null,
    thread_ref: raw.thread_ref,
  };
}

/**
 * Charge les emails d'un thread via thread_ref
 */
export async function loadThreadEmailsByRef(threadRef: string): Promise<ThreadEmail[]> {
  const { data: threadData } = await supabase
    .from('emails')
    .select('*')
    .eq('thread_ref', threadRef)
    .order('sent_at', { ascending: true });
  
  if (!threadData || threadData.length === 0) {
    return [];
  }
  
  return threadData.map(mapRawEmailToThreadEmail);
}

/**
 * Charge les emails similaires par sujet normalisé (fallback)
 */
export async function loadThreadEmailsBySubject(subject: string): Promise<ThreadEmail[]> {
  const normalizedSubject = normalizeSubject(subject);
  
  const { data: similarEmails } = await supabase
    .from('emails')
    .select('*')
    .order('sent_at', { ascending: true });
  
  if (!similarEmails) {
    return [];
  }
  
  return similarEmails
    .filter(e => {
      const eNormalized = normalizeSubject(e.subject);
      return eNormalized.includes(normalizedSubject) || normalizedSubject.includes(eNormalized);
    })
    .map(mapRawEmailToThreadEmail);
}

/**
 * Charge les pièces jointes pour une liste d'emails
 */
export async function loadThreadAttachments(
  emailIds: string[]
): Promise<Array<{ id: string; filename: string; content_type: string; email_id?: string }>> {
  if (emailIds.length === 0) {
    return [];
  }
  
  const { data: attachmentData } = await supabase
    .from('email_attachments')
    .select('id, filename, content_type, email_id')
    .in('email_id', emailIds);
  
  return attachmentData || [];
}

/**
 * Détermine l'email sélectionné dans le thread
 */
export function buildCurrentEmail(
  emails: ThreadEmail[], 
  targetEmailId: string
): ThreadEmail {
  return emails.find(e => e.id === targetEmailId) || emails[emails.length - 1];
}
