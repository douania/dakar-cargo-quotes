import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { ConfirmedPadLine, PadGroup, PadGroupContext, PadGroupDecision } from "../../../supabase/functions/_shared/pad-group-confirmation";
import type { GroupEvidence } from "../../../supabase/functions/manage-pad-group-confirmation/evidence";
import { validWeightBasis, type WeightBasis } from "../../../supabase/functions/_shared/quotation-weight-basis";
import type { WeightFact, WeightReconciliation } from "../../../supabase/functions/_shared/pad-weight-reconciliation";
import { factKeysForExplicitIssues } from "@/pages/case-view/factConflicts";

type State = {
  mode: "legacy" | "groups"; context: PadGroupContext | null; heads: PadGroupDecision[]; ready: boolean;
  read_only: boolean;
  required: boolean;
  issues: { unit_ref: string; code: string }[];
  assistance?: Record<string, GroupEvidence>;
  dossier_weight_kg?: number | null;
  all_heads?: PadGroupDecision[];
  weight_facts?: WeightFact[];
  weight_reconciliation?: WeightReconciliation | null;
  retained_weight?: WeightReconciliation | null;
  lines?: ConfirmedPadLine[];
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

function GroupDecision({ group, context, head, issues, readOnly, evidence, line, dangerousGoodsFalse, onSaved }: { group: PadGroup; context: PadGroupContext;
  evidence?: GroupEvidence;
  head?: PadGroupDecision; line?: ConfirmedPadLine; issues: string[]; readOnly: boolean; dangerousGoodsFalse: boolean; onSaved: () => Promise<unknown> }) {
  const [category, setCategory] = useState(head?.category ?? group.proposed_category ?? "");
  const [source, setSource] = useState(group.proposed_basis && (!head?.category || head.category === group.proposed_category)
    ? `Proposition à vérifier (${group.proposed_category ?? "catégorie à choisir"}) : ${group.proposed_basis}`.slice(0, 2000) : "");
  const [weightSource, setWeightSource] = useState(evidence?.weightDraft.slice(0, 2000) ?? "");
  const [sourceVerified, setSourceVerified] = useState(false);
  const [categoryConfirmed, setCategoryConfirmed] = useState(false);
  const [weightBasis, setWeightBasis] = useState<WeightBasis>(head?.weight_basis ?? "confirmed");
  const [reservation, setReservation] = useState(head?.weight_reservation ?? "");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const categorySelectRef = useRef<HTMLSelectElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = head?.action === "confirm" && head.context_hash === context.context_hash;
  const missing = [
    ...(readOnly ? ["Modification interdite sur ce dossier verrouillé."] : []),
    ...(!category ? ["Choisissez une catégorie PAD."] : []),
    ...(group.total_weight_kg === null ? ["Précisez le poids du groupe."] : []),
    ...(source.trim().length < 3 ? ["Renseignez la source et la justification de la catégorie."] : []),
    ...(weightSource.trim().length < 3 ? [weightBasis === "provisional" ? "Renseignez la source de la base de poids retenue et de son allocation." : "Renseignez la source du poids exact et de son allocation."] : []),
    ...(!validWeightBasis({ weight_basis: weightBasis, weight_reservation: reservation }) ? ["Précisez la réserve de poids (10 caractères minimum)."] : []),
    ...(!sourceVerified ? ["Vérifiez la source de la catégorie."] : []),
    ...(!categoryConfirmed ? ["Confirmez explicitement la catégorie pour le devis."] : []),
  ];
  async function record(action: "confirm" | "revoke") {
    setPending(true); setError(null);
    try {
      const result = await supabase.functions.invoke("manage-pad-group-confirmation", { body: {
        case_id: context.case_id, action: "record", decision: { unit_ref: group.unit_ref, action,
          category: action === "confirm" ? category : null, source_reference: source.trim(), weight_source_reference: weightSource.trim(),
          weight_basis: action === "confirm" ? weightBasis : "confirmed", weight_reservation: action === "confirm" ? reservation : "",
          expected_context_hash: context.context_hash, expected_head_id: head?.id ?? null, idempotency_key: crypto.randomUUID() },
      } });
      if (result.error) throw result.error;
      await onSaved();
    } catch { setError("Enregistrement non confirmé. Actualisez avant de réessayer ; les données peuvent avoir changé."); }
    finally { setPending(false); }
  }
  const status = confirmed ? head.weight_basis === "provisional" ? "Retenue avec réserve" : "Confirmée" : "À confirmer";
  const perContainer = group.declared_per_container_kg ?? (group.total_weight_kg !== null && group.quantity > 0 ? group.total_weight_kg / group.quantity : null);
  return <article className="rounded-md border bg-card p-4 space-y-4" data-pad-needs-review={issues.length ? "true" : undefined} tabIndex={-1}>
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
      <div className="space-y-2 rounded-md border bg-muted/20 p-4">
        <p className="text-xs font-medium uppercase text-muted-foreground">Groupe {group.unit_ref}</p>
        <div className="flex flex-wrap items-center gap-2"><h4 className="text-xl font-bold">{group.quantity} × {group.equipment_code}</h4><span className="rounded-full border px-2 py-0.5 text-xs font-semibold">{group.ownership}</span>{dangerousGoodsFalse && <span className="rounded-full bg-green-500/15 px-2 py-0.5 text-xs font-semibold text-green-700 dark:text-green-300">Non dangereux</span>}</div>
        <p className="text-sm">{group.description}</p>
        <p className="text-sm">Poids par conteneur : {perContainer === null ? "à préciser" : `${perContainer.toLocaleString("fr-FR")} kg`}</p>
        <p className="text-xs text-muted-foreground">Source du groupe : {evidence?.reference || group.proposed_basis || "aucune source rattachée sans ambiguïté"}</p>
      </div>
      <div className="space-y-3 rounded-md border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-medium uppercase text-muted-foreground">Catégorie PAD du groupe {group.unit_ref}</p><p className="text-3xl font-bold">{category || "—"}</p></div><span className="rounded-full border px-2 py-1 text-xs font-semibold">{status}</span></div>
        {line?.amount != null && <p className="text-sm font-medium">Droit de passage : {line.amount.toLocaleString("fr-FR")} F CFA</p>}
        <p className="text-xs text-muted-foreground">Source : {line?.tariff_source || evidence?.reference || group.proposed_basis || "à vérifier"}</p>
        <label className="block text-sm">Source et justification de la catégorie
          <textarea className="mt-1 block min-h-20 w-full rounded border bg-background p-2" value={source} onChange={e => { setSource(e.target.value); setSourceVerified(false); setCategoryConfirmed(false); }} maxLength={2000} disabled={pending || readOnly} />
        </label>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={sourceVerified} onChange={e => setSourceVerified(e.target.checked)} disabled={pending || readOnly} />Source vérifiée</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={categoryConfirmed} onChange={e => setCategoryConfirmed(e.target.checked)} disabled={pending || readOnly} />Je confirme cette catégorie pour le devis</label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={pending || missing.length > 0} onClick={() => record("confirm")}>Confirmer {category || "la catégorie"} pour le devis</Button>
          <Button size="sm" variant="outline" disabled={pending || readOnly} onClick={() => {
            setCategory(""); setSource(""); setSourceVerified(false); setCategoryConfirmed(false);
            detailsRef.current?.setAttribute("open", "");
            const select = categorySelectRef.current;
            if (select) { select.scrollIntoView({ block: "center" }); select.focus({ preventScroll: true }); }
          }}>Choisir une autre catégorie</Button>
          {head?.action === "confirm" && <Button size="sm" variant="outline" disabled={readOnly || pending || !sourceVerified || !categoryConfirmed || source.trim().length < 3 || weightSource.trim().length < 3} onClick={() => record("revoke")}>Retirer la confirmation</Button>}
        </div>
      </div>
    </div>
    <p className="text-sm">Poids total : {group.total_weight_kg === null ? "à préciser" : `${group.total_weight_kg.toLocaleString("fr-FR")} kg`}</p>
    <p className="text-sm">Estimation : {group.proposed_category ? `catégorie proposée ${group.proposed_category}` : "catégorie non retenue"}. {group.proposed_basis}</p>
    {issues.map(code => <p className="text-sm text-amber-700" key={code}>{messages[code] ?? "Confirmation non exploitable : revoir ce groupe et ses sources."}</p>)}
    <details ref={detailsRef} className="rounded border p-3">
      <summary className="cursor-pointer text-sm">Poids et références détaillées</summary>
      <p className="my-2 text-sm text-muted-foreground">Vérifiez la nature du groupe, son allocation et son poids. Cette décision ne modifie pas les faits client et ne confirme ni l’IMO ni les autres frais.</p>
      <p className="text-sm mb-2">Les textes proposés restent à relire et modifiables. Leur préremplissage ne confirme rien.</p>
      {evidence ? <div className="text-sm space-y-1">
        <p>Extrait client : {evidence.excerpt}</p>
        <p>Calcul du poids du scénario : {evidence.calculation}</p>
        {evidence.warnings.map(w => <p className="text-amber-700" key={w}>{w}</p>)}
      </div> : <p className="text-sm text-amber-700">Aucun extrait client rattaché sans ambiguïté à ce groupe. Renseignez une source vérifiée ; le poids affiché reste celui du scénario.</p>}
      <details className="text-xs break-words mb-2"><summary>Références et base du scénario</summary>{evidence?.reference}<p>{group.description}</p></details>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-sm">Nature du poids retenu
          <select className="block w-full border rounded p-2 bg-background" value={weightBasis} disabled={pending || readOnly}
            onChange={e => {
              const basis = e.target.value as WeightBasis; setWeightBasis(basis); setSourceVerified(false); setCategoryConfirmed(false);
              setReservation(basis === "provisional" ? "Poids retenu pour la cotation ; prestations dépendant du poids révisables selon les documents définitifs et les conditions tarifaires applicables." : "");
              if (basis === "provisional" && evidence) setWeightSource(`${evidence.reference} : ${evidence.excerpt}. Base de cotation : ${evidence.calculation}. Allocation à vérifier.`.slice(0, 2000));
              else setWeightSource(evidence?.weightDraft.slice(0, 2000) ?? "");
            }}>
            <option value="confirmed">Poids confirmé par une source</option>
            <option value="provisional">Base de cotation révisable — avec réserve</option>
          </select>
        </label>
        {weightBasis === "provisional" && <label className="text-sm">Réserve à reproduire dans la cotation
          <textarea className="block w-full border rounded p-2 bg-background" value={reservation} maxLength={2000} disabled={pending || readOnly}
            onChange={e => { setReservation(e.target.value); setSourceVerified(false); setCategoryConfirmed(false); }} />
        </label>}
        <label className="text-sm">Catégorie PAD
          <select ref={categorySelectRef} className="block w-full border rounded p-2 bg-background" value={category} onChange={e => { setCategory(e.target.value); setSource(""); setSourceVerified(false); setCategoryConfirmed(false); }} disabled={pending || readOnly}>
            <option value="">Choisir</option>
            {[...Array.from({ length: 14 }, (_, i) => `T${String(i + 1).padStart(2, "0")}`), ...Array.from({ length: 5 }, (_, i) => `P0${i + 1}`)].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-sm">Source du poids et de l’allocation du groupe
          <textarea className="block w-full border rounded p-2 bg-background" value={weightSource} onChange={e => { setWeightSource(e.target.value); setSourceVerified(false); setCategoryConfirmed(false); }} maxLength={2000} disabled={pending || readOnly} />
        </label>
      </div>
      {missing.length > 0 && <ul className="text-sm text-amber-700 list-disc pl-5" aria-label="À compléter avant confirmation">{missing.map(m => <li key={m}>{m}</li>)}</ul>}
      {error && <p role="alert" className="text-sm text-destructive mt-2">{error}</p>}
    </details>
  </article>;
}

function WeightReconciliationForm({ state, extractedConfidence, onSaved }: { state: State; extractedConfidence?: number | null; onSaved: () => Promise<unknown> }) {
  const [justification, setJustification] = useState("");
  const [reserve, setReserve] = useState("Base de cotation révisable selon les poids des documents définitifs ; le poids extrait contradictoire n’est pas confirmé.");
  const [attested, setAttested] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const eligible = state.issues.length === 1 && state.issues[0].code === "PAD_GROUP_WEIGHT_CONFLICT" &&
    state.weight_facts?.length === 1 && state.weight_facts[0].source_type === "ai_extraction";
  if (!state.context || (!eligible && !state.weight_reconciliation)) return null;
  const total = state.context.groups.reduce((sum, g) => sum + (g.total_weight_kg ?? 0), 0);
  async function save(action: "retain" | "revoke") {
    setPending(true); setError("");
    try {
      const result = await supabase.functions.invoke("manage-pad-group-confirmation", { body: {
        case_id: state.context!.case_id, action: "reconcile_weight", decision: { action,
          expected_context_hash: state.context!.context_hash, expected_heads: state.all_heads?.map(h => h.id).sort(),
          expected_head_id: state.weight_reconciliation?.id ?? null, idempotency_key: crypto.randomUUID(),
          justification: justification.trim(), reservation: reserve.trim() },
      } });
      if (result.error) throw result.error;
      await onSaved(); setAttested(false);
    } catch { setError("Rapprochement non enregistré : actualisez les données avant de réessayer."); }
    finally { setPending(false); }
  }
  const disabled = state.read_only || pending || !attested || justification.trim().length < 10 || reserve.trim().length < 10;
  const recordedAt = (state.weight_reconciliation as (WeightReconciliation & { created_at?: string }) | null)?.created_at;
  const extracted = state.weight_facts?.[0]?.number ?? Number(state.weight_facts?.[0]?.text);
  return <fieldset className="border rounded p-4 space-y-3" disabled={pending || state.read_only}>
    <legend>Rapprochement du poids pour la cotation</legend>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded border p-3"><p className="text-xs text-muted-foreground">Extrait des pièces</p><p className="text-lg font-semibold">{Number.isFinite(extracted) ? `${extracted.toLocaleString("fr-FR")} kg` : "à vérifier"}</p>{extractedConfidence != null && <p className="text-xs text-muted-foreground">Confiance {Math.round(extractedConfidence * 100)} %</p>}</div>
      <div className="rounded border p-3"><p className="text-xs text-muted-foreground">Base retenue</p><p className="text-lg font-semibold">{total.toLocaleString("fr-FR")} kg</p><p className="text-xs text-muted-foreground">{state.retained_weight ? "Rapprochement enregistré" : "Somme des groupes"}</p></div>
    </div>
    <p className="text-sm">Ce choix conserve le poids extrait et les décisions PAD. Il ne confirme pas un poids définitif ni les autres prestations.</p>
    {state.weight_reconciliation && !state.retained_weight && <p className="text-sm">L’ancien rapprochement n’est pas exploitable dans l’état actuel.</p>}
    <label className="block text-sm">Source et justification de l’écart
      <textarea className="block w-full border rounded p-2 bg-background" value={justification} maxLength={2000} onChange={e => { setJustification(e.target.value); setAttested(false); }} />
    </label>
    <label className="block text-sm">Réserve reprise telle quelle dans le devis
      <textarea className="block w-full border rounded p-2 bg-background" value={reserve} maxLength={2000} onChange={e => { setReserve(e.target.value); setAttested(false); }} />
    </label>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)} />
      J’ai rapproché les sources ; je retiens la somme des groupes comme base révisable, sans modifier les faits client.
    </label>
    <div className="flex flex-wrap items-center gap-3">{eligible && <Button disabled={disabled} onClick={() => save("retain")}>Retenir la base révisable</Button>}
    {state.weight_reconciliation?.action === "retain" && <Button variant="outline" disabled={disabled} onClick={() => save("revoke")}>Retirer le rapprochement</Button>}
    {recordedAt && <span className="text-xs text-muted-foreground">Rapprochement enregistré le {new Date(recordedAt).toLocaleDateString("fr-FR")}</span>}</div>
    {error && <p role="alert">{error}</p>}
  </fieldset>;
}

