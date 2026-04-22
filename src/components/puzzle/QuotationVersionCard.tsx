/**
 * Phase 12 + Lot 3A: QuotationVersionCard
 * Displays existing quotation versions with selection, PDF export,
 * and commercial qualification badge (firm / provisional / partial).
 * 
 * CTO Rules:
 * - Read-only display of quotation_versions
 * - Human selects active version via explicit action
 * - PDF export writes to quotation_documents with traceability
 * - PATCH BONUS: Sélection atomique via RPC select_quotation_version
 * 
 * Lot 3A: Badge qualification + fallback historique
 * - Si snapshot.meta.quoteQualification existe → source de vérité
 * - Sinon fallback via raw_lines[].source.type === "TO_CONFIRM"
 */

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Check, FileDown, Loader2, Clock, FileText, ExternalLink, AlertTriangle, ShieldCheck, ShieldAlert } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePricingResultData, QuotationVersion } from '@/hooks/usePricingResultData';

// ── Qualification types & helpers ────────────────────────────────────────────

interface QuoteQualification {
  level: "firm" | "provisional" | "partial";
  reasons: Array<{ code: string; message: string; field?: string }>;
  firmTotalPolicy: "all_included" | "excludes_reserved_items";
}

const REASON_LABELS: Record<string, string> = {
  MISSING_CARGO_VALUE: "Valeur marchandise en attente",
  MISSING_HS_CODE: "Code HS a confirmer",
  PAD_CATEGORY_UNRESOLVED: "Categorie PAD a confirmer",
  PARTNER_COST_PENDING: "Cout partenaire en attente",
  RATE_PENDING_CONFIRMATION: "Certains tarifs restent a confirmer",
};

const RATE_PENDING_REASON = {
  code: "RATE_PENDING_CONFIRMATION",
  message: "Certains tarifs restent à confirmer",
};

function hasToConfirmRawLines(snapshot: any): boolean {
  const rawLines = Array.isArray(snapshot?.raw_lines) ? snapshot.raw_lines : [];
  return rawLines.some((line: any) => {
    const src = line?.source;
    if (typeof src === "string") return src === "TO_CONFIRM";
    if (src && typeof src === "object") return src.type === "TO_CONFIRM";
    return false;
  });
}

function mergeReasonIfMissing(
  reasons: QuoteQualification["reasons"] | undefined,
  reason: QuoteQualification["reasons"][number],
): QuoteQualification["reasons"] {
  const list = Array.isArray(reasons) ? [...reasons] : [];
  if (list.some((r) => r?.code === reason.code)) return list;
  list.push(reason);
  return list;
}

/**
 * Resolve qualification from snapshot with historical fallback + Lot 3D-2 legacy guard.
 * Rule 1: use snapshot.meta.quoteQualification if present and valid.
 * Rule 1b (Lot 3D-2): if level === "firm" but raw_lines contains TO_CONFIRM → upgrade to provisional.
 *                     For partial/provisional, merge RATE_PENDING_CONFIRMATION if TO_CONFIRM present.
 * Rule 2: fallback — scan raw_lines for source.type === "TO_CONFIRM".
 */
function resolveQuoteQualification(snapshot: any): QuoteQualification {
  const meta = snapshot?.meta;
  const hasToConfirm = hasToConfirmRawLines(snapshot);

  if (
    meta?.quoteQualification &&
    typeof meta.quoteQualification.level === "string" &&
    ["firm", "provisional", "partial"].includes(meta.quoteQualification.level)
  ) {
    const incoming = meta.quoteQualification as QuoteQualification;

    // Lot 3D-2 garde : firm + TO_CONFIRM → upgrade provisional
    if (incoming.level === "firm" && hasToConfirm) {
      return {
        level: "provisional",
        reasons: mergeReasonIfMissing(incoming.reasons, RATE_PENDING_REASON),
        firmTotalPolicy: "excludes_reserved_items",
      };
    }

    if (incoming.level === "provisional") {
      return {
        level: "provisional",
        reasons: hasToConfirm
          ? mergeReasonIfMissing(incoming.reasons, RATE_PENDING_REASON)
          : (Array.isArray(incoming.reasons) ? incoming.reasons : []),
        firmTotalPolicy: hasToConfirm
          ? "excludes_reserved_items"
          : (incoming.firmTotalPolicy === "excludes_reserved_items"
              ? "excludes_reserved_items"
              : "all_included"),
      };
    }

    if (incoming.level === "partial") {
      return {
        level: "partial",
        reasons: hasToConfirm
          ? mergeReasonIfMissing(incoming.reasons, RATE_PENDING_REASON)
          : (Array.isArray(incoming.reasons) ? incoming.reasons : []),
        firmTotalPolicy: incoming.firmTotalPolicy === "excludes_reserved_items"
          ? "excludes_reserved_items"
          : "all_included",
      };
    }

    return incoming;
  }

  // Rule 2: meta absent/invalide → fallback raw_lines
  if (hasToConfirm) {
    return {
      level: "provisional",
      reasons: [RATE_PENDING_REASON],
      firmTotalPolicy: "excludes_reserved_items",
    };
  }

  return { level: "firm", reasons: [], firmTotalPolicy: "all_included" };
}

