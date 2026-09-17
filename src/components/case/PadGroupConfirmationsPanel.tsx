import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { PadGroup, PadGroupContext, PadGroupDecision } from "../../../supabase/functions/_shared/pad-group-confirmation";
import type { GroupEvidence } from "../../../supabase/functions/manage-pad-group-confirmation/evidence";

type State = {
  mode: "legacy" | "groups"; context: PadGroupContext | null; heads: PadGroupDecision[]; ready: boolean;
  read_only: boolean;
  required: boolean;
  issues: { unit_ref: string; code: string }[];
  assistance?: Record<string, GroupEvidence>;
  dossier_weight_kg?: number | null;
};
const messages: Record<string, string> = {
  PAD_CONFIRMATION_REQUIRED: "Catégorie et poids à confirmer pour le devis.",
  PAD_CONFIRMATION_REVOKED: "Confirmation retirée.", PAD_CONFIRMATION_STALE: "Les données ont changé : une nouvelle confirmation est nécessaire.",
  PAD_WEIGHT_CONFIRMATION_REQUIRED: "Poids total du groupe à préciser avant confirmation.",
  PAD_TARIFF_REQUIRED: "Aucun tarif PAD applicable vérifié.", PAD_TARIFF_AMBIGUOUS: "Plusieurs tarifs applicables : revue tarifaire nécessaire.",
  PAD_GROUP_ALLOCATION_REQUIRED: "Rapprocher les groupes et les conteneurs du dossier : leur correspondance n’est pas encore univoque.",
  PAD_GROUP_WEIGHT_CONFLICT: "Les poids des groupes ne correspondent pas au poids du dossier.",
  PAD_GROUP_SELECTION_REQUIRED: "Sélectionnez une version actuelle des groupes avant de confirmer.",
  PAD_REQUEST_MULTI_LOT_UNSUPPORTED: "Le devis confirmé de plusieurs demandes distinctes reste hors de ce parcours.",
};

