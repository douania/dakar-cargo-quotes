import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calculator, Check, ChevronDown, ChevronRight, FileDown, FileText, Loader2, Mail, Pencil } from "lucide-react";

export interface ScenarioRevisionRow {
  id: string;
  revisionNo: number;
  title: string;
  createdAt: string;
  selectedAt: string | null;
  revisionReason: string | null;
  headline: string;
  openPoints: string[];
  assumptions: string[];
  result: string;
  status: string;
  statusTone: "selected" | "blocked" | "muted";
  isSelected: boolean;
  canRevise: boolean;
  canSelect: boolean;
  canPrice: boolean;
  pricingSucceeded: boolean;
  outputId: string | null;
  pricingRunId: string | null;
}

interface ScenarioRevisionTableProps {
  rows: ScenarioRevisionRow[];
  locked: boolean;
  busy: boolean;
  pendingScenarioId: string | null;
  pendingPricingId: string | null;
  pendingOutputAction: string | null;
  onRevise: (scenarioId: string) => void;
  onSelect: (scenarioId: string) => void;
  onPrice: (scenarioId: string) => void;
  onCreateOutput: (scenarioId: string) => void;
  onExportPdf: (outputId: string) => void;
  onCreateDraft: (outputId: string) => void;
}

const date = (value: string) => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("fr-FR", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
};

function StatusBadge({ row }: { row: ScenarioRevisionRow }) {
  const tone = row.statusTone === "selected"
    ? "border-primary/40 bg-primary/10 text-primary"
    : row.statusTone === "blocked"
      ? "border-destructive/40 bg-destructive/10 text-destructive"
      : "border-border bg-muted text-muted-foreground";
  return <Badge variant="outline" className={tone}>{row.isSelected && <Check className="mr-1 h-3 w-3" />}{row.status}</Badge>;
}

function RevisionDetail({ row, locked, busy, pendingScenarioId, pendingPricingId, pendingOutputAction,
  onRevise, onSelect, onPrice, onCreateOutput, onExportPdf, onCreateDraft }: ScenarioRevisionTableProps & { row: ScenarioRevisionRow }) {
  const actionsLocked = locked || busy;
  return <div className="space-y-3 rounded-md border bg-background p-4" aria-label={`Détail de la révision ${row.revisionNo}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <p className="font-semibold">Révision {row.revisionNo} · {row.title}</p>
        <p className="text-sm text-muted-foreground">{row.headline || "Périmètre non renseigné"}</p>
      </div>
      <p className="text-xs text-muted-foreground">Créée le {date(row.createdAt)}{row.selectedAt ? ` · sélectionnée le ${date(row.selectedAt)}` : ""}</p>
    </div>
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase text-foreground">Points ouverts · {row.openPoints.length}</p>
        <div className="flex flex-wrap gap-1.5">{row.openPoints.length ? row.openPoints.map((point, index) =>
          <Badge key={`${point}-${index}`} variant="outline" className="border-warning/60 bg-warning/10 text-foreground">{point}</Badge>) :
          <span className="text-xs text-muted-foreground">Aucun</span>}</div>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase text-foreground">Hypothèses appliquées · {row.assumptions.length}</p>
        <div className="flex flex-wrap gap-1.5">{row.assumptions.length ? row.assumptions.map((assumption, index) =>
          <Badge key={`${assumption}-${index}`} variant="outline" className="border-border bg-muted text-foreground">{assumption}</Badge>) :
          <span className="text-xs text-muted-foreground">Aucune</span>}</div>
      </div>
    </div>
    <p className="text-xs text-muted-foreground">Les réserves de cette révision vivent dans la carte Estimation et ne sont pas répétées ici.</p>
    <div className="flex flex-wrap gap-2">
      {row.canPrice && <Button size="sm" disabled={actionsLocked} onClick={() => onPrice(row.id)}>
        {pendingPricingId === row.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Calculator className="mr-1 h-3 w-3" />}
        Recalculer l’estimation
      </Button>}
      {row.canRevise && <Button size="sm" variant="outline" disabled={actionsLocked} onClick={() => onRevise(row.id)}><Pencil className="mr-1 h-3 w-3" />Réviser le périmètre</Button>}
      {row.canSelect && !row.isSelected && <Button size="sm" variant="outline" disabled={actionsLocked} onClick={() => onSelect(row.id)}>
        {pendingScenarioId === row.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}Sélectionner
      </Button>}
      {row.pricingSucceeded && row.isSelected && !row.outputId && <Button size="sm" variant="outline" disabled={actionsLocked || !!pendingOutputAction} onClick={() => onCreateOutput(row.id)}>
        {pendingOutputAction === `create:${row.pricingRunId}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FileText className="mr-1 h-3 w-3" />}
        Créer une sortie de travail (PDF et brouillon marqués scénario)
      </Button>}
      {row.outputId && row.isSelected && <>
        <Button size="sm" variant="outline" disabled={actionsLocked || !!pendingOutputAction} onClick={() => onExportPdf(row.outputId ?? "")}><FileDown className="mr-1 h-3 w-3" />PDF scénario</Button>
        <Button size="sm" variant="outline" disabled={actionsLocked || !!pendingOutputAction} onClick={() => onCreateDraft(row.outputId ?? "")}><Mail className="mr-1 h-3 w-3" />Brouillon non envoyé</Button>
      </>}
    </div>
  </div>;
}

export function ScenarioRevisionTable(props: ScenarioRevisionTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const selected = props.rows.find((row) => row.isSelected) ?? null;
  return <div className="space-y-3">
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead><tr className="border-b text-xs text-muted-foreground">
          <th className="p-2 text-left">Rév.</th><th className="p-2 text-left">Date</th><th className="p-2 text-left">Motif de révision</th>
          <th className="p-2 text-right">Points ouverts</th><th className="p-2 text-right">Hypothèses</th><th className="p-2 text-right">Résultat HT</th><th className="p-2 text-left">Statut</th>
        </tr></thead>
        <tbody>{props.rows.map((row) => <tr key={row.id} className={`border-b last:border-0 ${row.isSelected ? "bg-primary/5" : ""}`}>
          <td className={`p-2 font-semibold ${row.isSelected ? "border-l-2 border-primary" : ""}`}>
            {!row.isSelected ? <Button variant="ghost" size="icon" className="mr-1 h-6 w-6" aria-label={`Afficher la révision ${row.revisionNo}`} aria-expanded={expandedId === row.id} onClick={() => setExpandedId(expandedId === row.id ? null : row.id)}>
              {expandedId === row.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </Button> : null}{row.revisionNo}
          </td>
          <td className="p-2 text-muted-foreground">{date(row.createdAt)}</td><td className="p-2">{row.revisionReason || "Création"}</td>
          <td className="p-2 text-right">{row.openPoints.length}</td><td className="p-2 text-right">{row.assumptions.length}</td><td className="p-2 text-right font-medium">{row.result}</td><td className="p-2"><StatusBadge row={row} /></td>
        </tr>)}</tbody>
      </table>
    </div>
    {selected && <RevisionDetail {...props} row={selected} />}
    {expandedId && expandedId !== selected?.id && props.rows.find((row) => row.id === expandedId) ?
      <RevisionDetail {...props} row={props.rows.find((row) => row.id === expandedId) as ScenarioRevisionRow} /> : null}
  </div>;
}