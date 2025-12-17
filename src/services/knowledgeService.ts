import { supabase } from '@/integrations/supabase/client';
import type { LearnedKnowledge } from '@/types';

export async function fetchKnowledge() {
  const { data, error } = await supabase
    .from('learned_knowledge')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data as LearnedKnowledge[];
}

export async function toggleKnowledgeValidation(id: string, currentState: boolean) {
  const { error } = await supabase
    .from('learned_knowledge')
    .update({ 
      is_validated: !currentState,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  
  if (error) throw error;
}

export async function deleteKnowledge(id: string) {
  const { error } = await supabase
    .from('learned_knowledge')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
}
