import { supabase } from '@/integrations/supabase/client';
import type { LearnedKnowledge } from '@/types';

export async function fetchKnowledge() {
  const { data, error } = await supabase.functions.invoke('data-admin', {
    body: { action: 'get_all' }
  });
  
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Erreur');
  return data.knowledge as LearnedKnowledge[];
}

export async function toggleKnowledgeValidation(id: string, currentState: boolean) {
  const { data, error } = await supabase.functions.invoke('data-admin', {
    body: { action: 'toggle_validation', data: { id, currentState } }
  });
  
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Erreur');
}

export async function deleteKnowledge(id: string) {
  const { data, error } = await supabase.functions.invoke('data-admin', {
    body: { action: 'delete', data: { id } }
  });
  
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Erreur');
}
