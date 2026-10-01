import { Button } from "@/components/ui/button";
import { SourceText } from "@/components/SourceText";
import { sourcePresentation } from "@/lib/sourcePresentation";
import { FACT_LABELS } from "@/pages/case-view/constants";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const list = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(record) : [];
const present = (value: unknown) => value !== null && value !== undefined && value !== "";
const labels: Record<string, string> = {
  origin: "Origine", originPort: "Port d’origine", originAirport: "Aéroport d’origine",
  destination: "Destination", finalDestination: "Destination finale", destinationPort: "Port de destination",
  destinationAirport: "Aéroport de destination", incoterm: "Incoterm", servicePackage: "Prestations",
  service_package: "Prestations", transportMode: "Mode de transport", transport_mode: "Mode de transport",
  cargoDescription: "Marchandise", cargoWeight: "Poids retenu (tonnes)", cargoVolume: "Volume (m³)",
  cargo_weight: "Poids enregistré (unité non précisée)", cargo_volume: "Volume enregistré (unité non précisée)", containers: "Conteneurs",
  weightPerContainerKg: "Poids par conteneur (kg)", quantity: "Quantité", type: "Type", coc_soc: "Propriété",
};

const sources: Record<string, string> = {
  manual_input: "Saisie opérateur", operator: "Opérateur", operator_correction: "Correction opérateur",
  client_reply: "Réponse client", client_confirmation: "Confirmation client", email_body: "Corps de l’e-mail",
  ai_extraction: "Extraction assistée", document_regex: "Extraction documentaire", quotation_engine: "Moteur de cotation",
  ai_assumption: "Hypothèse assistée",
};
// Exact recorded codes only; anything unknown is shown as recorded.
const codes: Record<string, string> = {
  true: "Oui", false: "Non", MARITIME: "Maritime", AIR: "Aérien", ROAD: "Routier",
  SEA_FCL_IMPORT: "Maritime FCL import", SEA_LCL_IMPORT: "Maritime LCL import",
  SEA_FCL_EXPORT: "Maritime FCL export", SEA_LCL_EXPORT: "Maritime LCL export",
  AIR_IMPORT: "Aérien import", AIR_EXPORT: "Aérien export", ROAD_IMPORT: "Routier import", ROAD_EXPORT: "Routier export",
};
const packageKeys = new Set(["servicePackage", "service_package", "service.package"]);
const digestKeys = ["incoterm", "containers", "cargoWeight", "cargo_weight", "finalDestination", "destination"];
function displayValue(key: string, value: unknown): string {
  return packageKeys.has(key) && typeof value === "string" ? value.trim().replace(/_/g, " ") : valueText(value);
}
function valueText(value: unknown): string {
  if (typeof value === "number") return Number.isFinite(value) ? new Intl.NumberFormat("fr-FR").format(value) : "Non disponible";
  if (typeof value === "boolean") return value ? "Oui" : "Non";
  if (typeof value === "string") return codes[value.trim()] ?? value;
  if (Array.isArray(value)) return value.map(valueText).join(" ; ") || "Non renseigné";
  return Object.entries(record(value)).filter(([, v]) => present(v)).map(([k, v]) => `${labels[k] ?? k} : ${displayValue(k, v)}`).join(" · ") || "Non renseigné";
}

function InputValues({ inputs }: { inputs: unknown }) {
  const entries = Object.entries(record(inputs)).filter(([key, value]) => labels[key] && present(value));
  return entries.length ? <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{entries.map(([key, value]) =>
    <div key={key} className="min-w-0"><dt className="text-xs text-muted-foreground">{labels[key]}</dt><dd className="font-medium [overflow-wrap:anywhere]"><SourceText text={displayValue(key, value)} /></dd></div>
  )}</dl> : <p className="text-muted-foreground">Détail des entrées non conservé dans cet enregistrement.</p>;
}