export function PadGroupConfirmationsPanel({ caseId, onChanged, onEstimateReview, dangerousGoodsFalse = false, extractedWeightConfidence, onSummaryChange, onConflictFactKeysChange }: { caseId: string; onChanged: () => void; onEstimateReview: () => void; dangerousGoodsFalse?: boolean; extractedWeightConfidence?: number | null; onSummaryChange?: (summary: string) => void; onConflictFactKeysChange?: (factKeys: ReadonlySet<string>) => void }) {
  const query = useQuery({ queryKey: ["pad-group-confirmations", caseId], retry: false, queryFn: async () => {
    const result = await supabase.functions.invoke("manage-pad-group-confirmation", { body: { case_id: caseId, action: "read" } });
    if (result.error) throw result.error;
    return result.data as State;
  } });
  const state = query.isError ? undefined : query.data;
  const summary = state?.context?.groups.map(group => {
    const head = state.heads.find(item => item.unit_ref === group.unit_ref);
    return head?.action === "confirm" && head.category
      ? `PAD ${head.category} ${head.weight_basis === "provisional" ? "retenue avec réserve" : "confirmée"}`
      : "catégorie PAD à confirmer";
  }).join(" · ");
  useEffect(() => {
    if (summary && onSummaryChange) onSummaryChange(summary);
  }, [onSummaryChange, summary]);
  const issueCodes = state?.issues.map((issue) => issue.code).join("\u0000") ?? "";
  useEffect(() => {
    onConflictFactKeysChange?.(factKeysForExplicitIssues(issueCodes ? issueCodes.split("\u0000") : []));
  }, [issueCodes, onConflictFactKeysChange]);
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
      <WeightReconciliationForm key={`${state.context?.context_hash}:${state.weight_reconciliation?.id ?? "new"}`} state={state} extractedConfidence={extractedWeightConfidence} onSaved={async () => { await query.refetch(); onChanged(); }} />
      {state.context?.groups.map(group => <GroupDecision key={`${state.context!.context_hash}:${group.unit_ref}:${state.heads.find(h => h.unit_ref === group.unit_ref)?.id ?? "new"}`}
        group={group} context={state.context!} head={state.heads.find(h => h.unit_ref === group.unit_ref)} line={state.lines?.find(line => line.unit_ref === group.unit_ref)} readOnly={state.read_only} evidence={state.assistance?.[group.unit_ref]} dangerousGoodsFalse={dangerousGoodsFalse}
        issues={state.issues.filter(i => i.unit_ref === group.unit_ref).map(i => i.code)} onSaved={async () => { await query.refetch(); onChanged(); }} />)}
    </>}
  </section>;
}
