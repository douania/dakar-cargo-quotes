/**
 * Phase 12: QuotationVersionCard
 * Displays existing quotation versions with selection and PDF export
 * 
 * CTO Rules:
 * - Read-only display of quotation_versions
 * - Human selects active version via explicit action
 * - PDF export writes to quotation_documents with traceability
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, FileDown, Loader2, Clock, FileText, ExternalLink } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePricingResultData, QuotationVersion } from '@/hooks/usePricingResultData';

interface QuotationVersionCardProps {
  caseId: string;
}

export function QuotationVersionCard({ caseId }: QuotationVersionCardProps) {
  const { versions, refetchVersions } = usePricingResultData(caseId);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});

  // Don't render if no versions exist
  if (versions.length === 0) {
    return null;
  }

  const handleSelectVersion = async (versionId: string) => {
    setSelectingId(versionId);
    try {
      // Deselect all versions first
      const { error: deselectError } = await supabase
        .from('quotation_versions')
        .update({ is_selected: false })
        .eq('case_id', caseId);

      if (deselectError) throw deselectError;

      // Select the chosen version
      const { error: selectError } = await supabase
        .from('quotation_versions')
        .update({ is_selected: true })
        .eq('id', versionId);

      if (selectError) throw selectError;

      toast.success('Version sélectionnée');
      await refetchVersions();
    } catch (err) {
      console.error('Select version error:', err);
      toast.error('Erreur lors de la sélection');
    } finally {
      setSelectingId(null);
    }
  };

  const handleExportPdf = async (version: QuotationVersion) => {
    setExportingId(version.id);
    try {
      const { data, error } = await supabase.functions.invoke('export-quotation-version-pdf', {
        body: { version_id: version.id }
      });

      if (error) throw error;

      if (data?.success && data?.url) {
        setDownloadUrls(prev => ({ ...prev, [version.id]: data.url }));
        window.open(data.url, '_blank');
        
        toast.success(`PDF v${version.version_number} généré`, {
          description: 'Document DRAFT',
        });
      } else {
        throw new Error(data?.error || 'Échec de génération');
      }
    } catch (err) {
      console.error('Export PDF error:', err);
      toast.error('Erreur génération PDF', {
        description: err instanceof Error ? err.message : 'Erreur inconnue',
      });
    } finally {
      setExportingId(null);
    }
  };

  const formatAmount = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return '—';
    return new Intl.NumberFormat('fr-FR').format(amount);
  };

  const getStatusBadge = (status: string, isSelected: boolean) => {
    if (isSelected) {
      return (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
          <Check className="h-3 w-3 mr-1" />
          Sélectionnée
        </Badge>
      );
    }
    
    switch (status) {
      case 'draft':
        return <Badge variant="secondary">Draft</Badge>;
      case 'approved':
        return <Badge className="bg-blue-100 text-blue-700">Approuvée</Badge>;
      case 'superseded':
        return <Badge variant="outline" className="text-muted-foreground">Remplacée</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-800">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-lg">Versions du devis</CardTitle>
        </div>
        <CardDescription>
          {versions.length} version{versions.length > 1 ? 's' : ''} créée{versions.length > 1 ? 's' : ''}
        </CardDescription>
      </CardHeader>

      <CardContent>
        <ScrollArea className="max-h-[300px]">
          <div className="space-y-3">
            {versions.map((version) => {
              const snapshot = version.snapshot as any;
              const totalHt = snapshot?.totals?.total_ht;
              const currency = snapshot?.totals?.currency || 'XOF';
              const linesCount = snapshot?.lines?.length || 0;
              const hasDownloadUrl = !!downloadUrls[version.id];

              return (
                <div 
                  key={version.id}
                  className={`p-4 rounded-lg border transition-colors ${
                    version.is_selected 
                      ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-700 dark:bg-emerald-950/20' 
                      : 'border-border bg-muted/30 hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-semibold">Version v{version.version_number}</span>
                        {getStatusBadge(version.status, version.is_selected)}
                      </div>
                      
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(version.created_at), "d MMM yyyy HH:mm", { locale: fr })}
                        </span>
                        <span>{linesCount} lignes</span>
                      </div>

                      {totalHt !== undefined && (
                        <p className="mt-2 text-lg font-bold text-emerald-600 dark:text-emerald-400">
                          {formatAmount(totalHt)} {currency}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      {/* Select button (if not already selected) */}
                      {!version.is_selected && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSelectVersion(version.id)}
                          disabled={selectingId === version.id}
                          className="gap-1"
                        >
                          {selectingId === version.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Check className="h-3 w-3" />
                          )}
                          Sélectionner
                        </Button>
                      )}

                      {/* PDF Export button */}
                      {hasDownloadUrl ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(downloadUrls[version.id], '_blank')}
                          className="gap-1 text-emerald-600 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-700"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Ouvrir PDF
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleExportPdf(version)}
                          disabled={exportingId === version.id}
                          className="gap-1"
                        >
                          {exportingId === version.id ? (
                            <>
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Export...
                            </>
                          ) : (
                            <>
                              <FileDown className="h-3 w-3" />
                              PDF Draft
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
