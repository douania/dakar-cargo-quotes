import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Check, Loader2, Pencil, X } from "lucide-react";
import type { Database, Json } from "@/integrations/supabase/types";
import {
  EDITABLE_FACT_KEYS,
  FACT_DOMAIN_LABELS,
  FACT_DOMAIN_ORDER,
  FACT_LABELS,
  MULTI_LOT_AMBIGUOUS_FACTS,
  SELECT_FACT_OPTIONS,
  getFactDomain,
} from "@/pages/case-view/constants";
import { FactHistoryPopover } from "@/pages/case-view/FactHistoryPopover";

export type CaseFact = Database["public"]["Tables"]["quote_facts"]["Row"];

interface CaseFactsTableProps {
  caseId: string;
  facts: CaseFact[];
  editingFactId: string | null;
  editValue: string;
  isLocked: boolean;
  isMultiLot: boolean;
  isSavingFact: boolean;
  conflictFactKeys?: ReadonlySet<string>;
  onEditValueChange: (value: string) => void;
  onStartEdit: (fact: CaseFact) => void;
  onCancelEdit: () => void;
  onSaveFact: (fact: CaseFact) => void;
}

function sourceLabel(sourceType: string): string {
  if (["manual_input", "operator", "operator_correction"].includes(sourceType)) return "Opérateur";
  if (sourceType.startsWith("partner") || sourceType.startsWith("external_request")) return "Partenaire";
  if (sourceType.startsWith("client")) return "Client";
  if (sourceType.startsWith("ai_") || ["document_regex", "attachment_extracted"].includes(sourceType)) return "Extraction";
  if (sourceType.startsWith("email_")) return "E-mail";
  if (sourceType === "quotation_engine") return "Moteur";
  return sourceType || "—";
}

function formatContainers(value: Json): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parts = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const type = typeof item.type === "string" ? item.type.trim() : "";
    if (!type) return null;
    const quantity = typeof item.quantity === "number" && Number.isFinite(item.quantity) ? item.quantity : 1;
    const ownership = typeof item.coc_soc === "string" && item.coc_soc.trim() ? `, ${item.coc_soc.trim().toUpperCase()}` : "";
    return `${quantity} × ${type}${ownership}`;
  });
  return parts.some((part) => part === null) ? null : parts.join(", ");
}

function displayValue(fact: CaseFact): { summary: string; technical: string | null } {
  if (fact.fact_key === "cargo.articles_detail" && Array.isArray(fact.value_json)) {
    const articles = fact.value_json;
    const hsCount = new Set(articles.flatMap((article) =>
      article && typeof article === "object" && !Array.isArray(article) && typeof article.hs_code === "string" ? [article.hs_code] : []
    )).size;
    return { summary: `${articles.length} article(s) — ${hsCount} code(s) SH`, technical: JSON.stringify(fact.value_json, null, 2) };
  }
  if (fact.fact_key === "cargo.containers" && fact.value_json !== null) {
    const containers = formatContainers(fact.value_json);
    if (containers) return { summary: containers, technical: JSON.stringify(fact.value_json, null, 2) };
  }
  if (fact.value_text !== null) return { summary: fact.value_text, technical: null };
  if (fact.value_number !== null) return { summary: String(fact.value_number), technical: null };
  if (fact.value_date !== null) return { summary: fact.value_date, technical: null };
  if (fact.value_json !== null) return { summary: "Données structurées à consulter", technical: JSON.stringify(fact.value_json, null, 2) };
  return { summary: "—", technical: null };
}

function confidenceClass(confidence: number): string {
  if (confidence >= 0.9) return "border-success/40 text-success";
  if (confidence >= 0.6) return "border-warning/40 text-warning";
  return "border-destructive/40 text-destructive";
}

