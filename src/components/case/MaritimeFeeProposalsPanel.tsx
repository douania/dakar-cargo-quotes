/**
 * DCQ-MARITIME-FEES-RUNTIME-UI-B3 — Panneau UI opérateur "Propositions maritimes".
 *
 * READ-ONLY / FRONTEND-ONLY. Doctrine B1/B2 strictement préservée :
 * - Appelle l'edge function `maritime-fee-proposals` sur clic explicite uniquement
 *   (aucun appel automatique). Enveloppe attendue : mode "proposal_only".
 * - N'écrit RIEN en DB. N'appelle NI run-pricing NI quotation-engine NI set-case-fact
 *   NI generate-quotation-version. Ne produit aucun PDF/email.
 * - `suggested_amount_xof` est un MONTANT INDICATIF, jamais compté, jamais sommé,
 *   jamais transformé en total. `amount` reste null (montant ferme = aucun).
 * - Aucun bouton "Ajouter au devis" / "Créer ligne" / "Inclure" / "Créer version"
 *   / "Envoyer client". Aucune proposition ne devient une tariff_line.
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Anchor,
  Ship,
  Loader2,
  AlertTriangle,
  Info,
  ShieldAlert,
} from "lucide-react";

// Forme d'une proposition renvoyée par le moteur B1 (via l'endpoint B2).
// `amount` est TOUJOURS null par doctrine — typé littéralement pour le prouver.
interface MaritimeFeeProposal {
  id: string;
  category: string;
  label: string;
  amount: null;
  currency: string;
  suggested_amount_xof: number | null;
  suggested_formula: string | null;
  source_reference: string;
  evidence_level: string;
  needs_human_confirmation: boolean;
  reason: string;
  missing_confirmation: string[];
}

interface ProposalOnlyEnvelope {
  ok: boolean;
  mode: string;
  accounting_effect: string;
  amount_policy: string;
  proposals: MaritimeFeeProposal[];
  warnings: string[];
  input_debug?: {
    operation_type: string | null;
    cargo_mode: string | null;
    carrier: string | null;
    has_tonnage: boolean;
    has_seafreight: boolean;
  };
}

type FetchState = "idle" | "loading" | "success" | "empty" | "error";

interface MaritimeFeeProposalsPanelProps {
  caseId: string;
}

function formatXof(value: number): string {
  return `${new Intl.NumberFormat("fr-FR").format(value)} FCFA`;
}

export default function MaritimeFeeProposalsPanel({
  caseId,
}: MaritimeFeeProposalsPanelProps) {
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [envelope, setEnvelope] = useState<ProposalOnlyEnvelope | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function loadProposals() {
    if (!caseId) return;
    setFetchState("loading");
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "maritime-fee-proposals",
        { body: { case_id: caseId } },
      );
      if (error) throw error;
      const env = data as ProposalOnlyEnvelope;
      setEnvelope(env);
      const proposals = Array.isArray(env?.proposals) ? env.proposals : [];
      setFetchState(proposals.length === 0 ? "empty" : "success");
    } catch (e) {
      setErrorMessage(
        e instanceof Error ? e.message : "Erreur inattendue lors de l'appel.",
      );
      setFetchState("error");
    }
  }

  const proposals = envelope?.proposals ?? [];
  const warnings = envelope?.warnings ?? [];

  return (
    <Card className="mb-4 border-cyan-200 dark:border-cyan-900/50">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <Ship className="h-5 w-5 text-cyan-600 dark:text-cyan-400 mt-0.5 shrink-0" />
            <div>
              <CardTitle className="text-base">
                Propositions maritimes à confirmer
              </CardTitle>
              <CardDescription>
                Assistance opérateur en lecture seule — taxe de port PAD &amp;
                commission consignataire.
              </CardDescription>
            </div>
          </div>
          {/* Garde-fou doctrine : jamais compté dans un total ferme. */}
          <Badge
            variant="outline"
            className="shrink-0 border-amber-400 text-amber-700 dark:text-amber-300"
          >
            Non inclus dans le total
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Déclencheur manuel — aucun appel automatique agressif. */}
        {fetchState === "idle" && (
          <Button variant="outline" size="sm" onClick={loadProposals}>
            <Anchor className="h-4 w-4 mr-2" />
            Voir propositions maritimes
          </Button>
        )}

        {fetchState === "loading" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Chargement des propositions…
            </div>
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        )}

        {fetchState === "error" && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Impossible de charger les propositions</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{errorMessage}</p>
              <Button variant="outline" size="sm" onClick={loadProposals}>
                Réessayer
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {fetchState === "empty" && (
          <div className="space-y-3">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Aucune proposition maritime</AlertTitle>
              <AlertDescription>
                Le moteur n'a produit aucune proposition (périmètre hors IMPORT ou
                données insuffisantes).
              </AlertDescription>
            </Alert>
            {warnings.length > 0 && <WarningsBlock warnings={warnings} />}
            <Button variant="ghost" size="sm" onClick={loadProposals}>
              Recharger
            </Button>
          </div>
        )}

        {fetchState === "success" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldAlert className="h-3.5 w-3.5" />
              Montants indicatifs, à confirmer manuellement — jamais additionnés,
              jamais reportés dans un total ou une ligne de devis.
            </div>

            {proposals.map((p) => (
              <div
                key={p.id}
                className="rounded-lg border border-border/70 bg-muted/30 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium">{p.label}</p>
                  {p.evidence_level && (
                    <Badge variant="secondary" className="shrink-0 text-xs">
                      {p.evidence_level}
                    </Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-xs text-muted-foreground">
                    Montant indicatif
                  </span>
                  <span className="text-sm font-semibold tabular-nums">
                    {p.suggested_amount_xof != null
                      ? formatXof(p.suggested_amount_xof)
                      : "À confirmer"}
                  </span>
                </div>

                {p.suggested_formula && (
                  <p className="text-xs text-muted-foreground font-mono break-words">
                    {p.suggested_formula}
                  </p>
                )}

                {p.reason && (
                  <p className="text-xs text-muted-foreground">{p.reason}</p>
                )}

                {p.missing_confirmation.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-amber-700 dark:text-amber-400">
                      À confirmer :
                    </span>
                    {p.missing_confirmation.map((m) => (
                      <Badge
                        key={m}
                        variant="outline"
                        className="text-xs border-amber-300 text-amber-700 dark:text-amber-400"
                      >
                        {m}
                      </Badge>
                    ))}
                  </div>
                )}

                {p.source_reference && (
                  <p className="text-[11px] text-muted-foreground/70">
                    Source : {p.source_reference}
                  </p>
                )}

                {/* Preuve doctrine : le montant ferme reste null (jamais compté). */}
                <p className="text-[11px] text-muted-foreground/60">
                  Montant ferme : {String(p.amount)} — confirmation humaine requise.
                </p>
              </div>
            ))}

            {warnings.length > 0 && <WarningsBlock warnings={warnings} />}

            <Button variant="ghost" size="sm" onClick={loadProposals}>
              Recharger
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WarningsBlock({ warnings }: { warnings: string[] }) {
  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Avertissements</AlertTitle>
      <AlertDescription>
        <ul className="list-disc pl-4 space-y-1">
          {warnings.map((w, i) => (
            <li key={i} className="text-xs">
              {w}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