/** Saved data only. Current dossier values must never be substituted for missing history. */
export function QuotationBasis({ context, inputs, facts, lots, assumptions, onReview, reviewLabel = "Revoir les bases dans Marchandise", collapsed = false }: {
  context: string; inputs?: unknown; facts?: unknown; lots?: unknown; assumptions?: unknown; onReview?: () => void; reviewLabel?: string;
  /** Presentation only: folds the same saved bases behind a one-line digest. */
  collapsed?: boolean;
}) {
  const savedFacts = list(facts).map((f): RecordValue => ({ ...f, key: f.key ?? f.fact_key })).filter(f => typeof f.key === "string" && /^(routing|cargo|service|pricing|regulatory|customs)\./.test(f.key));
  const savedLots = list(lots);
  const inputLots = list(record(inputs).lots);
  const savedInputs = record(inputs);
  const digest = digestKeys.filter(key => present(savedInputs[key])).slice(0, 3)
    .map(key => `${labels[key]} : ${displayValue(key, savedInputs[key])}`).join(" · ")
    || (savedFacts.length > 0 ? `${savedFacts.length} fait${savedFacts.length > 1 ? "s" : ""} conservé${savedFacts.length > 1 ? "s" : ""}` : "données enregistrées avec ce résultat");
  return <section aria-label={`Bases retenues — ${context}`} className="my-3 rounded-lg border bg-background p-4 text-sm">
    <details open={!collapsed || undefined} className="space-y-3">
      <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="font-semibold">Bases retenues pour cette cotation</span>
        <span className="block text-xs text-muted-foreground [overflow-wrap:anywhere]">{context} · {sourcePresentation(digest).text}</span>
      </summary>
    {onReview && <Button variant="outline" size="sm" className="mt-3 h-auto min-h-9 whitespace-normal" onClick={onReview}>{reviewLabel}</Button>}
    <InputValues inputs={inputs} />
    {(savedLots.length > 0 || inputLots.length > 0) && <div className="space-y-3">
      <h4 className="font-medium">Lots enregistrés</h4>
      {(savedLots.length ? savedLots : inputLots).map((lot, index) => {
        const lotInput = inputLots.find(item => item.lot_index === lot.lot_index);
        return <div key={index} className="border-l-2 pl-3">
          <div className="mb-1 font-medium"><SourceText text={typeof lot.label === "string" ? lot.label : typeof lot.lot_label === "string" ? lot.lot_label : `Lot ${String(lot.lot_index ?? index + 1)}`} /></div>
          <InputValues inputs={lotInput ?? lot} />
          <p className="text-xs text-muted-foreground">Les caractéristiques absentes ne sont pas reconstituées à partir du dossier actuel.</p>
        </div>;
      })}
    </div>}
    {savedFacts.length > 0 && <details className="border-t pt-2">
      <summary className="cursor-pointer">Faits conservés au moment du calcul ({savedFacts.length}) et leur origine</summary>
      <p className="my-2 text-xs text-muted-foreground">Contexte enregistré : la présence d’un fait ne prouve pas qu’il a été utilisé par chaque poste ou chaque lot. Les entrées du calcul ci-dessus peuvent retenir une autre valeur.</p>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">{savedFacts.map((fact, index) => <div key={index} className="border-t pt-2 [overflow-wrap:anywhere]">
        <dt className="font-medium">{FACT_LABELS[String(fact.key)] ?? String(fact.key)}{String(fact.key).endsWith("_kg") ? " (kg)" : String(fact.key).endsWith("_cbm") ? " (m³)" : ""}</dt>
        <dd><SourceText text={displayValue(String(fact.key), fact.value_text ?? fact.value_number ?? fact.value_json ?? fact.value_date)} /></dd>
        <dd className="text-xs text-muted-foreground"><SourceText className="text-xs" label="Origine enregistrée" text={typeof fact.source_type === "string" ? sources[fact.source_type] ?? fact.source_type : "non conservée"} /></dd>
      </div>)}</dl>
    </details>}
    {list(assumptions).length > 0 && <section className="border-t pt-2 space-y-2" aria-label="Hypothèses enregistrées">
      <h4 className="font-medium">Hypothèses de cette estimation</h4>
      {list(assumptions).map((item, index) => <div key={index}>
        <SourceText text={typeof item.statement === "string" ? item.statement : "Hypothèse sans libellé enregistré"} />
        {present(item.basis) && <SourceText text={valueText(item.basis)} label="Justification enregistrée" />}
      </div>)}
    </section>}
    <p className="text-xs text-muted-foreground">Les faits actuels peuvent avoir changé depuis cet enregistrement. Les sources détaillées, hypothèses ou caractéristiques non conservées restent inconnues ; consultez aussi les réserves et les postes à confirmer associés au montant.</p>
    </details>
  </section>;
}