export function CaseFactsTable({ caseId, facts, editingFactId, editValue, isLocked, isMultiLot,
  isSavingFact, conflictFactKeys = new Set(), onEditValueChange, onStartEdit, onCancelEdit,
  onSaveFact }: CaseFactsTableProps) {
  const grouped = FACT_DOMAIN_ORDER.map((domain) => ({
    domain,
    facts: facts.filter((fact) => getFactDomain(fact.fact_key) === domain),
  })).filter((group) => group.facts.length > 0);

  return <div className="overflow-x-auto rounded-md border">
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-64">Fait</TableHead>
          <TableHead className="min-w-64">Valeur</TableHead>
          <TableHead className="w-32">Origine</TableHead>
          <TableHead className="w-28 text-right">Confiance</TableHead>
          <TableHead className="w-24"><span className="sr-only">Actions</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {grouped.flatMap(({ domain, facts: domainFacts }) => [
          <TableRow key={`${domain}-heading`} className="hover:bg-transparent">
            <TableCell colSpan={5} className="bg-muted/40 py-2 text-xs font-semibold uppercase text-muted-foreground">
              {FACT_DOMAIN_LABELS[domain]}
            </TableCell>
          </TableRow>,
          ...domainFacts.map((fact) => {
            const isEditing = editingFactId === fact.id;
            const value = displayValue(fact);
            const hasExplicitConflict = conflictFactKeys.has(fact.fact_key);
            return <TableRow key={fact.id} className={hasExplicitConflict ? "bg-destructive/5" : undefined}>
              <TableCell className={hasExplicitConflict ? "border-l-2 border-l-destructive" : undefined}>
                <div className="font-medium text-foreground">{FACT_LABELS[fact.fact_key] ?? fact.fact_key}</div>
                <div className="text-xs text-muted-foreground">{fact.fact_key}</div>
              </TableCell>
              <TableCell>
                {isEditing ? SELECT_FACT_OPTIONS[fact.fact_key] ? (
                  <Select value={editValue} onValueChange={onEditValueChange}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{SELECT_FACT_OPTIONS[fact.fact_key].map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                ) : fact.fact_key === "cargo.articles_detail" ? (
                  <Textarea value={editValue} onChange={(event) => onEditValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") onCancelEdit(); }} className="h-32 font-mono text-xs" autoFocus />
                ) : (
                  <Input value={editValue} onChange={(event) => onEditValueChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSaveFact(fact); if (event.key === "Escape") onCancelEdit(); }} className="h-8" autoFocus />
                ) : <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>{value.summary}</span>
                    {hasExplicitConflict && <Badge variant="destructive">Conflit signalé</Badge>}
                    {isMultiLot && MULTI_LOT_AMBIGUOUS_FACTS.has(fact.fact_key) && <Badge variant="outline" className="border-warning/40 text-warning">Multi-lot</Badge>}
                  </div>
                  {value.technical && <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Détail technique</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">{value.technical}</pre></details>}
                </div>}
              </TableCell>
              <TableCell className="text-muted-foreground">{sourceLabel(fact.source_type)}</TableCell>
              <TableCell className="text-right">
                {fact.confidence === null ? "—" : <Badge variant="outline" className={confidenceClass(fact.confidence)}>{Math.round(fact.confidence * 100)}%</Badge>}
              </TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  {isEditing ? <>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Enregistrer le fait" onClick={() => onSaveFact(fact)} disabled={isSavingFact}>{isSavingFact ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}</Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Annuler la modification" onClick={onCancelEdit} disabled={isSavingFact}><X className="h-3 w-3" /></Button>
                  </> : <>
                    {EDITABLE_FACT_KEYS.has(fact.fact_key) && !isLocked && <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Modifier ${FACT_LABELS[fact.fact_key] ?? fact.fact_key}`} onClick={() => onStartEdit(fact)}><Pencil className="h-3 w-3" /></Button>}
                    <FactHistoryPopover caseId={caseId} factKey={fact.fact_key} />
                  </>}
                </div>
              </TableCell>
            </TableRow>;
          }),
        ])}
      </TableBody>
    </Table>
  </div>;
}