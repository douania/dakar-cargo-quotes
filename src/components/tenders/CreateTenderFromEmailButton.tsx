import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Briefcase, Loader2 } from 'lucide-react';

interface EmailThread {
  id: string;
  subject_normalized: string;
  client_email: string | null;
  client_company: string | null;
}

interface CreateTenderFromEmailButtonProps {
  thread: EmailThread;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function CreateTenderFromEmailButton({ 
  thread, 
  variant = 'outline',
  size = 'sm'
}: CreateTenderFromEmailButtonProps) {
  const navigate = useNavigate();
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateTender = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsCreating(true);

    try {
      // 1. Find the first email in this thread with attachments
      const { data: emails, error: emailsError } = await supabase
        .from('emails')
        .select(`
          id,
          subject,
          body_text,
          from_address,
          email_attachments (
            id,
            filename,
            extracted_text,
            is_analyzed
          )
        `)
        .eq('thread_ref', thread.id)
        .order('sent_at', { ascending: true });

      if (emailsError) throw emailsError;

      // 2. Find the best attachment (PDF preferred, analyzed preferred)
      let bestAttachment: { id: string; filename: string; extracted_text: string | null } | null = null;
      let bestEmailId: string | null = null;

      for (const email of emails || []) {
        const attachments = (email.email_attachments || []) as any[];
        for (const att of attachments) {
          const isPdf = att.filename?.toLowerCase().endsWith('.pdf');
          const isAnalyzed = att.is_analyzed && att.extracted_text;
          
          if (!bestAttachment || (isPdf && isAnalyzed)) {
            bestAttachment = att;
            bestEmailId = email.id;
            if (isPdf && isAnalyzed) break;
          }
        }
        if (bestAttachment && bestAttachment.filename?.toLowerCase().endsWith('.pdf') && bestAttachment.extracted_text) break;
      }

      if (!bestAttachment) {
        // No attachment found, create tender with email body only
        toast.info('Aucune pièce jointe trouvée, création à partir du contenu email...');
      }

      // 3. Call analyze-tender edge function
      const { data, error } = await supabase.functions.invoke('analyze-tender', {
        body: {
          attachmentId: bestAttachment?.id,
          emailId: bestEmailId || emails?.[0]?.id,
          documentText: bestAttachment?.extracted_text || emails?.[0]?.body_text || thread.subject_normalized,
          createProject: true
        }
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur d\'analyse');

      toast.success('Tender créé avec succès');
      
      // 4. Navigate to the tender page
      if (data.projectId) {
        navigate(`/admin/tenders?selected=${data.projectId}`);
      } else {
        navigate('/admin/tenders');
      }
    } catch (error) {
      console.error('Error creating tender:', error);
      toast.error('Erreur lors de la création du tender');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleCreateTender}
      disabled={isCreating}
      className="text-primary"
    >
      {isCreating ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : (
        <Briefcase className="h-4 w-4 mr-1" />
      )}
      {isCreating ? 'Création...' : 'Créer Tender'}
    </Button>
  );
}

// Helper to detect if a thread is likely a MINUSCA/UN tender
export function detectTenderType(subject: string, body?: string): 'minusca' | 'un' | 'standard' | null {
  const text = `${subject} ${body || ''}`.toLowerCase();
  
  const MINUSCA_KEYWORDS = [
    'minusca', 'unmiss', 'rfps', 'rotation', 'demobilization', 
    'contingent', 'casques bleus', 'peacekeeping', 'united nations',
    'dod', 'department of operational support', 'bangui', 'centrafrique'
  ];
  
  const UN_KEYWORDS = [
    'nations unies', 'united nations', 'un mission', 'dpko', 'dfs',
    'monusco', 'minurso', 'unmil', 'unifil', 'undof'
  ];
  
  if (MINUSCA_KEYWORDS.some(kw => text.includes(kw))) return 'minusca';
  if (UN_KEYWORDS.some(kw => text.includes(kw))) return 'un';
  
  // Standard tender keywords
  const TENDER_KEYWORDS = [
    'appel d\'offres', 'tender', 'rfq', 'quotation request', 
    'demande de prix', 'consultation', 'cahier des charges'
  ];
  
  if (TENDER_KEYWORDS.some(kw => text.includes(kw))) return 'standard';
  
  return null;
}
