import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface NewEmail {
  id: string;
  subject: string;
  from_address: string;
  sent_at: string;
}

export function useRealtimeEmails() {
  const [newEmailCount, setNewEmailCount] = useState(0);
  const [latestEmails, setLatestEmails] = useState<NewEmail[]>([]);
  const queryClient = useQueryClient();

  const resetCount = useCallback(() => {
    setNewEmailCount(0);
    setLatestEmails([]);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('emails-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'emails',
        },
        (payload) => {
          const newEmail = payload.new as NewEmail;
          
          // Update count
          setNewEmailCount(prev => prev + 1);
          
          // Add to latest emails (keep max 5)
          setLatestEmails(prev => [newEmail, ...prev].slice(0, 5));
          
          // Show toast notification
          toast.info(`Nouvel email de ${newEmail.from_address}`, {
            description: newEmail.subject || '(Sans sujet)',
            duration: 5000,
          });
          
          // Invalidate emails query to refresh data
          queryClient.invalidateQueries({ queryKey: ['emails'] });
          queryClient.invalidateQueries({ queryKey: ['email-threads'] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return {
    newEmailCount,
    latestEmails,
    resetCount,
  };
}
