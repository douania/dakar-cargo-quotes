/**
 * DCQ-MARITIME-FEES-RUNTIME-UI-B3 — Panneau UI opérateur "Propositions maritimes".
 *
 * P1-B2 : décisions humaines explicites, sans déclenchement du pricing ici :
 * - Appelle `manage-maritime-fee-decision` sur clic explicite uniquement.
 * - Écrit exclusivement dans le registre append-only maritime_fee_decisions.
 * - N'appelle NI run-pricing NI quotation-engine NI set-case-fact NI génération
 *   de version. Ne produit aucun PDF/email.
 * - `suggested_amount_xof` est un MONTANT INDICATIF, jamais compté, jamais sommé,
 *   jamais transformé en total. `amount` reste null (montant ferme = aucun).
 * - Le pricing suivant consomme la décision sous gardes B2 ; une suggestion
 *   n'est jamais un montant TTC vérifié sans attestation humaine explicite.
 */

import { useEffect, useRef, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  Anchor,
  CheckCircle2,
  Info,
  Loader2,
  Pencil,
  ShieldAlert,
  Ship,
  Undo2,
  XCircle,
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
  decision_key: string;
  proposal_fingerprint: string;
  current_decision: MaritimeFeeDecision | null;
}

interface MaritimeFeeDecision {
  id: string;
  decision_key: string;
  proposal_id?: string;
  proposal_category?: string;
  source_reference?: string;
  decision_action: "confirm" | "adjust" | "reject" | "revoke";
  suggested_amount_xof?: number | null;
  decided_amount_xof: number | null;
  decision_version: number;
  decision_source: string;
  justification: string;
  created_at: string;
  is_stale?: boolean;
}

interface DecisionEnvelope {
  ok: boolean;
  mode: string;
  accounting_effect: string;
  amount_policy: string;
  proposals: MaritimeFeeProposal[];
  warnings: string[];
  decision_history: MaritimeFeeDecision[];
  unmatched_current_decisions?: MaritimeFeeDecision[];
}

type DraftAction = "confirm" | "adjust" | "reject" | "revoke";

interface DecisionDraft {
  proposal: MaritimeFeeProposal;
  action: DraftAction;
  amountXof: string;
  supplierInvoiceTtcConfirmed: boolean;
  decisionSource: string;
  justification: string;
  idempotencyKey: string;
}

// Décision orpheline : présente dans l'historique mais plus produite par le
// moteur (faits modifiés). Seule une révocation est permise, jamais une
// nouvelle confirmation sur une proposition disparue.
interface OrphanDecisionDraft {
  decision: MaritimeFeeDecision;
  decisionSource: string;
  justification: string;
  idempotencyKey: string;
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
  // Le brouillon et les requêtes appartiennent à un seul dossier, même avant
  // l'exécution des effets du nouveau rendu.
  return <MaritimeFeeProposalsForCase key={caseId} caseId={caseId} />;
}