// ── Component ────────────────────────────────────────────────────────────────

interface QuotationVersionCardProps {
  caseId: string;
  isLocked?: boolean;
  refreshToken?: number;
}

export function QuotationVersionCard({ caseId, isLocked = false, refreshToken }: QuotationVersionCardProps) {
  const { versions, refetchVersions } = usePricingResultData(caseId, refreshToken);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});

  if (versions.length === 0) return null;

  const handleSelectVersion = async (versionId: string) => {
    setSelectingId(versionId);
    try {
      const { error: rpcError } = await supabase.rpc('select_quotation_version', {
        p_version_id: versionId,
        p_case_id: caseId,
      });
      if (rpcError) throw rpcError;
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
      const { data: response, error } = await supabase.functions.invoke('export-quotation-version-pdf', {
        body: { version_id: version.id }
      });
      if (error) throw error;

      // Contrat runtime Phase 14-15 : { ok, data, correlation_id }
      // Compat ancien format : { success, url }
      const payload = response?.ok === true ? response.data : response;
      const url = payload?.url;

      if (url) {
        setDownloadUrls(prev => ({ ...prev, [version.id]: url }));
        window.open(url, '_blank');
        toast.success(`PDF v${version.version_number} généré`, {
          description: 'PDF exporté. Vous pouvez maintenant finaliser la revue du brouillon avant marquage comme envoyé.',
        });
      } else {
        const message =
          response?.error?.message ||
          response?.error ||
          payload?.error?.message ||
          payload?.error ||
          'Échec de génération';
        throw new Error(typeof message === 'string' ? message : 'Échec de génération');
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

  const getQualificationBadge = (qualification: QuoteQualification) => {
    switch (qualification.level) {
      case 'firm':
        return (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800">
            <ShieldCheck className="h-3 w-3 mr-1" />
            Ferme
          </Badge>
        );
      case 'provisional':
        return (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">
            <ShieldAlert className="h-3 w-3 mr-1" />
            Provisoire
          </Badge>
        );
      case 'partial':
        return (
          <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-600">
            <AlertTriangle className="h-3 w-3 mr-1" />
            Partiel
          </Badge>
        );
    }
  };

  /** Short reserve summary: first reason + "+N" if more */
  const getReserveSummary = (qualification: QuoteQualification) => {
    if (qualification.reasons.length === 0) return null;
    const first = qualification.reasons[0];
    const label = REASON_LABELS[first.code] || first.message || first.code;
    const remaining = qualification.reasons.length - 1;
    return (
      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
        ⚠ {label}{remaining > 0 ? ` (+${remaining} autre${remaining > 1 ? 's' : ''})` : ''}
      </p>
    );
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
              const qualification = resolveQuoteQualification(snapshot);

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
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="font-semibold">Version v{version.version_number}</span>
                        {getStatusBadge(version.status, version.is_selected)}
                        {getQualificationBadge(qualification)}
                      </div>
                      
                      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(new Date(version.created_at), "d MMM yyyy HH:mm", { locale: fr })}
                        </span>
                        <span>{linesCount} lignes</span>
                        {snapshot?.meta?.pricing_run_number !== undefined && snapshot?.meta?.pricing_run_number !== null && (
                          <Badge variant="outline" className="text-xs font-normal">
                            Source : Pricing Run #{snapshot.meta.pricing_run_number}
                          </Badge>
                        )}
                      </div>

                      {totalHt !== undefined && (
                        <p className="mt-2 text-lg font-bold text-emerald-600 dark:text-emerald-400">
                          {formatAmount(totalHt)} {currency}
                        </p>
                      )}

                      {getReserveSummary(qualification)}
                    </div>

                    <div className="flex flex-col gap-2">
                      {!version.is_selected && !isLocked && (
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
