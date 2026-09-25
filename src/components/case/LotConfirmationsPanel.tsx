import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import type { LotContext, LotDecision, LotDecisionKind, LotIssue, LotLine, LotResolution, LotUnit } from "../../../supabase/functions/_shared/lot-confirmation";

/** MULTI-LOT-TERMINAL-1 (GO CTO 2026-09-25): explicit operator decisions per lot of a
 * multi-lot dossier — which request line each scenario lot is, and its terminal mode.
 * Nothing is inferred, re-applied or written to client facts from this panel. */
type State = { context: LotContext; resolution: LotResolution; read_only: boolean };

const messages: Record<string, string> = {
  LOT_SCENARIO_REQUIRED: "Sélectionnez une version active du scénario décrivant chaque lot (un lot par ligne de demande).",
  LOT_SCOPE_UNSUPPORTED: "Le scénario sélectionné ne permet pas de décrire les lots de ce dossier (version active 2 ou 3 requise).",
  LOT_BINDING_REQUIRED: "Choisissez la ligne de demande qui correspond à ce lot.",
  LOT_CONFIRMATION_REVOKED: "Confirmation retirée.",
  LOT_CONFIRMATION_STALE: "Les données du dossier ont changé depuis cette confirmation : l’ancienne valeur reste affichée, une nouvelle confirmation est nécessaire.",
  LOT_CONFIRMATION_INVALID: "Confirmation non exploitable : à refaire avec sa source.",
  LOT_LINE_CHANGED: "La ligne confirmée n’existe plus dans la demande actuelle.",
  LOT_LINE_AMBIGUOUS: "Plusieurs lignes sont indiscernables : aucune affectation n’est possible sans clarification (demande client ou nouvelle analyse).",
  LOT_LINE_ALREADY_BOUND: "Cette ligne est déjà confirmée pour un autre lot.",
  LOT_LINE_UNBOUND: "Ligne de demande rattachée à aucun lot.",
  LOT_BINDING_CHANGED: "La liaison du lot a changé après cette confirmation : à reconfirmer.",
  LOT_DECISION_AMBIGUOUS: "Décisions concurrentes détectées : actualisez avant toute nouvelle décision.",
  LOT_CONTEXT_CHANGED: "Le dossier a changé pendant l’enregistrement : actualisez puis recommencez.",
  LOT_HEAD_CHANGED: "Une autre décision a été enregistrée entre-temps : actualisez puis recommencez.",
  LOT_CASE_LOCKED: "Dossier verrouillé : aucune décision possible.",
  LOT_NOTHING_TO_REVOKE: "Aucune confirmation active à retirer.",
};
const say = (code: string) => messages[code] ?? "Décision non enregistrée : actualisez les lots et vérifiez les sources.";
const MODES = [
  { value: "LOLO", label: "LoLo — terminal à conteneurs (DP World)" },
  { value: "RORO", label: "RoRo — Dakar Terminal (barème à confirmer, calcul bloqué)" },
  { value: "CONRO", label: "ConRo — Dakar Terminal (barème à confirmer, calcul bloqué)" },
];
const lineName = (line: LotLine) => `Ligne ${line.line_index} — ${line.line_label || "sans libellé"}`;

