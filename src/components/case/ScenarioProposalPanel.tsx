import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { proposalReason, proposalToDraft, type ScenarioProposal } from "@/lib/scenarioProposal";
import type { ScenarioDraft } from "@/lib/quoteScenarios";

export interface ScenarioProposalAction { propose: () => void }

function responseMessage(body: unknown): string | null {
  const error = (body as { error?: unknown } | null)?.error;
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : null;
}

async function serverErrorMessage(error: unknown): Promise<string | null> {
  const context = (error as { context?: Response } | null)?.context;
  try { return context && typeof context.json === "function" ? responseMessage(await context.clone().json()) : null; }
  catch { return null; }
}
export function ScenarioProposalPanel({ caseId, disabled = false, onUseDraft, actionRef }: {
  caseId: string; disabled?: boolean; onUseDraft: (draft: ScenarioDraft) => void; actionRef?: Ref<ScenarioProposalAction>;
}) {
  const [proposal, setProposal] = useState<ScenarioProposal | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const panel = useRef<HTMLElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const propose = async () => {
    if (disabled || inFlight.current) return;
    inFlight.current = true; setPending(true); setError(null); setProposal(null);
    try {
      const response = await supabase.functions.invoke("recommend-pad-category", { body: { action: "propose_scenario", case_id: caseId } });
      if (response.error || response.data?.error) throw new Error(responseMessage(response.data) || await serverErrorMessage(response.error) || "Proposition indisponible : vérifier les droits et la source du dossier.");
      const data = response.data as ScenarioProposal & { case_id: string };
      if (data.case_id !== caseId || !["proposed", "needs_review"].includes(data.status) ||
        !Array.isArray(data.groups) || !Array.isArray(data.reasons) || !Array.isArray(data.pad_candidates)) throw new Error("Réponse de proposition invalide");
      if (data.status === "proposed") proposalToDraft(data);
      if (alive.current) setProposal(data);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Proposition indisponible"); }
    finally { inFlight.current = false; if (alive.current) setPending(false); }
  };
  useImperativeHandle(actionRef, () => ({ propose: () => {
    panel.current?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    void propose();
  } }));

  const handleUseDraft = async () => {
    if (!proposal || disabled || inFlight.current) return;
    inFlight.current = true; setPending(true); setError(null);
    try {
      const { data, error: checkError } = await supabase.functions.invoke("recommend-pad-category", {
        body: { action: "verify_scenario_source", case_id: caseId, source_fingerprint: proposal.source_fingerprint },
      });
      if (checkError || data?.verified !== true) throw new Error("Source modifiée ou non vérifiable : relancez la proposition. Aucun brouillon remplacé.");
      if (alive.current) onUseDraft(proposalToDraft(proposal));
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Source non vérifiée"); }
    finally { inFlight.current = false; if (alive.current) setPending(false); }
  };

  return <section ref={panel} className="rounded border border-sky-200 p-3 space-y-2" aria-label="Proposition contextuelle de scénario">
    <Button size="sm" variant="outline" disabled={disabled || pending} onClick={() => void propose()}>
      {pending ? "Vérification de la proposition…" : "Proposer les groupes et catégories PAD depuis les e-mails"}
    </Button>
    <p className="text-xs text-muted-foreground">Lecture seule. Aucun fait, scénario ou tarif enregistré automatiquement. Les photos ne sont pas analysées par ce parcours.</p>
    <p className="text-xs text-muted-foreground">Les extraits des lignes de marchandises sont transmis au fournisseur IA configuré pour les suggestions PAD ; les adresses e-mail y sont masquées.</p>
    {proposal?.status === "proposed" && <p className="text-xs">Hypothèse d’import maritime conteneurisé à Dakar, à vérifier avant création du scénario.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {proposal?.reasons.map(reason => <p key={reason} className="text-xs">{proposalReason(reason)}</p>)}
    {proposal?.groups.map(g => <div key={g.unit_ref} className="border-t pt-2 text-xs space-y-1">
      <p className="font-semibold">{g.unit_ref} — {g.quantity} × {g.equipment} {g.ownership}</p>
      <blockquote className="break-words">{g.excerpt}</blockquote>
      <p>E-mail source : {g.source_email_id}</p>
      {g.assumptions.map(a => <p key={a}>{a}</p>)}
      {g.imo_source && <p>Classe {g.imo_class} dérivée pour ce lot uniquement — {g.imo_source.source}.</p>}
      {proposal.pad_candidates.filter(c => c.unit_ref === g.unit_ref).map(c => <div key={c.category} className="bg-muted p-2">
        <p>PAD {c.category} — proposition, non appliquée au calcul</p>
        <p>{c.justification}</p><p>Alias validés : {c.matching_aliases.join(" ; ")}</p>
        <p>{c.rate === null ? "Tarif à confirmer : source unique applicable non vérifiée." : `Tarif de référence : ${c.rate} FCFA/t ; ce n’est pas le montant du lot.`}</p>
        {c.tariff_source && <p>Source : {String(c.tariff_source.source_document)} — ligne {String(c.tariff_source.id)}, niveau {String(c.tariff_source.evidence_level)}, effet {String(c.tariff_source.effective_date)}.</p>}
      </div>)}
      {!proposal.pad_candidates.some(c => c.unit_ref === g.unit_ref) && <p>Catégorie PAD de ce groupe à confirmer.</p>}
    </div>)}
    {proposal?.status === "proposed" && <Button size="sm" disabled={disabled || pending} onClick={() => void handleUseDraft()}>Reprendre cette proposition dans un brouillon</Button>}
  </section>;
}
