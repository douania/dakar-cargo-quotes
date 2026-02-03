/**
 * Hook Phase 8 — Classification SOURCE / CONTEXT des emails analysés
 * 
 * RÈGLE CTO : Fallback frontend uniquement (lecture seule)
 * - NE modifie PAS le backend
 * - NE modifie PAS le puzzle
 * - Calcul basé sur les mêmes règles que loadThreadData
 * 
 * Règles de classification :
 * - SOURCE : email.thread_ref === threadId OU email.id === threadId
 * - CONTEXT : email dans emails_analyzed_ids mais pas SOURCE
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type EmailSourceType = 'source' | 'context';

export interface ClassifiedEmail {
  id: string;
  from_address: string;
  subject: string | null;
  sent_at: string | null;
  source_type: EmailSourceType;
}

export interface EmailSourceClassification {
  /** Emails classifiés avec leur source_type */
  emails: ClassifiedEmail[];
  /** Nombre d'emails SOURCE (thread_ref strict) */
  sourceCount: number;
  /** Nombre d'emails CONTEXT (subject match) */
  contextCount: number;
  /** IDs des emails SOURCE */
  sourceIds: Set<string>;
  /** IDs des emails CONTEXT */
  contextIds: Set<string>;
  /** Chargement en cours */
  isLoading: boolean;
  /** Erreur éventuelle */
  error: Error | null;
}

export function useEmailSourceClassification(
  threadId: string | undefined,
  emailsAnalyzedIds: string[] | null | undefined
): EmailSourceClassification {
  // Query les emails SOURCE : thread_ref = threadId OU id = threadId
  const { data: sourceEmails, isLoading: isLoadingSource, error: errorSource } = useQuery({
    queryKey: ['emails-source', threadId],
    queryFn: async () => {
      if (!threadId) return [];
      
      const { data, error } = await supabase
        .from('emails')
        .select('id, from_address, subject, sent_at')
        .or(`thread_ref.eq.${threadId},id.eq.${threadId}`)
        .order('sent_at', { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
    enabled: !!threadId,
    staleTime: 30000, // 30s cache
  });

  // Calculer la classification
  const sourceIds = new Set(sourceEmails?.map(e => e.id) || []);
  const analyzedIds = emailsAnalyzedIds || [];
  
  // Les emails CONTEXT sont dans emails_analyzed_ids mais pas dans SOURCE
  const contextIds = new Set(
    analyzedIds.filter(id => !sourceIds.has(id))
  );

  // Query les emails CONTEXT pour avoir leurs détails
  const { data: contextEmails, isLoading: isLoadingContext, error: errorContext } = useQuery({
    queryKey: ['emails-context', Array.from(contextIds)],
    queryFn: async () => {
      if (contextIds.size === 0) return [];
      
      const { data, error } = await supabase
        .from('emails')
        .select('id, from_address, subject, sent_at')
        .in('id', Array.from(contextIds))
        .order('sent_at', { ascending: true });
      
      if (error) throw error;
      return data || [];
    },
    enabled: contextIds.size > 0,
    staleTime: 30000,
  });

  // Combiner les emails avec leur classification
  const classifiedEmails: ClassifiedEmail[] = [
    ...(sourceEmails || []).map(e => ({ ...e, source_type: 'source' as EmailSourceType })),
    ...(contextEmails || []).map(e => ({ ...e, source_type: 'context' as EmailSourceType })),
  ].sort((a, b) => 
    new Date(a.sent_at || 0).getTime() - new Date(b.sent_at || 0).getTime()
  );

  return {
    emails: classifiedEmails,
    sourceCount: sourceIds.size,
    contextCount: contextIds.size,
    sourceIds,
    contextIds,
    isLoading: isLoadingSource || isLoadingContext,
    error: errorSource || errorContext || null,
  };
}

/**
 * Vérifie s'il y a de nouveaux emails SOURCE depuis la dernière analyse
 * Utilisé pour l'alerte anti-rejeu (8.2)
 */
export function useHasNewSourceEmails(
  threadId: string | undefined,
  lastAnalyzedSourceIds: string[] | undefined
): { hasNewEmails: boolean; isLoading: boolean } {
  const { data: currentSourceEmails, isLoading } = useQuery({
    queryKey: ['emails-source-check', threadId],
    queryFn: async () => {
      if (!threadId) return [];
      
      const { data, error } = await supabase
        .from('emails')
        .select('id')
        .or(`thread_ref.eq.${threadId},id.eq.${threadId}`);
      
      if (error) throw error;
      return data?.map(e => e.id) || [];
    },
    enabled: !!threadId,
    staleTime: 10000, // 10s cache
  });

  const lastIds = new Set(lastAnalyzedSourceIds || []);
  const currentIds = currentSourceEmails || [];
  
  // Il y a de nouveaux emails si au moins un ID courant n'est pas dans les derniers analysés
  const hasNewEmails = currentIds.some(id => !lastIds.has(id));

  return { hasNewEmails, isLoading };
}