function DecisionForm({ kind, unit, state, head, lines, onSaved }: {
  kind: LotDecisionKind; unit: LotUnit; state: State; head: LotDecision | undefined; lines: LotLine[]; onSaved: () => Promise<void>;
}) {
  const [choice, setChoice] = useState("");
  const [source, setSource] = useState("");
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const readOnly = state.read_only;
  async function record(action: "confirm" | "revoke") {
    setPending(true); setError(null);
    try {
      const result = await supabase.functions.invoke("manage-lot-confirmation", { body: { case_id: state.context.case_id, action: "record", decision: {
        unit_ref: unit.unit_ref, decision_kind: kind, action,
        line_fingerprint: kind === "line_binding" && action === "confirm" ? choice : null,
        terminal_mode: kind === "terminal_mode" && action === "confirm" ? choice : null,
        source_reference: source.trim(), expected_context_hash: state.context.context_hash, expected_head_id: head?.id ?? null,
        idempotency_key: crypto.randomUUID(),
      } } });
      if (result.error) {
        let code = "";
        try { code = String((await (result.error as { context?: Response }).context?.json())?.code ?? ""); } catch { /* generic message below */ }
        throw new Error(code);
      }
      setChoice(""); setSource(""); setChecked(false);
      await onSaved();
    } catch (e) { setError(say(e instanceof Error ? e.message : "")); }
    finally { setPending(false); }
  }
  const label = kind === "line_binding" ? "Ligne de demande de ce lot" : "Mode d’opération terminal de ce lot";
  const missing = [...(readOnly ? ["Dossier verrouillé."] : []), ...(!choice ? [kind === "line_binding" ? "Choisissez une ligne." : "Choisissez un mode."] : []),
    ...(source.trim().length < 3 ? ["Renseignez la source vérifiée."] : []), ...(!checked ? ["Cochez la vérification."] : [])];
  return <fieldset className="space-y-2 rounded border p-3" disabled={pending}>
    <legend className="px-1 text-sm font-medium">{label}</legend>
    <select aria-label={`${label} — ${unit.unit_ref}`} className="block w-full rounded border bg-background p-2 text-sm" value={choice}
      onChange={e => { setChoice(e.target.value); setChecked(false); }} disabled={readOnly}>
      <option value="">{kind === "line_binding" ? "Choisir une ligne…" : "Choisir un mode…"}</option>
      {kind === "line_binding"
        ? lines.map(line => {
          const twins = lines.filter(l => l.fingerprint === line.fingerprint).length > 1;
          const taken = state.resolution.bindings.some(b => b.line.id === line.id && b.unit_ref !== unit.unit_ref);
          return <option key={line.id} value={line.fingerprint} disabled={twins || taken}>
            {lineName(line)}{twins ? " (indiscernable d’une autre ligne : clarification requise)" : taken ? " (déjà liée à un autre lot)" : ""}
          </option>;
        })
        : MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
    </select>
    <label className="block text-sm">Source vérifiée
      <textarea className="mt-1 block min-h-16 w-full rounded border bg-background p-2" value={source} maxLength={2000}
        onChange={e => { setSource(e.target.value); setChecked(false); }} disabled={readOnly} />
    </label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} disabled={readOnly} />
      {kind === "line_binding" ? "J’ai vérifié que ce lot correspond à cette ligne" : "J’ai vérifié le mode de ce lot dans la source"}</label>
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={pending || missing.length > 0} onClick={() => record("confirm")}>
        {kind === "line_binding" ? "Lier ce lot à la ligne" : "Confirmer le mode terminal"}</Button>
      {head?.action === "confirm" && <Button size="sm" variant="outline" disabled={pending || readOnly || source.trim().length < 3}
        onClick={() => record("revoke")}>Retirer cette confirmation</Button>}
    </div>
    {missing.length > 0 && !readOnly && <p className="text-xs text-muted-foreground">{missing.join(" ")}</p>}
    {error && <p role="alert" className="text-sm text-amber-700">{error}</p>}
  </fieldset>;
}

function currentValue(kind: LotDecisionKind, head: LotDecision | undefined, lines: LotLine[], valid: boolean): string {
  if (!head) return "aucune décision";
  if (head.action !== "confirm") return "confirmation retirée";
  const value = kind === "line_binding"
    ? (lines.find(l => l.fingerprint === head.line_fingerprint) ? lineName(lines.find(l => l.fingerprint === head.line_fingerprint)!) : "ligne absente de la demande actuelle")
    : head.terminal_mode ?? "—";
  return `${valid ? "" : "ancienne valeur, non appliquée : "}${value} (source : ${head.source_reference})`;
}

