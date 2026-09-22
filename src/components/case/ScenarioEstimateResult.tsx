import { Button } from "@/components/ui/button";
import { formatScenarioPricingAmount, type ScenarioPricingRunSummary } from "@/lib/scenarioPricing";
import {
  classifyEstimateReservations,
  estimateLineBase,
  estimateLineSource,
  estimateLineStatus,
  isExcludedEstimateLine,
  isPricedEstimateLine,
  type EstimateLine,
} from "@/pages/case-view/estimatePresentation";
import { readStayInformation, stayRange, formatStayAmount } from "../../../supabase/functions/_shared/stay-information";
import { DemurrageReferenceComparison } from "./DemurrageReferenceComparison";
export interface SelectedScenarioEstimate {
  caseId: string; title: string; run: ScenarioPricingRunSummary | null; pending: boolean; error: string | null;
}
const isStayLine = (line: EstimateLine) => /^(Magasinage|Surestaries)$/i.test(String(line.category ?? "")) ||
  /^(warehouse_franchise|demurrage_estimate)/.test(String(line.id ?? ""));

/** Presentation only: no amount, fact, tariff or persisted status is changed. */
function pendingFamily(line: EstimateLine) {
  const canonical = line.canonical && typeof line.canonical === "object" ? line.canonical as EstimateLine : {};
  const key = String(canonical.service_key ?? line.category ?? line.description ?? "Prestation");
  if (/PAD/i.test(key)) return { key: "PAD", label: "Droit de passage portuaire", action: "Vérifier les choix PAD par groupe" };
  if (/THC|Terminal|MANUTENTION/i.test(key)) return { key: "THC", label: "Manutention et frais de terminal", action: "Vérifier les données et réserves par groupe" };
  if (/TRUCK|TRANSPORT|DELIVERY/i.test(key)) return { key: "TRANSPORT", label: "Transport terrestre", action: "Consulter les postes et tarifs manquants" };
  if (/EMPTY_RETURN/i.test(key)) return { key: "RETURN", label: "Retour des conteneurs vides", action: "Consulter les conditions à confirmer" };
  return { key, label: String(line.description ?? line.category ?? "Prestation à préciser").split(" — ")[0], action: "Consulter la réserve du poste" };
}
export function ScenarioEstimateResult({ estimate, onReview, onStayReview }: { estimate: SelectedScenarioEstimate; onReview?: () => void; onStayReview?: () => void }) {
  const { run, pending, error } = estimate;
  const lines = Array.isArray(run?.tariff_lines) ? run.tariff_lines as EstimateLine[] : [];
  const stayLines = lines.filter(isStayLine);
  const families = new Map<string, { label: string; action: string; count: number; scenario: boolean }>();
  for (const line of lines.filter(line => !isPricedEstimateLine(line) && !isExcludedEstimateLine(line))) {
    const family = pendingFamily(line);
    const previous = families.get(family.key);
    families.set(family.key, { ...family, count: (previous?.count ?? 0) + 1, scenario: family.key === "PAD" || family.key === "THC" });
  }
  const reservationGroups = classifyEstimateReservations({
    lines,
    blockers: run?.blockers,
    reservations: run?.reservations,
  });
  return <section aria-label="Résultat de l’estimation sélectionnée" className="space-y-4 min-w-0">
    <h3 className="font-semibold">{pending ? "Actualisation en cours" : error ? "Dernière actualisation non aboutie" : run?.status === "success" ? "Estimation disponible" : "Estimation du scénario"} — {estimate.title}</h3>
    {pending && <p role="status">Calcul en cours. Le résultat précédent ci-dessous n’est pas le résultat de cette relance.</p>}
    {error && <p role="alert">Dernière tentative non aboutie : {error}. Aucun nouveau montant validé.</p>}
    {!run && !error && !pending && <p>Aucune estimation pour ce scénario. Lancez le calcul après vérification des hypothèses.</p>}
    {run && <>
      <p className="text-xs text-muted-foreground">{pending || error ? "Dernier résultat enregistré" : "Résultat enregistré"} · exécution {run.run_seq} · {new Date(run.completed_at).toLocaleString("fr-FR")}</p>
      {run.status === "success" ? <>
        <p className="font-semibold text-lg">{run.qualification === "partial" ? "Sous-total indicatif des postes chiffrés" : "Total indicatif avec hypothèses"} : HT {formatScenarioPricingAmount(run.indicative_total_ht, run.currency)} · TTC {formatScenarioPricingAmount(run.indicative_total_ttc, run.currency)}</p>
        <p className="text-sm text-muted-foreground">Estimation non ferme, distincte du devis confirmé. Les postes à confirmer ne sont pas gratuits.</p>
        {lines.length > 0 && <div className="overflow-x-auto rounded border"><table className="w-full text-sm">
          <caption className="sr-only">Prestations de cette estimation</caption>
          <thead><tr><th className="text-left p-2">Prestation</th><th className="text-right p-2 whitespace-nowrap">Montant</th><th className="text-left p-2">Base</th><th className="text-left p-2">Statut</th><th className="text-left p-2">Détail</th></tr></thead>
          <tbody>{lines.map((line, i) => {
            const source = estimateLineSource(line);
            const reference = typeof source.reference === "string" ? source.reference : null;
            const note = typeof line.notes === "string" ? line.notes : null;
            const hasDetails = Boolean(note || reference || isStayLine(line));
            return <tr className="border-t align-top" key={`${String(line.id ?? "line")}-${i}`}>
              <td className="p-2">{String(line.description ?? line.category ?? "Prestation")}</td>
              <td className="text-right p-2 whitespace-nowrap">{isExcludedEstimateLine(line) ? "Exclu sous hypothèse" : isPricedEstimateLine(line) ? formatScenarioPricingAmount(line.amount as number, String(line.currency ?? run.currency)) : "À confirmer"}</td>
              <td className="p-2 max-w-sm">{estimateLineBase(line)}</td>
              <td className="p-2 whitespace-nowrap">{estimateLineStatus(line)}</td>
              <td className="p-2">{hasDetails ? <details>
                <summary className="cursor-pointer whitespace-nowrap">Détail</summary>
                <div className="mt-2 min-w-64 space-y-1 whitespace-pre-wrap break-words">
                  {note && <p>{note}</p>}
                  {reference && <p className="text-xs text-muted-foreground">Source : {reference}</p>}
                  {isStayLine(line) && <p className="text-xs text-muted-foreground">Voir aussi « Franchises, tranches et calculs de séjour » ci-dessous.</p>}
                </div>
              </details> : <span className="text-muted-foreground">—</span>}</td>
            </tr>;
          })}</tbody>
        </table></div>}
        {stayLines.length > 0 && <section aria-label="Franchises et tranches de séjour" className="rounded-lg border p-3 space-y-3">
          <div>
            <h4 className="font-medium">Franchises, tranches et calculs de séjour</h4>
            <p className="text-sm text-muted-foreground">Présentés par lot, hors total ferme. Magasinage terminal et surestaries armateur ne partagent ni durée ni règle de franchise.</p>
            {onStayReview && <Button className="mt-2" size="sm" variant="outline" onClick={onStayReview} disabled={pending}>Renseigner les hypothèses de séjour</Button>}
          </div>
          {stayLines.map((line, index) => {
            const source = estimateLineSource(line);
            const info = readStayInformation(line.stay_information);
            const note = typeof line.notes === "string" && line.notes.trim()
              ? line.notes
              : "Franchise, durée, taux ou conditions d’application à confirmer.";
            return <article className="border-t pt-3 first:border-t-0 first:pt-0" key={`${String(line.id ?? "stay")}-${index}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h5 className="font-medium text-sm">{String(line.description ?? line.category ?? "Séjour")}</h5>
                <span className="font-medium text-sm whitespace-nowrap">{isExcludedEstimateLine(line) ? "Exclu sous hypothèse" : isPricedEstimateLine(line) ? formatScenarioPricingAmount(line.amount as number, String(line.currency ?? run.currency)) : "À confirmer"}</span>
              </div>
              {info ? <div className="mt-2 space-y-2 text-sm">
                <p className="font-medium">Franchise : {info.free_days === null ? "à confirmer" : `${info.free_days} jours`}</p>
                <p>{info.franchise_note}</p>
                {info.carrier_comparison && <DemurrageReferenceComparison comparison={info.carrier_comparison} />}
                {info.tiers.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm">
                  <caption className="text-left font-medium mb-1">Tranches de séjour — information non ferme</caption>
                  <thead><tr><th className="text-left p-2">Période</th><th className="text-right p-2">Taux</th><th className="text-left p-2">Unité</th></tr></thead>
                  <tbody>{info.tiers.map((tier, i) => <tr className="border-t" key={i}>
                    <td className="p-2">{stayRange(tier.from, tier.to, tier.relative)}</td>
                    <td className="p-2 text-right whitespace-nowrap">{formatStayAmount(tier.rate, tier.currency)}</td><td className="p-2">{tier.unit}</td>
                  </tr>)}</tbody>
                </table></div>}
                {info.example ? <div className="rounded bg-muted p-2">
                  <p className="font-medium">Exemple sur ce lot — séjour hypothétique de {info.example.days} jours, franchise comprise</p>
                  <p>{info.example.formula} = {formatStayAmount(info.example.amount, info.example.currency)}</p>
                  <p>Illustration non ajoutée au total ; ce n’est pas la durée retenue.</p>
                </div> : !info.carrier_comparison && <p>Exemple à compléter : conditions du lot, taux ou quantité/poids insuffisamment renseignés.</p>}
                {info.reservations.map((reservation, i) => <p key={i} className="whitespace-pre-wrap">{reservation}</p>)}
                {info.sources.map((source, i) => <p key={i} className="text-xs text-muted-foreground">Source : {source}</p>)}
              </div> : <>
                <p className="mt-1 text-sm whitespace-pre-wrap">{note}</p>
                {typeof source.reference === "string" && <p className="mt-1 text-xs text-muted-foreground">Source : {source.reference}</p>}
              </>}
            </article>;
          })}
        </section>}
        {families.size > 0 && <section aria-label="Postes à compléter" className="rounded-lg border border-amber-400/40 p-3">
          <h4 className="font-medium">À compléter pour couvrir les prestations restantes</h4>
          <p className="text-sm text-muted-foreground mb-2">Ces postes sont exclus du sous-total. Ils ne bloquent pas les montants déjà calculés.</p>
          <ul className="space-y-2">{Array.from(families.entries()).map(([key, item]) => <li key={key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>{item.label} — {item.count} poste{item.count > 1 ? "s" : ""} non chiffré{item.count > 1 ? "s" : ""}</span>
            {item.scenario && onReview ? <Button size="sm" variant="outline" onClick={onReview} disabled={pending}>{item.action}</Button>
              : <a className="underline" href="#estimate-service-details" onClick={event => {
                const details = event.currentTarget.closest("section[aria-label='Résultat de l’estimation sélectionnée']")?.querySelector<HTMLDetailsElement>("#estimate-service-details");
                if (details) details.open = true;
              }}>{item.action}</a>}
          </li>)}</ul>
        </section>}
      </> : <p role="alert">{run.status === "blocked" ? "Calcul bloqué : aucun montant retenu." : "Calcul non abouti : aucun montant retenu."}</p>}
      {reservationGroups.actionable.length > 0 && <section aria-label="Réserves à traiter" className="rounded border p-3">
        <h4 className="text-sm font-medium">Réserves à traiter ({reservationGroups.actionable.length})</h4>
        <ul className="list-disc pl-5 text-sm space-y-2 mt-2">{reservationGroups.actionable.map(item => <li key={item.id}>{item.message}</li>)}</ul>
        {reservationGroups.actionable.some(item => item.technicalCode) && <details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">Codes techniques pour le support</summary>
          <pre className="whitespace-pre-wrap break-words text-xs">{reservationGroups.actionable.map(item => item.technicalCode).filter(Boolean).join("\n")}</pre>
        </details>}
      </section>}
      {reservationGroups.standard.length > 0 && <details className="rounded border p-3">
        <summary className="cursor-pointer text-sm font-medium">Mentions standard ({reservationGroups.standard.length})</summary>
        <ul className="list-disc pl-5 text-sm space-y-2 mt-2">{reservationGroups.standard.map(item => <li key={item.id}>{item.message}</li>)}</ul>
        {reservationGroups.standard.some(item => item.technicalCode) && <details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">Codes techniques pour le support</summary>
          <pre className="whitespace-pre-wrap break-words text-xs">{reservationGroups.standard.map(item => item.technicalCode).filter(Boolean).join("\n")}</pre>
        </details>}
      </details>}
    </>}
  </section>;
}
