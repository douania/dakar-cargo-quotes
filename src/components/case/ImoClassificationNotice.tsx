import { resolveImoPricingFacts, type ImoFact } from "../../../supabase/functions/_shared/imo-pricing-facts.ts";

interface Props {
  facts: readonly ImoFact[];
  isMultiLot?: boolean;
  pendingFact?: { key: string; value: string } | null;
}

/** Affiche une projection sourcée ; aucun fait client ajouté ou remplacé. */
export default function ImoClassificationNotice({ facts, isMultiLot = false, pendingFact }: Props) {
  const isPreview = !!pendingFact && ["cargo.un_number", "cargo.imo_class", "cargo.dangerous_goods"].includes(pendingFact.key);
  const effectiveFacts = isPreview
    ? [...facts.filter(f => f.fact_key !== pendingFact!.key), { fact_key: pendingFact!.key, value_text: pendingFact!.value }]
    : facts;
  const result = resolveImoPricingFacts(effectiveFacts);
  if (result.classification.status === "MISSING") return null;
  const blocked = result.blockers.length > 0;
  const source = result.classification.source;
  return (
    <div role={blocked ? "alert" : "status"} className={`mb-4 rounded-lg border p-4 text-sm space-y-2 ${blocked ? "border-destructive text-destructive" : "border-border bg-muted/30"}`}>
      <p className="font-medium">Classification IMDG{isPreview ? " — aperçu avant enregistrement" : ""}</p>
      <p>{result.message}</p>
      {result.classification.status === "DERIVED" && <p>Classe déterminée automatiquement à partir du numéro ONU.</p>}
      {blocked && <p>À corriger avant le chiffrage.</p>}
      {isMultiLot && <p>Information au niveau du dossier : préciser la classification de chaque lot concerné. Un numéro ONU global ne s’applique pas automatiquement à tous les lots.</p>}
      {source && <p className="text-xs text-muted-foreground">
        Source : <a href={source.url} target="_blank" rel="noreferrer" className="underline">Bundesanstalt für Materialforschung und -prüfung (BAM) — Datenbank GEFAHRGUT, IMDG {source.amendment}</a>
        {" · "}<a href={source.license} target="_blank" rel="noreferrer" className="underline">dl-de/by-2-0</a>
        {" · Projection numéro ONU / classe principale."}
      </p>}
    </div>
  );
}