function LotCard({ unit, state, onSaved }: { unit: LotUnit; state: State; onSaved: () => Promise<void> }) {
  const { context, resolution } = state;
  const head = (kind: LotDecisionKind) => context.heads.find(h => h.unit_ref === unit.unit_ref && h.decision_kind === kind);
  const binding = resolution.bindings.find(b => b.unit_ref === unit.unit_ref);
  const terminal = resolution.terminals.find(t => t.unit_ref === unit.unit_ref);
  const issues = (kind: LotDecisionKind) => resolution.issues.filter((i: LotIssue) => i.unit_ref === unit.unit_ref && i.kind === kind);
  return <article className="space-y-3 rounded-md border bg-card p-4" data-lot-ref={unit.unit_ref}>
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">Lot {unit.unit_ref}</p>
      <h4 className="text-lg font-semibold">{unit.quantity ?? "?"} × {unit.equipment_code ?? unit.unit_kind}</h4>
      <p className="text-sm">{unit.scenario_basis}</p>
    </div>
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="space-y-2">
        <p className="text-sm"><span className="font-medium">Ligne : </span>{binding ? `${lineName(binding.line)} — confirmée` : currentValue("line_binding", head("line_binding"), context.lines, false)}</p>
        {issues("line_binding").map(i => <p key={i.code} className="text-sm text-amber-700">{say(i.code)}</p>)}
        <DecisionForm key={`${context.context_hash}:${head("line_binding")?.id ?? "new"}`} kind="line_binding" unit={unit} state={state}
          head={head("line_binding")} lines={context.lines} onSaved={onSaved} />
      </div>
      <div className="space-y-2">
        <p className="text-sm"><span className="font-medium">Mode terminal : </span>{terminal ? `${terminal.mode} — confirmé` : currentValue("terminal_mode", head("terminal_mode"), context.lines, false)}</p>
        {issues("terminal_mode").map(i => <p key={i.code} className="text-sm text-amber-700">{say(i.code)}</p>)}
        {binding
          ? <DecisionForm key={`${context.context_hash}:${head("terminal_mode")?.id ?? "new"}`} kind="terminal_mode" unit={unit} state={state}
            head={head("terminal_mode")} lines={context.lines} onSaved={onSaved} />
          : <p className="text-sm text-muted-foreground">Liez d’abord ce lot à sa ligne de demande.</p>}
      </div>
    </div>
  </article>;
}

export function LotConfirmationsPanel({ caseId, onChanged }: { caseId: string; onChanged: () => void }) {
  const queryClient = useQueryClient();
  const lineCount = useQuery({ queryKey: ["lot-confirmation-line-count", caseId], queryFn: async () => {
    const { count, error } = await supabase.from("quote_request_lines").select("id", { count: "exact", head: true }).eq("case_id", caseId);
    if (error) throw error;
    return count ?? 0;
  } });
  const multiLot = (lineCount.data ?? 0) >= 2;
  const query = useQuery({ queryKey: ["lot-confirmations", caseId], enabled: multiLot, retry: false, queryFn: async () => {
    const result = await supabase.functions.invoke("manage-lot-confirmation", { body: { case_id: caseId, action: "read" } });
    if (result.error) throw result.error;
    return result.data as State;
  } });
  if (!multiLot) return null;
  const state = query.isError ? undefined : query.data;
  const onSaved = async () => {
    await query.refetch();
    await queryClient.invalidateQueries({ queryKey: ["pad-group-confirmations", caseId] });
    onChanged();
  };
  const globalIssues = state?.resolution.issues.filter(i => !i.unit_ref && !i.line_id) ?? [];
  const lineIssues = state?.resolution.issues.filter(i => !i.unit_ref && i.line_id && i.code !== "LOT_LINE_UNBOUND") ?? [];
  const unbound = state?.context.lines.filter(l => !state.resolution.bindings.some(b => b.line.id === l.id)) ?? [];
  return <section id="section-lot-confirmations" className="my-3 space-y-3" aria-label="Lots du dossier multi-demande">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-base font-semibold">Lots du devis : liaison aux lignes de demande et mode terminal</h3>
      <Button size="sm" variant="outline" onClick={() => query.refetch()} disabled={query.isFetching}>Actualiser les lots</Button>
    </div>
    <p className="text-sm text-muted-foreground">Chaque lot du scénario sélectionné doit être lié explicitement à sa ligne de demande, puis recevoir son mode terminal et sa catégorie PAD.
      Ces décisions ne modifient aucun fait client. Toute réanalyse ou modification du dossier les rend périmées : les anciennes valeurs restent affichées mais doivent être reconfirmées. Le mode terminal global du dossier ne vaut jamais pour un lot.</p>
    {query.isLoading && <p>Chargement des lots…</p>}
    {query.isError && <p role="alert">Confirmations par lot indisponibles. Aucune liaison ni aucun mode ne doit être considéré comme confirmé.</p>}
    {state && <>
      {state.read_only && <p className="text-sm">Dossier verrouillé : consultation uniquement.</p>}
      {globalIssues.map(i => <p key={i.code} className="text-sm text-amber-700">{say(i.code)}</p>)}
      {lineIssues.length > 0 && <p className="text-sm text-amber-700">{say("LOT_LINE_AMBIGUOUS")}</p>}
      {unbound.length > 0 && !globalIssues.length && <p className="text-sm">Lignes encore sans lot : {unbound.map(lineName).join(" ; ")}.</p>}
      {state.resolution.units.map(unit => <LotCard key={unit.unit_ref} unit={unit} state={state} onSaved={onSaved} />)}
    </>}
  </section>;
}
