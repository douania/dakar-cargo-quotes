import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  Paperclip, 
  Play, 
  AlertCircle, 
  CheckCircle, 
  Loader2,
  RefreshCw 
} from 'lucide-react';

interface AttachmentStats {
  pending: number;
  analyzed: number;
  errors: number;
  missing: number;
}

interface Props {
  stats: AttachmentStats;
  unanalyzedAttachments: { id: string; filename: string; content_type: string }[];
  onRefresh: () => void;
}

export function AttachmentStatusPanel({ stats, unanalyzedAttachments, onRefresh }: Props) {
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);

  const total = stats.pending + stats.analyzed + stats.errors + stats.missing;

  const analyzeAll = async () => {
    if (unanalyzedAttachments.length === 0) {
      toast.info('Aucune pièce jointe à analyser');
      return;
    }

    // Filter only relevant attachments
    const relevantAttachments = unanalyzedAttachments.filter(att => {
      const ext = att.filename.split('.').pop()?.toLowerCase() || '';
      return ['pdf', 'xlsx', 'xls', 'jpg', 'jpeg', 'png'].includes(ext);
    });

    if (relevantAttachments.length === 0) {
      toast.info('Aucune pièce jointe pertinente (PDF, Excel, images)');
      return;
    }

    setAnalyzing(true);
    setProgress(0);
    setProcessedCount(0);

    let successCount = 0;
    let errorCount = 0;
    const BATCH_SIZE = 3;

    for (let i = 0; i < relevantAttachments.length; i += BATCH_SIZE) {
      const batch = relevantAttachments.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (att) => {
        try {
          const { data, error } = await supabase.functions.invoke('analyze-attachments', {
            body: { attachmentId: att.id, background: true }
          });

          if (error) throw error;
          successCount++;
        } catch (error) {
          console.error(`Error analyzing ${att.filename}:`, error);
          errorCount++;
        }
      }));

      const processed = Math.min(i + BATCH_SIZE, relevantAttachments.length);
      setProcessedCount(processed);
      setProgress((processed / relevantAttachments.length) * 100);
    }

    setAnalyzing(false);

    if (successCount > 0) {
      toast.success(`${successCount} pièce(s) jointe(s) lancée(s) en analyse`);
    }
    if (errorCount > 0) {
      toast.error(`${errorCount} erreur(s) d'analyse`);
    }

    // Refresh after delay for background processing
    setTimeout(() => onRefresh(), 2000);
  };

  // Don't show if no attachments at all
  if (total === 0) return null;

  // Determine panel state
  const hasPending = stats.pending > 0;
  const hasErrors = stats.errors > 0 || stats.missing > 0;

  return (
    <Card className={`border-l-4 ${
      hasErrors ? 'border-l-destructive bg-destructive/5' :
      hasPending ? 'border-l-orange-500 bg-orange-50/50 dark:bg-orange-950/20' :
      'border-l-green-500 bg-green-50/50 dark:bg-green-950/20'
    }`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <Paperclip className={`h-5 w-5 ${
              hasErrors ? 'text-destructive' :
              hasPending ? 'text-orange-600' :
              'text-green-600'
            }`} />
            
            <div>
              <p className="font-medium flex items-center gap-2">
                {hasPending ? (
                  <>
                    {stats.pending} pièce(s) jointe(s) en attente d'analyse
                  </>
                ) : hasErrors ? (
                  <>
                    <AlertCircle className="h-4 w-4 text-destructive" />
                    {stats.errors + stats.missing} fichier(s) avec problème
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    Toutes les pièces jointes sont analysées
                  </>
                )}
              </p>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <CheckCircle className="h-3 w-3 text-green-600" />
                  {stats.analyzed} analysée(s)
                </span>
                {stats.pending > 0 && (
                  <span className="flex items-center gap-1">
                    <Loader2 className="h-3 w-3 text-orange-600" />
                    {stats.pending} en attente
                  </span>
                )}
                {stats.errors > 0 && (
                  <span className="flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 text-destructive" />
                    {stats.errors} erreur(s)
                  </span>
                )}
                {stats.missing > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {stats.missing} fichier(s) manquant(s)
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {analyzing ? (
              <div className="flex items-center gap-3 min-w-[200px]">
                <div className="flex-1">
                  <Progress value={progress} className="h-2" />
                  <p className="text-xs text-muted-foreground mt-1">
                    {processedCount}/{unanalyzedAttachments.length} traité(s)
                  </p>
                </div>
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              </div>
            ) : (
              <>
                {hasPending && (
                  <Button onClick={analyzeAll} size="sm">
                    <Play className="h-4 w-4 mr-2" />
                    Analyser tout ({stats.pending})
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={onRefresh}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>

        {analyzing && (
          <Progress value={progress} className="mt-3 h-1" />
        )}
      </CardContent>
    </Card>
  );
}
