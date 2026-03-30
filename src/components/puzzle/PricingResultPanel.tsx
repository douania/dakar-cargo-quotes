/**
 * Phase 12 + P3b.1: PricingResultPanel
 * Displays the latest successful pricing run and allows version creation.
 * Supports multi-lot display when outputs_json.multi_lot === true.
 *
 * CTO Rules:
 * - Read-only display of pricing_run data
 * - Human triggers version creation via explicit button + confirmation
 * - Visible if status IN ('PRICED_DRAFT', 'HUMAN_REVIEW')
 * - Multi-lot: per-lot collapsible sections, aggregated totals from root columns
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { AlertCircle, CheckCircle2, ChevronDown, ChevronUp, FileText, Loader2, Lock, Info, Package } from 'lucide-react';
import { DutyBreakdownTable } from './DutyBreakdownTable';
import { LineProvenanceBadges } from './LineProvenanceBadges';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePricingResultData } from '@/hooks/usePricingResultData';

interface PricingResultPanelProps {
  caseId: string;
  isLocked?: boolean;
  refreshToken?: number;
}

export function PricingResultPanel({ caseId, isLocked = false, refreshToken }: PricingResultPanelProps) {
  const { pricingRun, versions, isLoading, refetchVersions } = usePricingResultData(caseId, refreshToken);
  const [isCreating, setIsCreating] = useState(false);
  const [linesExpanded, setLinesExpanded] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [expandedLots, setExpandedLots] = useState<Record<number, boolean>>({});

  if (isLoading) {
    return (
      <Card className="border-muted animate-pulse">
        <CardHeader className="pb-3">
          <div className="h-5 bg-muted rounded w-1/3" />
        </CardHeader>
        <CardContent>
          <div className="h-20 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  if (!pricingRun) return null;

  const isMultiLot = !!(pricingRun.outputs_json as any)?.multi_lot;
  const lots: any[] = isMultiLot ? ((pricingRun.outputs_json as any)?.lots || []) : [];

  const tariffLines = pricingRun.tariff_lines || [];
  const tariffSources = pricingRun.tariff_sources || [];
  const toConfirmCount = tariffLines.filter((l: any) => l.source?.type === 'TO_CONFIRM').length;
  const nextVersionNumber = versions.length > 0
    ? Math.max(...versions.map(v => v.version_number)) + 1
    : 1;

  const handleCreateVersion = async () => {
    setIsCreating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-quotation-version', {
        body: { case_id: caseId }
      });
      if (error) throw error;
      toast.success(`Version v${data.version_number} créée`, {
        description: `${data.lines_count} lignes • ${new Intl.NumberFormat('fr-FR').format(data.total_ht)} ${data.currency}`,
      });
      setConfirmOpen(false);
      await refetchVersions();
    } catch (err) {
      console.error('Create version error:', err);
      toast.error('Erreur lors de la création de version', {
        description: err instanceof Error ? err.message : 'Erreur inconnue',
      });
    } finally {
      setIsCreating(false);
    }
  };

  const formatAmount = (amount: number | null) => {
    if (amount === null || amount === undefined) return '—';
    return new Intl.NumberFormat('fr-FR').format(amount);
  };

  const toggleLot = (lotIndex: number) => {
    setExpandedLots(prev => ({ ...prev, [lotIndex]: !prev[lotIndex] }));
  };

  return (
    <Card className="border-emerald-200 dark:border-emerald-800 bg-gradient-to-br from-emerald-50/50 to-background dark:from-emerald-950/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            <CardTitle className="text-lg">Résultat Pricing Run #{pricingRun.run_number}</CardTitle>
            {isMultiLot && (
              <Badge variant="outline" className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 text-xs">
                Multi-lot ({lots.length})
              </Badge>
            )}
          </div>
          <Badge variant="outline" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300">
            Succès
          </Badge>
        </div>
        <CardDescription>
          Calcul terminé le {pricingRun.completed_at ? format(new Date(pricingRun.completed_at), "d MMMM yyyy 'à' HH:mm", { locale: fr }) : '—'}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Regime Blocker Alert */}
        {(() => {
          const outputs = pricingRun.outputs_json as any;
          const blockers = Array.isArray(outputs?.pricing_blockers) ? outputs.pricing_blockers : [];
          const regimeCode = outputs?.metadata?.duties_regime_code;
          return (
            <>
              {blockers.includes("REGIME_REQUIRED_FOR_EXEMPTION") && (
                <Alert variant="default" className="border-amber-300 bg-amber-50/80 dark:border-amber-700 dark:bg-amber-950/30">
                  <AlertCircle className="h-4 w-4 text-amber-600" />
                  <AlertDescription className="text-amber-800 dark:text-amber-200">
                    Titre d'exonération détecté — renseignez le <strong>régime douanier</strong> pour calculer les exonérations.
                  </AlertDescription>
                </Alert>
              )}
              {regimeCode && (
                <Badge variant="outline" className="bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  Régime : {regimeCode}
                </Badge>
              )}
            </>
          );
        })()}

        {/* Summary Section — always reads root columns (backward compat) */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 p-4 bg-muted/50 rounded-lg">
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {formatAmount(pricingRun.total_ht)}
            </p>
            <p className="text-xs text-muted-foreground">Honoraires HT ({pricingRun.currency || 'XOF'})</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {formatAmount(tariffLines.reduce((sum: number, l: any) => sum + (Number(l.amount) || 0), 0))}
            </p>
            <p className="text-xs text-muted-foreground">Total lignes ({pricingRun.currency || 'XOF'})</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{tariffLines.length}</p>
            <p className="text-xs text-muted-foreground">Lignes tarifaires</p>
          </div>
          <div className="text-center">
            {toConfirmCount > 0 ? (
              <>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">{toConfirmCount}</p>
                <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">À confirmer</p>
                <div className="mt-1 space-y-0.5">
                  {tariffLines
                    .filter((l: any) => l.source?.type === 'TO_CONFIRM')
                    .slice(0, 3)
                    .map((l: any, i: number) => (
                      <p key={i} className="text-[10px] text-amber-600/80 dark:text-amber-400/80 truncate max-w-[120px] mx-auto">
                        {l.category || l.service_code || l.charge_code || `Ligne ${i + 1}`}
                      </p>
                    ))}
                  {toConfirmCount > 3 && (
                    <p className="text-[10px] text-amber-600/60">+{toConfirmCount - 3} autres</p>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">✓</p>
                <p className="text-xs text-muted-foreground">Tout confirmé</p>
              </>
            )}
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold">{versions.length}</p>
            <p className="text-xs text-muted-foreground">Versions créées</p>
          </div>
        </div>

        {/* Tariff Sources */}
        {tariffSources.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tariffSources.slice(0, 5).map((source: any, idx: number) => (
              <Badge key={idx} variant="secondary" className="text-xs">
                {source.table || source.source || `Source ${idx + 1}`}
              </Badge>
            ))}
            {tariffSources.length > 5 && (
              <Badge variant="outline" className="text-xs">
                +{tariffSources.length - 5} autres
              </Badge>
            )}
          </div>
        )}

        {/* Multi-lot: Per-lot collapsible sections */}
        {isMultiLot && lots.length > 0 && (
          <div className="space-y-2">
            {lots.map((lot: any) => {
              const lotLines = lot.lines || [];
              const lotTotals = lot.totals || {};
              const isLotExpanded = expandedLots[lot.lot_index] ?? false;

              return (
                <Collapsible key={lot.lot_index} open={isLotExpanded} onOpenChange={() => toggleLot(lot.lot_index)}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full justify-between border border-border/50 rounded-lg">
                      <span className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-blue-500" />
                        <span className="font-medium">{lot.label || `Lot ${lot.lot_index}`}</span>
                        <Badge variant="secondary" className="text-xs">{lotLines.length} lignes</Badge>
                        <span className="text-sm text-muted-foreground">
                          {formatAmount(lotTotals.ht)} {lotTotals.currency || 'XOF'} HT
                        </span>
                      </span>
                      {isLotExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="mt-2 border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr>
                            <th className="text-left p-2 font-medium">Service</th>
                            <th className="text-left p-2 font-medium">Description</th>
                            <th className="text-right p-2 font-medium">Montant</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lotLines.slice(0, 15).map((line: any, idx: number) => {
                            const value = line.amount ?? line.total;
                            const isToConfirm = value == null && line.source?.type === 'TO_CONFIRM';
                            return (
                              <tr key={idx} className={`border-t ${isToConfirm ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
                                <td className="p-2 font-mono text-xs">
                            {line.service_code || line.charge_code || line.category || `L${idx + 1}`}
                          </td>
                          <td className="p-2 text-muted-foreground">
                            <div>
                              {isToConfirm ? (
                                <span className="text-amber-700 dark:text-amber-300">
                                  {(line.source?.note || line.description || line.charge_name || line.label || '').substring(0, 50)}
                                </span>
                              ) : (
                                (line.description || line.charge_name || line.label || '').substring(0, 40)
                              )}
                              <LineProvenanceBadges canonical={line.canonical} />
                            </div>
                          </td>
                                <td className="p-2 text-right font-medium">
                                  {isToConfirm ? (
                                    <Badge variant="outline" className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 text-xs">
                                      <AlertCircle className="h-3 w-3 mr-1" />
                                      À confirmer
                                    </Badge>
                                  ) : value == null ? (
                                    <span className="text-muted-foreground">—</span>
                                  ) : (
                                    formatAmount(value)
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                          {lotLines.length > 15 && (
                            <tr className="border-t bg-muted/50">
                              <td colSpan={3} className="p-2 text-center text-muted-foreground text-xs">
                                +{lotLines.length - 15} lignes supplémentaires
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    {/* Per-lot duty breakdown */}
                    {lot.duty_breakdown && lot.duty_breakdown.length > 0 && (
                      <div className="mt-2">
                        <DutyBreakdownTable items={lot.duty_breakdown} currency={lotTotals.currency || 'XOF'} />
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        )}

        {/* Mono-lot: Flat tariff lines (fallback when not multi-lot) */}
        {!isMultiLot && tariffLines.length > 0 && (
          <Collapsible open={linesExpanded} onOpenChange={setLinesExpanded}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  Détail des lignes tarifaires
                </span>
                {linesExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-2 border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-2 font-medium">Service</th>
                      <th className="text-left p-2 font-medium">Description</th>
                      <th className="text-right p-2 font-medium">Montant</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tariffLines.slice(0, 10).map((line: any, idx: number) => {
                      const value = line.amount ?? line.total;
                      const isToConfirm = value == null && line.source?.type === 'TO_CONFIRM';
                      return (
                        <tr key={idx} className={`border-t ${isToConfirm ? 'bg-amber-50/60 dark:bg-amber-950/20' : ''}`}>
                          <td className="p-2 font-mono text-xs">
                            {line.service_code || line.charge_code || line.category || `L${idx + 1}`}
                          </td>
                          <td className="p-2 text-muted-foreground">
                            <div>
                              {isToConfirm ? (
                                <span className="text-amber-700 dark:text-amber-300">
                                  {(line.source?.note || line.description || line.charge_name || line.label || '').substring(0, 50)}
                                </span>
                              ) : (
                                (line.description || line.charge_name || line.label || '').substring(0, 40)
                              )}
                              <LineProvenanceBadges canonical={line.canonical} />
                            </div>
                          </td>
                          <td className="p-2 text-right font-medium">
                            {isToConfirm ? (
                              <Badge variant="outline" className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 text-xs">
                                <AlertCircle className="h-3 w-3 mr-1" />
                                À confirmer
                              </Badge>
                            ) : value == null ? (
                              <span className="text-muted-foreground">—</span>
                            ) : (
                              formatAmount(value)
                            )}
                          </td>
                        </tr>
                      );
                    })}
                    {tariffLines.length > 10 && (
                      <tr className="border-t bg-muted/50">
                        <td colSpan={3} className="p-2 text-center text-muted-foreground text-xs">
                          +{tariffLines.length - 10} lignes supplémentaires
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Duty Breakdown Table (mono-lot only — multi-lot has per-lot breakdown) */}
        {!isMultiLot && pricingRun.outputs_json?.duty_breakdown && pricingRun.outputs_json.duty_breakdown.length > 0 && (
          <DutyBreakdownTable
            items={pricingRun.outputs_json.duty_breakdown}
            currency={pricingRun.currency || 'XOF'}
          />
        )}

        {/* Version Creation Alert */}
        {isLocked ? (
          <Alert variant="default" className="border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/20">
            <Info className="h-4 w-4 text-emerald-600" />
            <AlertDescription className="text-emerald-800 dark:text-emerald-200">
              <span className="font-medium">Devis envoyé</span> — La création de nouvelles versions est désactivée.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="default" className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20">
            <Lock className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 dark:text-amber-200">
              <span className="font-medium">Création de version :</span> Cette action fige les données du pricing et crée une version immuable du devis (non modifiable).
            </AlertDescription>
          </Alert>
        )}

        {/* Create Version Button with Confirmation */}
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogTrigger asChild>
            <Button
              className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
              disabled={isCreating || isLocked}
            >
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Création en cours...
                </>
              ) : (
                <>
                  <FileText className="h-4 w-4" />
                  Créer version de devis v{nextVersionNumber}
                </>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <Lock className="h-5 w-5 text-amber-600" />
                Confirmer la création de version
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>
                  Vous êtes sur le point de créer la <strong>version v{nextVersionNumber}</strong> du devis.
                </p>
                <p className="text-amber-600 dark:text-amber-400 font-medium">
                  Cette action est irréversible. Les données du pricing seront figées et ne pourront plus être modifiées.
                </p>
                <div className="bg-muted p-3 rounded-lg mt-3">
                  <p className="text-sm font-medium">Résumé :</p>
                  <ul className="text-sm text-muted-foreground mt-1 space-y-1">
                    <li>• {tariffLines.length} lignes tarifaires{isMultiLot ? ` (${lots.length} lots)` : ''}</li>
                    <li>• Total HT : {formatAmount(pricingRun.total_ht)} {pricingRun.currency || 'XOF'}</li>
                    <li>• Statut : DRAFT (non envoyé au client)</li>
                  </ul>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isCreating}>Annuler</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleCreateVersion}
                disabled={isCreating}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Création...
                  </>
                ) : (
                  'Confirmer et créer'
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}