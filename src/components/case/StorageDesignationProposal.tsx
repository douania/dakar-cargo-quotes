import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { Candidate } from "../../../supabase/functions/propose-storage-designation/domain";
type Proposal = { scenario_id: string; scope_hash: string; source_fingerprint?: string; unit_ref: string; description: string; source: string;
  qualification: "PROPOSAL_ONLY"; generated_at: string; candidates: Candidate[]; warning: string | null };
export function StorageDesignationProposal({ caseId, group, onAdopt }: {
  caseId: string; group: Record<string, unknown>; onAdopt: (code: string, evidence: string) => void;
}) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const alive = useRef(true); const inFlight = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = async () => {
    const { data, error } = await supabase.functions.invoke("propose-storage-designation", { body: {
      case_id: caseId, unit_ref: group.unit_ref, equipment_code: group.equipment_code, quantity: group.quantity, ownership: group.ownership,
    } });
    if (error || !data || data.qualification !== "PROPOSAL_ONLY" || !Array.isArray(data.candidates) || data.unit_ref !== group.unit_ref) throw new Error("Proposition indisponible. Vérifiez le scénario sélectionné et la concordance du lot ; choix manuel disponible.");
    return data as Proposal;
  };
  const act = async (choice?: Candidate) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError("");
    try {
      const fresh = await load(); if (!alive.current) return;
      if (!choice) { setProposal(fresh); return; }
      const match = fresh.candidates.find(c => c.id === choice.id && c.code === choice.code && c.label === choice.label && c.unit === choice.unit && c.applicable);
      if (!proposal || fresh.scenario_id !== proposal.scenario_id || fresh.scope_hash !== proposal.scope_hash || fresh.source_fingerprint !== proposal.source_fingerprint || fresh.description !== proposal.description || !match) {
        setProposal(fresh); throw new Error("Le lot ou la proposition a changé. Examinez les nouvelles propositions avant de choisir.");
      }
      if (typeof match.code !== "string" || !/^41[0-9]$/.test(match.code) || match.unit !== "tonne_per_day") throw new Error("Code ou unité hors périmètre.");
      onAdopt(match.code, `Lot ${fresh.unit_ref} : ${match.label} (code ${match.code}, ${match.unit}), proposition ${match.method} retenue par opérateur. ${fresh.source} Document : ${match.document ?? "non renseigné"}, preuve ${match.evidence ?? "non renseignée"}, date ${match.effective_date ?? "non renseignée"}. Scénario ${fresh.scenario_id}, empreinte ${fresh.scope_hash}, source ${fresh.source_fingerprint ?? "non disponible"}, ${fresh.generated_at}. Description : ${fresh.description}. Justification : ${match.justification}. Classification hypothétique ; tarif distinct à corroborer.`);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Proposition indisponible"); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  };
  return <div className="space-y-2 border rounded p-2">
    <p>Reconnaissance contextuelle : extraits marchandises des e-mails client rapprochés au scénario, ou description hypothétique pour un dossier sans fil source. Ces extraits et les caractéristiques des lots sont transmis au service IA configuré, même pour un alias exact. Photos non analysées. Aucun fait confirmé ni montant créé.</p>
    <Button type="button" variant="outline" disabled={busy || !group.unit_ref} onClick={() => void act()}>{busy ? "Vérification…" : "Proposer une désignation magasinage"}</Button>
    {error && <p role="alert">{error}</p>}
    {proposal && <>
      <p>Description examinée : {proposal.description}</p>
      <p>{proposal.source}</p>
      {proposal.warning && <p role="status">{proposal.warning}</p>}
      {!proposal.candidates.length && <p>Aucune correspondance justifiée. Précisez la description du scénario ou conservez le choix manuel.</p>}
      {proposal.candidates.map(c => <div key={c.id} className="border rounded p-2">
        <p>{c.label} — code {c.code ?? "absent"} — {c.unit} — {c.method}</p><p>{c.justification}</p>
        <p>Source de désignation : {c.document ?? "non renseignée"} · preuve {c.evidence ?? "non renseignée"} · date {c.effective_date ?? "non renseignée"}</p>
        <p>Classification proposée, non confirmée. Tarif à corroborer séparément.</p>
        {!c.applicable ? <p>Code ou unité hors calcul actuel à la tonne : non applicable automatiquement.</p> :
          <Button type="button" disabled={busy || group.provider !== "DPW"} onClick={() => void act(c)}>Retenir sous hypothèse : {c.label}</Button>}
      </div>)}
    </>}
  </div>;
}
