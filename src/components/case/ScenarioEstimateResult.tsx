import { Button } from "@/components/ui/button";
import { formatScenarioPricingAmount, readScenarioPricingCodes, scenarioPricingCodeMessage, type ScenarioPricingRunSummary } from "@/lib/scenarioPricing";
export interface SelectedScenarioEstimate {
  caseId: string; title: string; run: ScenarioPricingRunSummary | null; pending: boolean; error: string | null;
}
type Line = Record<string, unknown>;
const sourceOf = (line: Line): Line => line.source && typeof line.source === "object" ? line.source as Line : {};
const isExcluded = (line: Line) => sourceOf(line).type === "EXCLUDED_BY_RULE";
const isPriced = (line: Line) => typeof line.amount === "number" && Number.isFinite(line.amount) && sourceOf(line).type !== "TO_CONFIRM" && !isExcluded(line);

/** Presentation only: no amount, fact, tariff or persisted status is changed. */
function pendingFamily(line: Line) {
  const canonical = line.canonical && typeof line.canonical === "object" ? line.canonical as Line : {};
  const key = String(canonical.service_key ?? line.category ?? line.description ?? "Prestation");
  if (/PAD/i.test(key)) return { key: "PAD", label: "Droit de passage portuaire", action: "Vérifier les choix PAD par groupe" };
  if (/THC|Terminal|MANUTENTION/i.test(key)) return { key: "THC", label: "Manutention et frais de terminal", action: "Vérifier les données et réserves par groupe" };
  if (/TRUCK|TRANSPORT|DELIVERY/i.test(key)) return { key: "TRANSPORT", label: "Transport terrestre", action: "Consulter les postes et tarifs manquants" };
  if (/EMPTY_RETURN/i.test(key)) return { key: "RETURN", label: "Retour des conteneurs vides", action: "Consulter les conditions à confirmer" };
  return { key, label: String(line.description ?? line.category ?? "Prestation à préciser").split(" — ")[0], action: "Consulter la réserve du poste" };
}
export function ScenarioEstimateResult({ estimate, onReview }: { estimate: SelectedScenarioEstimate; onReview?: () => void }) {
  const { run, pending, error } = estimate;
  const lines = Array.isArray(run?.tariff_lines) ? run.tariff_lines as Line[] : [];
  const families = new Map<string, { label: string; action: string; count: number; scenario: boolean }>();
  for (const line of lines.filter(line => !isPriced(line) && !isExcluded(line))) {
    const family = pendingFamily(line);
    const previous = families.get(family.key);
    families.set(family.key, { ...family, count: (previous?.count ?? 0) + 1, scenario: family.key === "PAD" || family.key === "THC" });
  }
  const codes = readScenarioPricingCodes([...(Array.isArray(run?.blockers) ? run.blockers : []), ...(Array.isArray(run?.reservations) ? run.reservations : [])]);
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
        {lines.length > 0 && <details id="estimate-service-details" className="rounded border p-3">
          <summary className="cursor-pointer font-medium text-sm">Détail des prestations et sources ({lines.length})</summary>
          <div className="overflow-x-auto mt-3"><table className="w-full text-sm"><caption className="sr-only">Détail des prestations de cette estimation</caption>
          <thead><tr><th className="text-left p-2">Prestation / groupe</th><th className="text-right p-2 whitespace-nowrap">Montant</th><th className="text-left p-2">Source ou réserve</th></tr></thead>
          <tbody>{lines.map((line, i) => {
            const source = sourceOf(line);
            return <tr className="border-t align-top" key={`${String(line.id ?? "line")}-${i}`}><td className="p-2">{String(line.description ?? line.category ?? "Prestation")}</td>
              <td className="text-right p-2 whitespace-nowrap">{isExcluded(line) ? "Exclu sous hypothèse" : isPriced(line) ? formatScenarioPricingAmount(line.amount as number, String(line.currency ?? run.currency)) : "À confirmer"}</td>
              <td className="p-2 break-words">{String(isPriced(line) ? source.reference ?? "Source non renseignée" : line.notes ?? source.reference ?? "Données ou tarif à préciser")}
                {isPriced(line) && typeof line.notes === "string" && <p className="mt-1 text-xs text-muted-foreground">{line.notes}</p>}
              </td></tr>;
          })}</tbody></table></div>
        </details>}
      </> : <p role="alert">{run.status === "blocked" ? "Calcul bloqué : aucun montant retenu." : "Calcul non abouti : aucun montant retenu."}</p>}
      {codes.length > 0 && <details className="rounded border p-3" open={run.status !== "success"}>
        <summary className="cursor-pointer text-sm font-medium">Hypothèses et réserves ({codes.length})</summary>
        <ul className="list-disc pl-5 text-sm space-y-2 mt-2">{codes.map(code => <li key={code}>
          {scenarioPricingCodeMessage(code) === code ? "Point de contrôle à examiner dans les détails techniques." : scenarioPricingCodeMessage(code)}
        </li>)}</ul>
        <details className="mt-3"><summary className="cursor-pointer text-xs text-muted-foreground">Codes techniques pour le support</summary>
          <pre className="whitespace-pre-wrap break-words text-xs">{codes.join("\n")}</pre>
        </details>
      </details>}
    </>}
  </section>;
}