function MaritimeFeeProposalsForCase({ caseId }: MaritimeFeeProposalsPanelProps) {
  const [fetchState, setFetchState] = useState<FetchState>("idle");
  const [envelope, setEnvelope] = useState<DecisionEnvelope | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [decisionDraft, setDecisionDraft] = useState<DecisionDraft | null>(
    null,
  );
  const [orphanDraft, setOrphanDraft] = useState<OrphanDecisionDraft | null>(
    null,
  );
  const [decisionSaving, setDecisionSaving] = useState(false);
  const savingRef = useRef(false);
  // Incrémenté à chaque changement de dossier : toute réponse list/mutation
  // en vol dont l'epoch capturé ne correspond plus à celui-ci est ignorée,
  // pour qu'un ancien brouillon ou une réponse tardive ne s'applique jamais
  // au nouveau dossier.
  const caseEpochRef = useRef(0);

  useEffect(() => {
    caseEpochRef.current += 1;
    setFetchState("idle");
    setEnvelope(null);
    setErrorMessage(null);
    setDecisionDraft(null);
    setOrphanDraft(null);
    savingRef.current = false;
    setDecisionSaving(false);
    return () => { caseEpochRef.current += 1; };
  }, [caseId]);

  function newIdempotencyKey(): string {
    const nonce = typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `maritime-ui-${nonce}`;
  }

  async function loadProposals() {
    if (!caseId || savingRef.current) return;
    const requestCaseId = caseId;
    const epoch = caseEpochRef.current;
    setFetchState("loading");
    setErrorMessage(null);
    setDecisionDraft(null);
    setOrphanDraft(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "manage-maritime-fee-decision",
        { body: { operation: "list", case_id: requestCaseId } },
      );
      if (caseEpochRef.current !== epoch) return;
      if (error) throw error;
      const env = data as DecisionEnvelope;
      setEnvelope(env);
      const proposals = Array.isArray(env?.proposals) ? env.proposals : [];
      setFetchState(proposals.length === 0 ? "empty" : "success");
    } catch (e) {
      if (caseEpochRef.current !== epoch) return;
      setErrorMessage(
        e instanceof Error ? e.message : "Erreur inattendue lors de l'appel.",
      );
      setFetchState("error");
    }
  }

  function startDecision(proposal: MaritimeFeeProposal, action: DraftAction) {
    setErrorMessage(null);
    setOrphanDraft(null);
    setDecisionDraft({
      proposal,
      action,
      amountXof: action === "adjust" && proposal.category !== "commission_debours" && proposal.suggested_amount_xof != null
        ? String(proposal.suggested_amount_xof)
        : "",
      decisionSource: "",
      supplierInvoiceTtcConfirmed: false,
      justification: "",
      idempotencyKey: newIdempotencyKey(),
    });
  }

  async function submitDecision() {
    if (!decisionDraft || savingRef.current) return;
    const source = decisionDraft.decisionSource.trim();
    const justification = decisionDraft.justification.trim();
    if (source.length < 3 || justification.length < 3) return;

    const proposal = decisionDraft.proposal;
    const requestCaseId = caseId;
    const epoch = caseEpochRef.current;
    const body: Record<string, unknown> = {
      operation: decisionDraft.action,
      case_id: requestCaseId,
      decision_source: source,
      justification,
      idempotency_key: decisionDraft.idempotencyKey,
    };
    if (decisionDraft.action === "revoke") {
      body.decision_key = proposal.decision_key;
      body.expected_decision_version = proposal.current_decision
        ?.decision_version;
    } else {
      body.proposal_id = proposal.id;
      body.expected_proposal_fingerprint = proposal.proposal_fingerprint;
      if (proposal.category === "commission_debours" &&
        ["confirm", "adjust"].includes(decisionDraft.action)) {
        if (!decisionDraft.supplierInvoiceTtcConfirmed) return;
        body.supplier_invoice_ttc_confirmed = true;
      }
      if (decisionDraft.action === "adjust") {
        const amount = Number(decisionDraft.amountXof);
        if (!Number.isSafeInteger(amount) || amount <= 0) return;
        body.amount_xof = amount;
      }
    }

    savingRef.current = true;
    setDecisionSaving(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "manage-maritime-fee-decision",
        { body },
      );
      if (caseEpochRef.current !== epoch) return;
      if (error) throw error;
      const env = data as DecisionEnvelope;
      setEnvelope(env);
      setFetchState(env.proposals?.length ? "success" : "empty");
      setDecisionDraft(null);
    } catch (error) {
      if (caseEpochRef.current !== epoch) return;
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Échec de la décision maritime.",
      );
    } finally {
      if (caseEpochRef.current === epoch) {
        savingRef.current = false;
        setDecisionSaving(false);
      }
    }
  }

  function startOrphanRevoke(decision: MaritimeFeeDecision) {
    setErrorMessage(null);
    setDecisionDraft(null);
    setOrphanDraft({
      decision,
      decisionSource: "",
      justification: "",
      idempotencyKey: newIdempotencyKey(),
    });
  }

  async function submitOrphanRevoke() {
    if (!orphanDraft || savingRef.current) return;
    const source = orphanDraft.decisionSource.trim();
    const justification = orphanDraft.justification.trim();
    if (source.length < 3 || justification.length < 3) return;

    const requestCaseId = caseId;
    const epoch = caseEpochRef.current;
    const body: Record<string, unknown> = {
      operation: "revoke",
      case_id: requestCaseId,
      decision_key: orphanDraft.decision.decision_key,
      expected_decision_version: orphanDraft.decision.decision_version,
      decision_source: source,
      justification,
      idempotency_key: orphanDraft.idempotencyKey,
    };

    savingRef.current = true;
    setDecisionSaving(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "manage-maritime-fee-decision",
        { body },
      );
      if (caseEpochRef.current !== epoch) return;
      if (error) throw error;
      const env = data as DecisionEnvelope;
      setEnvelope(env);
      setFetchState(env.proposals?.length ? "success" : "empty");
      setOrphanDraft(null);
    } catch (error) {
      if (caseEpochRef.current !== epoch) return;
      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Échec de la décision maritime.",
      );
    } finally {
      if (caseEpochRef.current === epoch) {
        savingRef.current = false;
        setDecisionSaving(false);
      }
    }
  }

  const proposals = envelope?.proposals ?? [];
  const warnings = envelope?.warnings ?? [];
  const unmatchedActive = (envelope?.unmatched_current_decisions ?? [])
    .filter((decision) => decision.decision_action !== "revoke");

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
                Décisions humaines auditées — taxe de port PAD &amp; commission
                consignataire.
              </CardDescription>
            </div>
          </div>
          {/* Une décision ne déclenche aucun recalcul depuis ce panneau. */}
          <Badge
            variant="outline"
            className="shrink-0 border-amber-400 text-amber-700 dark:text-amber-300"
          >
            Recalcul requis pour intégrer une décision
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

        {(fetchState === "success" || fetchState === "empty") && (
          <>
            {errorMessage && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Décision non enregistrée</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}
            <OrphanDecisionsBlock
              decisions={unmatchedActive}
              draft={orphanDraft}
              saving={decisionSaving}
              onStartRevoke={startOrphanRevoke}
              onChangeDraft={setOrphanDraft}
              onCancelDraft={() => setOrphanDraft(null)}
              onSubmit={submitOrphanRevoke}
            />
          </>
        )}

        {fetchState === "empty" && (
          <div className="space-y-3">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Aucune proposition maritime</AlertTitle>
              <AlertDescription>
                Le moteur n'a produit aucune proposition (périmètre hors IMPORT
                ou données insuffisantes).
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
              Suggestions indicatives, jamais additionnées automatiquement.
              Les décisions seront contrôlées au prochain pricing ; ce panneau
              ne modifie pas un devis déjà généré.
            </div>

            {proposals.map((p) => {
              const canSetAmount = p.suggested_amount_xof != null &&
                p.suggested_amount_xof > 0 &&
                p.missing_confirmation.length === 0;
              const current = p.current_decision;
              const canRevoke = current && current.decision_action !== "revoke";
              const draftOpen = decisionDraft?.proposal.id === p.id;
              return (
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

                  {p.category === "commission_debours" && (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Formule indicative, pas un TTC fournisseur vérifié. Reprendre
                      le montant de ce frais sur la facture, TVA incluse, sans
                      ajouter de TVA SODATRA ni recopier le total de la facture.
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

                  {current && (
                    <Alert
                      className={current.is_stale
                        ? "border-amber-400"
                        : "border-emerald-300"}
                    >
                      <Info className="h-4 w-4" />
                      <AlertTitle className="text-sm">
                        Décision v{current.decision_version} :{" "}
                        {decisionActionLabel(current.decision_action)}
                      </AlertTitle>
                      <AlertDescription className="space-y-1 text-xs">
                        {current.decided_amount_xof != null && (
                          <p>
                            Montant décidé :{" "}
                            {formatXof(current.decided_amount_xof)}
                          </p>
                        )}
                        <p>Source opérateur : {current.decision_source}</p>
                        <p>Justification : {current.justification}</p>
                        {current.is_stale && (
                          <p className="font-medium text-amber-700 dark:text-amber-300">
                            Décision obsolète : les faits ou la proposition ont
                            changé.
                          </p>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canSetAmount || decisionSaving}
                      onClick={() => startDecision(p, "confirm")}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                      Confirmer
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canSetAmount || decisionSaving}
                      onClick={() => startDecision(p, "adjust")}
                    >
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Ajuster
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={decisionSaving}
                      onClick={() => startDecision(p, "reject")}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1.5" />
                      Rejeter
                    </Button>
                    {canRevoke && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={decisionSaving}
                        onClick={() => startDecision(p, "revoke")}
                      >
                        <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                        Révoquer la décision
                      </Button>
                    )}
                  </div>

                  {draftOpen && decisionDraft && (
                    <div className="rounded-md border bg-background p-3 space-y-3">
                      <p className="text-sm font-medium">
                        {decisionActionLabel(decisionDraft.action)} — {p.label}
                      </p>
                      {decisionDraft.action === "adjust" && (
                        <div className="space-y-1.5">
                          <Label htmlFor={`maritime-amount-${p.id}`}>
                            {p.category === "commission_debours"
                              ? "Montant TTC de ce frais sur la facture (XOF)"
                              : "Montant final XOF"}
                          </Label>
                          <Input
                            id={`maritime-amount-${p.id}`}
                            type="number"
                            min={1}
                            step={1}
                            value={decisionDraft.amountXof}
                            onChange={(event) =>
                              setDecisionDraft({
                                ...decisionDraft,
                                amountXof: event.target.value,
                              })}
                          />
                        </div>
                      )}
                      {p.category === "commission_debours" &&
                        ["confirm", "adjust"].includes(decisionDraft.action) && (
                        <div className="flex items-start gap-2">
                          <Checkbox
                            id={`maritime-ttc-${p.id}`}
                            checked={decisionDraft.supplierInvoiceTtcConfirmed}
                            onCheckedChange={(checked) => setDecisionDraft({
                              ...decisionDraft, supplierInvoiceTtcConfirmed: checked === true,
                            })}
                          />
                          <Label htmlFor={`maritime-ttc-${p.id}`} className="text-xs leading-relaxed">
                            J'atteste que {decisionDraft.action === "confirm"
                              ? `le montant proposé (${formatXof(p.suggested_amount_xof ?? 0)})`
                              : "le montant saisi"} est exactement le TTC de ce frais
                            sur la facture fournisseur, TVA incluse. Sinon, ajuster
                            au TTC réellement facturé.
                          </Label>
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor={`maritime-source-${p.id}`}>
                          Source de la décision
                        </Label>
                        <Input
                          id={`maritime-source-${p.id}`}
                          value={decisionDraft.decisionSource}
                          placeholder="Ex. facture fournisseur du 29/08/2026"
                          onChange={(event) =>
                            setDecisionDraft({
                              ...decisionDraft,
                              decisionSource: event.target.value,
                            })}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`maritime-reason-${p.id}`}>
                          Justification opérateur
                        </Label>
                        <Textarea
                          id={`maritime-reason-${p.id}`}
                          value={decisionDraft.justification}
                          placeholder="Décrire le contrôle effectué et la raison de la décision."
                          onChange={(event) =>
                            setDecisionDraft({
                              ...decisionDraft,
                              justification: event.target.value,
                            })}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={decisionSaving ||
                            (p.category === "commission_debours" &&
                              ["confirm", "adjust"].includes(decisionDraft.action) &&
                              !decisionDraft.supplierInvoiceTtcConfirmed) ||
                            decisionDraft.decisionSource.trim().length < 3 ||
                            decisionDraft.justification.trim().length < 3 ||
                            (decisionDraft.action === "adjust" &&
                              (!Number.isSafeInteger(
                                Number(decisionDraft.amountXof),
                              ) ||
                                Number(decisionDraft.amountXof) <= 0))}
                          onClick={submitDecision}
                        >
                          {decisionSaving && (
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          )}
                          Enregistrer la décision
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={decisionSaving}
                          onClick={() => setDecisionDraft(null)}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Preuve doctrine : le montant ferme reste null (jamais compté). */}
                  <p className="text-[11px] text-muted-foreground/60">
                    Montant ferme : {String(p.amount)}{" "}
                    — confirmation humaine requise.
                  </p>
                </div>
              );
            })}

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

function OrphanDecisionsBlock({
  decisions,
  draft,
  saving,
  onStartRevoke,
  onChangeDraft,
  onCancelDraft,
  onSubmit,
}: {
  decisions: MaritimeFeeDecision[];
  draft: OrphanDecisionDraft | null;
  saving: boolean;
  onStartRevoke: (decision: MaritimeFeeDecision) => void;
  onChangeDraft: (draft: OrphanDecisionDraft) => void;
  onCancelDraft: () => void;
  onSubmit: () => void;
}) {
  if (decisions.length === 0) return null;
  return (
    <div className="space-y-2">
      <Alert className="border-amber-400">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle className="text-sm">
          Décisions orphelines actives
        </AlertTitle>
        <AlertDescription className="text-xs">
          Ces décisions ne correspondent plus à une proposition actuelle du
          moteur. Aucune nouvelle confirmation possible : seule une
          révocation est permise.
        </AlertDescription>
      </Alert>
      {decisions.map((decision) => {
        const draftOpen = draft?.decision.id === decision.id;
        return (
          <div
            key={decision.id}
            className="rounded-lg border border-amber-300/70 bg-amber-50/40 dark:bg-amber-950/10 p-3 space-y-2"
          >
            <p className="text-sm font-medium">
              {decision.proposal_category ?? decision.decision_key}
            </p>
            <p className="text-xs font-mono break-words">{decision.decision_key}</p>
            <p className="text-xs text-muted-foreground">
              Décision v{decision.decision_version} :{" "}
              {decisionActionLabel(decision.decision_action)}
            </p>
            {decision.decided_amount_xof != null && (
              <p className="text-xs">
                Montant décidé : {formatXof(decision.decided_amount_xof)}
              </p>
            )}
            {decision.decided_amount_xof == null && (
              <p className="text-xs">Aucun montant décidé.
                {decision.suggested_amount_xof != null &&
                  ` Ancien montant indicatif : ${formatXof(decision.suggested_amount_xof)} (non compté).`}
              </p>
            )}
            {decision.source_reference && (
              <p className="text-xs text-muted-foreground">Source initiale : {decision.source_reference}</p>
            )}
            <p className="text-xs text-muted-foreground">
              Source opérateur : {decision.decision_source}
            </p>
            <p className="text-xs text-muted-foreground">Justification : {decision.justification}</p>
            <p className="text-[11px] text-amber-700 dark:text-amber-300 font-medium">
              Obsolète : proposition disparue du moteur.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => onStartRevoke(decision)}
            >
              <Undo2 className="h-3.5 w-3.5 mr-1.5" />
              Révoquer la décision
            </Button>

            {draftOpen && draft && (
              <div className="rounded-md border bg-background p-3 space-y-3">
                <p className="text-sm font-medium">
                  Révocation — {decision.decision_key}
                </p>
                <div className="space-y-1.5">
                  <Label htmlFor={`orphan-source-${decision.id}`}>
                    Source de la décision
                  </Label>
                  <Input
                    id={`orphan-source-${decision.id}`}
                    value={draft.decisionSource}
                    placeholder="Ex. dossier réexaminé le 29/08/2026"
                    onChange={(event) =>
                      onChangeDraft({
                        ...draft,
                        decisionSource: event.target.value,
                      })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`orphan-reason-${decision.id}`}>
                    Justification opérateur
                  </Label>
                  <Textarea
                    id={`orphan-reason-${decision.id}`}
                    value={draft.justification}
                    placeholder="Décrire pourquoi cette décision orpheline est révoquée."
                    onChange={(event) =>
                      onChangeDraft({
                        ...draft,
                        justification: event.target.value,
                      })}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving ||
                      draft.decisionSource.trim().length < 3 ||
                      draft.justification.trim().length < 3}
                    onClick={onSubmit}
                  >
                    {saving && (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    )}
                    Enregistrer la révocation
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={onCancelDraft}
                  >
                    Annuler
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function decisionActionLabel(action: DraftAction): string {
  const labels: Record<DraftAction, string> = {
    confirm: "Confirmation",
    adjust: "Ajustement",
    reject: "Rejet",
    revoke: "Révocation",
  };
  return labels[action];
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