function GroupDecision({ group, context, head, issues, readOnly, evidence, onSaved }: { group: PadGroup; context: PadGroupContext;
  evidence?: GroupEvidence;
  head?: PadGroupDecision; issues: string[]; readOnly: boolean; onSaved: () => Promise<unknown> }) {
  const [category, setCategory] = useState(head?.category ?? group.proposed_category ?? "");
  const [source, setSource] = useState(group.proposed_basis && (!head?.category || head.category === group.proposed_category)
    ? `Proposition à vérifier (${group.proposed_category ?? "catégorie à choisir"}) : ${group.proposed_basis}`.slice(0, 2000) : "");
  const [weightSource, setWeightSource] = useState(evidence?.weightDraft.slice(0, 2000) ?? "");
  const [attested, setAttested] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = head?.action === "confirm" && head.context_hash === context.context_hash;
  const missing = [
    ...(readOnly ? ["Modification interdite sur ce dossier verrouillé."] : []),
    ...(!category ? ["Choisissez une catégorie PAD."] : []),
    ...(group.total_weight_kg === null ? ["Précisez le poids du groupe."] : []),
    ...(source.trim().length < 3 ? ["Renseignez la source et la justification de la catégorie."] : []),
    ...(weightSource.trim().length < 3 ? ["Renseignez la source du poids exact et de son allocation."] : []),
    ...(!attested ? ["Vérifiez les sources puis cochez la validation explicite."] : []),
  ];
  async function record(action: "confirm" | "revoke") {
    setPending(true); setError(null);
    try {
      const result = await supabase.functions.invoke("manage-pad-group-confirmation", { body: {
        case_id: context.case_id, action: "record", decision: { unit_ref: group.unit_ref, action,
          category: action === "confirm" ? category : null, source_reference: source.trim(), weight_source_reference: weightSource.trim(),
          expected_context_hash: context.context_hash, expected_head_id: head?.id ?? null, idempotency_key: crypto.randomUUID() },
      } });
      if (result.error) throw result.error;
      await onSaved();
    } catch { setError("Enregistrement non confirmé. Actualisez avant de réessayer ; les données peuvent avoir changé."); }
    finally { setPending(false); }
  }
  return <article className="rounded-md border p-3 space-y-2" data-pad-needs-review={issues.length ? "true" : undefined} tabIndex={-1}>
    <h4 className="font-medium">{group.unit_ref} — {group.quantity} × {group.equipment_code} {group.ownership}</h4>
    <p className="text-sm">Poids total : {group.total_weight_kg === null ? "à préciser" : `${group.total_weight_kg.toLocaleString("fr-FR")} kg`}</p>
    <p className="text-sm">Estimation : {group.proposed_category ? `catégorie proposée ${group.proposed_category}` : "catégorie non retenue"}. {group.proposed_basis}</p>
    <p className="text-sm">Devis confirmé : {confirmed ? `${head.category} — décision enregistrée` : "décision attendue"}.</p>
    {issues.map(code => <p className="text-sm text-amber-700" key={code}>{messages[code] ?? "Confirmation non exploitable : revoir ce groupe et ses sources."}</p>)}
    <details>
      <summary className="cursor-pointer text-sm">{confirmed ? "Revoir ou retirer la confirmation" : "Confirmer la catégorie pour le devis"}</summary>
      <p className="my-2 text-sm text-muted-foreground">Vérifiez la nature du groupe, son allocation et son poids. Cette décision ne modifie pas les faits client et ne confirme ni l’IMO ni les autres frais.</p>
      <p className="text-sm mb-2">Les textes proposés restent à relire et modifiables. Leur préremplissage ne confirme rien.</p>
      {evidence ? <div className="text-sm space-y-1">
        <p>Extrait client : {evidence.excerpt}</p>
        <p>Calcul du poids du scénario : {evidence.calculation}</p>
        {evidence.warnings.map(w => <p className="text-amber-700" key={w}>{w}</p>)}
      </div> : <p className="text-sm text-amber-700">Aucun extrait client rattaché sans ambiguïté à ce groupe. Renseignez une source vérifiée ; le poids affiché reste celui du scénario.</p>}
      <details className="text-xs break-words mb-2"><summary>Références et base du scénario</summary>{evidence?.reference}<p>{group.description}</p></details>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">Catégorie PAD
          <select className="block w-full border rounded p-2 bg-background" value={category} onChange={e => { setCategory(e.target.value); setSource(""); setAttested(false); }} disabled={pending || readOnly}>
            <option value="">Choisir</option>
            {[...Array.from({ length: 14 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`), ...Array.from({ length: 5 }, (_, i) => `P0${i + 1}`)].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm">Source et justification de la catégorie
          <textarea className="block w-full border rounded p-2 bg-background" value={source} onChange={e => { setSource(e.target.value); setAttested(false); }} maxLength={2000} disabled={pending || readOnly} />
        </label>
        <label className="text-sm">Source du poids et de l’allocation du groupe
          <textarea className="block w-full border rounded p-2 bg-background" value={weightSource} onChange={e => { setWeightSource(e.target.value); setAttested(false); }} maxLength={2000} disabled={pending || readOnly} />
        </label>
      </div>
      <label className="flex items-start gap-2 my-3 text-sm"><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} disabled={pending} />
        Je valide explicitement la catégorie, le poids total et leur rattachement à ce groupe, après vérification des sources.
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={readOnly || pending || !attested || !category || group.total_weight_kg === null || source.trim().length < 3 || weightSource.trim().length < 3} onClick={() => record("confirm")}>Confirmer pour le devis</Button>
        {head?.action === "confirm" && <Button size="sm" variant="outline" disabled={readOnly || pending || !attested || source.trim().length < 3 || weightSource.trim().length < 3} onClick={() => record("revoke")}>Retirer la confirmation</Button>}
      </div>
      {missing.length > 0 && <ul className="text-sm text-amber-700 list-disc pl-5" aria-label="À compléter avant confirmation">{missing.map(m => <li key={m}>{m}</li>)}</ul>}
      {error && <p role="alert" className="text-sm text-destructive mt-2">{error}</p>}
    </details>
  </article>;
}

export function PadGroupConfirmationsPanel({ caseId, onChanged, onEstimateReview }: { caseId: string; onChanged: () => void; onEstimateReview: () => void }) {
  const query = useQuery({ queryKey: ["pad-group-confirmations", caseId], retry: false, queryFn: async () => {
    const result = await supabase.functions.invoke("manage-pad-group-confirmation", { body: { case_id: caseId, action: "read" } });
    if (result.error) throw result.error;
    return result.data as State;
  } });
  const state = query.isError ? undefined : query.data;
  return <section id="section-pad-review" className="my-3 space-y-3" aria-label="Marchandises et catégories portuaires">
    <div className="flex gap-2 flex-wrap">
      <Button size="sm" variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>Actualiser les confirmations</Button>
      <Button size="sm" variant="outline" onClick={onEstimateReview}>Revoir les groupes et les choix de l’estimation</Button>
    </div>
    {query.isLoading && <p>Chargement des groupes…</p>}
    {query.isError && <p role="alert">Lecture des confirmations indisponible. Aucune catégorie ne doit être considérée comme confirmée.</p>}
    {state?.mode === "legacy" && <p className="text-sm">Aucun scénario maritime par groupes actif. Le parcours de classification du dossier reste inchangé.</p>}
    {state?.mode === "groups" && <>
      {state.read_only && <p className="text-sm">Dossier verrouillé : consultation uniquement.</p>}
      <p className="text-sm">{!state.required ? "Le PAD est hors du périmètre actuel du devis ; ces confirmations ne sont pas exigées pour ce calcul." : state.ready ? "Classification PAD exploitable pour le devis. Les autres contrôles restent applicables." : "L’estimation peut garder ses hypothèses. Le devis demande les validations ci-dessous."}</p>
      {state.issues.filter(i => !i.unit_ref).map(i => <p className="text-sm text-amber-700" key={i.code}>{messages[i.code] ?? "Périmètre à vérifier avant confirmation."}</p>)}
      {state.issues.some(i => i.code === "PAD_GROUP_WEIGHT_CONFLICT") && state.context && <p className="text-sm" role="alert">
        Total des groupes du scénario : {state.context.groups.some(g => g.total_weight_kg === null) ? "non déterminé (poids manquant)" : `${state.context.groups.reduce((sum, g) => sum + g.total_weight_kg!, 0).toLocaleString("fr-FR")} kg`}.
        Poids enregistré dans le dossier : {state.dossier_weight_kg == null ? "à vérifier" : `${state.dossier_weight_kg.toLocaleString("fr-FR")} kg`}.
        Rapprochez le fait extrait et les poids sources ; une borne haute de fourchette ne doit pas devenir un poids exact confirmé. Remplir les justifications ne résout pas cet écart.
      </p>}
      {state.context?.groups.map(group => <GroupDecision key={`${state.context!.context_hash}:${group.unit_ref}:${state.heads.find(h => h.unit_ref === group.unit_ref)?.id ?? "new"}`}
        group={group} context={state.context!} head={state.heads.find(h => h.unit_ref === group.unit_ref)} readOnly={state.read_only} evidence={state.assistance?.[group.unit_ref]}
        issues={state.issues.filter(i => i.unit_ref === group.unit_ref).map(i => i.code)} onSaved={async () => { await query.refetch(); onChanged(); }} />)}
    </>}
  </section>;
}
