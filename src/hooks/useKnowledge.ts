import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import * as knowledgeService from '@/services/knowledgeService';

export function useKnowledge() {
  return useQuery({
    queryKey: ['knowledge'],
    queryFn: knowledgeService.fetchKnowledge,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

export function useToggleValidation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, currentState }: { id: string; currentState: boolean }) =>
      knowledgeService.toggleKnowledgeValidation(id, currentState),
    onSuccess: (_, { currentState }) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      toast.success(currentState ? 'Connaissance invalidée' : 'Connaissance validée');
    },
    onError: () => {
      toast.error('Erreur de mise à jour');
    },
  });
}

export function useDeleteKnowledge() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: knowledgeService.deleteKnowledge,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      toast.success('Connaissance supprimée');
    },
    onError: () => {
      toast.error('Erreur de suppression');
    },
  });
}

export function useBulkValidation() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await knowledgeService.toggleKnowledgeValidation(id, false);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
}

export function useBulkDelete() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await knowledgeService.deleteKnowledge(id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
    },
  });
}
