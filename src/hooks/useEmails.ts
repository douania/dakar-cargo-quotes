import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import * as emailService from '@/services/emailService';

export function useEmailConfigs() {
  return useQuery({
    queryKey: ['emailConfigs'],
    queryFn: emailService.fetchEmailConfigs,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useEmails(pageSize = 20) {
  return useInfiniteQuery({
    queryKey: ['emails'],
    queryFn: ({ pageParam = 0 }) => emailService.fetchEmails(pageParam, pageSize),
    getNextPageParam: (lastPage, allPages) => {
      const loadedCount = allPages.reduce((sum, page) => sum + page.emails.length, 0);
      return loadedCount < lastPage.totalCount ? allPages.length : undefined;
    },
    initialPageParam: 0,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}

export function useEmailDrafts() {
  return useQuery({
    queryKey: ['emailDrafts'],
    queryFn: emailService.fetchEmailDrafts,
    staleTime: 2 * 60 * 1000,
  });
}

export function useAttachmentCounts() {
  return useQuery({
    queryKey: ['attachmentCounts'],
    queryFn: emailService.fetchAttachmentCounts,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddEmailConfig() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: emailService.addEmailConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailConfigs'] });
      toast.success('Configuration ajoutée');
    },
    onError: () => {
      toast.error("Erreur lors de l'ajout");
    },
  });
}

export function useDeleteEmailConfig() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: emailService.deleteEmailConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailConfigs'] });
      toast.success('Configuration supprimée');
    },
    onError: () => {
      toast.error('Erreur de suppression');
    },
  });
}

export function useSyncEmails() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: emailService.syncEmails,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      toast.success(`${data.synced} emails synchronisés`);
      if (data.message) {
        toast.info(data.message);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Erreur de synchronisation');
    },
  });
}

export function useLearnFromEmail() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: emailService.learnFromEmail,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['knowledge'] });
      toast.success(`${data.stored} connaissances extraites`);
    },
    onError: () => {
      toast.error("Erreur d'apprentissage");
    },
  });
}

export function useGenerateResponse() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: emailService.generateEmailResponse,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emailDrafts'] });
      toast.success('Brouillon généré');
    },
    onError: () => {
      toast.error('Erreur de génération');
    },
  });
}
