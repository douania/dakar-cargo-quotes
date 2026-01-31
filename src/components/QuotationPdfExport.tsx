/**
 * QuotationPdfExport.tsx
 * Phase 5C — Bouton export PDF versionné
 * 
 * Génère un PDF depuis quotation_history (données figées)
 * via l'edge function generate-quotation-pdf
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FileDown, Loader2, CheckCircle2, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

interface QuotationPdfExportProps {
  quotationId: string;
  version: number;
  status: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function QuotationPdfExport({
  quotationId,
  version,
  status,
  variant = 'outline',
  size = 'sm',
}: QuotationPdfExportProps) {
  const [isExporting, setIsExporting] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const handleExport = async () => {
    if (!quotationId) {
      toast.error('Aucun devis à exporter');
      return;
    }

    setIsExporting(true);
    setDownloadUrl(null);

    try {
      const { data, error } = await supabase.functions.invoke('generate-quotation-pdf', {
        body: { quotationId }
      });

      if (error) throw error;

      if (data?.success && data?.url) {
        setDownloadUrl(data.url);
        
        // Ouvrir automatiquement
        window.open(data.url, '_blank');
        
        toast.success(`PDF v${version} généré`, {
          description: status === 'draft' ? 'Document brouillon' : 'Document officiel',
        });
      } else {
        throw new Error(data?.error || 'Échec de la génération PDF');
      }
    } catch (error) {
      console.error('PDF export error:', error);
      toast.error('Erreur génération PDF', {
        description: error instanceof Error ? error.message : 'Erreur inconnue',
      });
    } finally {
      setIsExporting(false);
    }
  };

  // État après génération réussie
  if (downloadUrl) {
    return (
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size={size}
          onClick={() => window.open(downloadUrl, '_blank')}
          className="gap-2 text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-700 dark:hover:bg-emerald-950"
        >
          <CheckCircle2 className="h-4 w-4" />
          PDF v{version}
          <ExternalLink className="h-3 w-3" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setDownloadUrl(null);
            handleExport();
          }}
          title="Regénérer le PDF"
        >
          <FileDown className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleExport}
      disabled={isExporting}
      className="gap-2"
    >
      {isExporting ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          Génération...
        </>
      ) : (
        <>
          <FileDown className="h-4 w-4" />
          PDF v{version}
        </>
      )}
    </Button>
  );
}
