/**
 * Phase P1-A1 — Panneau de gestion des hypothèses opérateur.
 *
 * Remplace le panneau LECTURE SEULE de PROVISIONAL-SCENARIO-QUOTES-UI-1A.
 *
 * Doctrine (docs/PROVISIONAL_SCENARIO_QUOTES.md) :
 *   - hypothèse ≠ fact : rien n'est promu automatiquement ;
 *   - client_confirmed ≠ promoted_to_fact ;
 *   - aucune suppression, aucun pricing, aucun total.
 *
 * Garde-fous (UI) :
 *   - AUCUNE écriture directe : pas de .insert/.update/.upsert/.delete/.rpc.
 *     Le rôle `authenticated` n'a d'ailleurs plus que SELECT sur la table
 *     (migration 20260828120000). Les seules mutations possibles sont
 *     l'invocation des Edge Functions `manage-scenario-assumption` (P1-A1) et
 *     `promote-scenario-assumption` (P1-A3).
 *   - Les 4 transitions proposées sont exactement celles autorisées en P1-A1 :
 *     créer, réviser, confirmer côté client, réfuter.
 *   - P1-A3 ajoute la promotion, EXPLICITE et UNITAIRE : une hypothèse à la
 *     fois, via un dialogue d'attestation. Aucune action de masse, aucune
 *     dé-promotion, aucune clé monétaire ou tarifaire promouvable.
 *   - Les contrôles de saisie ici ne sont qu'un confort : l'autorité est la RPC
 *     service_role-only et les contraintes de la table.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Check, Lightbulb, Link2, Loader2, Pencil, Plus, ShieldCheck, X } from "lucide-react";
import {
  AssumptionPromotionDialog,
  type PromotableAssumption,
} from "@/components/case/AssumptionPromotionDialog";
import { canPromote } from "@/lib/factPromotion";
import {
  allowedActionsForStatus,
  ASSUMPTION_RISK_LEVELS,
  ASSUMPTION_SOURCE_LABELS,
  ASSUMPTION_SOURCE_TYPES,
  ASSUMPTION_STATUS_LABELS,
  ASSUMPTION_TYPE_LABELS,
  ASSUMPTION_TYPES,
  ASSUMPTION_VALUE_TYPE_LABELS,
  ASSUMPTION_VALUE_TYPES,
  buildAssumptionRequestBody,
  formatAssumptionValue,
  type AssumptionDraft,
  type AssumptionOperation,
  type AssumptionRiskLevel,
  type AssumptionSourceType,
  type AssumptionType,
  type AssumptionValueType,
} from "@/lib/scenarioAssumptions";

type QuoteScenarioAssumption =
  Database["public"]["Tables"]["quote_scenario_assumptions"]["Row"];

interface QuoteScenarioAssumptionsPanelProps {
  caseId: string;
}

const SELECTED_COLUMNS =
  "id, scope_key, statement, basis, assumption_type, status, risk_level, client_visible, " +
  "gap_key, assumed_fact_key, source_type, source_refs, metadata, assumed_value, " +
  "assumed_value_type, promoted_fact_id, superseded_by_assumption_id, " +
  "supersedes_assumption_id, created_at, updated_at";

const RISK_LABELS: Record<string, string> = {
  low: "Risque faible",
  medium: "Risque moyen",
  high: "Risque élevé",
};

const RISK_CLASSES: Record<string, string> = {
  low: "bg-emerald-100 text-emerald-800 border-emerald-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  high: "bg-red-100 text-red-800 border-red-200",
};

const ACTION_LABELS: Record<Exclude<AssumptionOperation, "create">, string> = {
  revise: "Réviser",
  confirm_client: "Confirmer client",
  refute: "Réfuter",
};

function emptyDraft(): AssumptionDraft {
  return {
    statement: "",
    basis: "",
    assumptionType: "value",
    valueType: "text",
    valueInput: "",
    scopeKey: "case",
    assumedFactKey: "",
    gapKey: "",
    sourceType: "operator_guidance",
    riskLevel: "medium",
    clientVisible: false,
  };
}

function draftFromAssumption(a: QuoteScenarioAssumption): AssumptionDraft {
  const valueType = (a.assumed_value_type ?? "text") as AssumptionValueType;
  let valueInput: string | boolean = "";
  if (valueType === "boolean") {
    valueInput = a.assumed_value === true;
  } else if (valueType === "json") {
    try {
      valueInput = JSON.stringify(a.assumed_value ?? {}, null, 2);
    } catch {
      valueInput = "";
    }
  } else if (a.assumed_value !== null && a.assumed_value !== undefined) {
    valueInput = String(a.assumed_value);
  }

  return {
    statement: a.statement,
    basis: a.basis ?? "",
    // Périmètre hérité côté serveur : ces champs ne sont pas envoyés en révision.
    assumptionType: a.assumption_type as AssumptionType,
    valueType,
    valueInput,
    scopeKey: a.scope_key,
    assumedFactKey: a.assumed_fact_key ?? "",
    gapKey: a.gap_key ?? "",
    sourceType: a.source_type as AssumptionSourceType,
    riskLevel: a.risk_level as AssumptionRiskLevel,
    clientVisible: a.client_visible,
  };
}

function errorMessage(err: unknown): string | null {
  if (!err) return null;
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    return typeof m === "string" ? m : null;
  }
  return null;
}

/** L'Edge Function renvoie l'enveloppe respondError() dans le corps HTTP. */
async function readEdgeErrorMessage(error: unknown): Promise<string | null> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      const body = (await (ctx as Response).json()) as {
        error?: { message?: string };
      };
      return body?.error?.message ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

function formatLocalDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const hasArrayItems = (v: unknown): boolean => Array.isArray(v) && v.length > 0;
const hasObjectKeys = (v: unknown): boolean =>
  !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length > 0;

interface AssumptionFormProps {
  mode: "create" | "revise";
  draft: AssumptionDraft;
  onChange: (draft: AssumptionDraft) => void;
  onSubmit: () => void;
  onCancel: () => void;
  submitting: boolean;
}

function AssumptionForm({
  mode,
  draft,
  onChange,
  onSubmit,
  onCancel,
  submitting,
}: AssumptionFormProps) {
  const set = <K extends keyof AssumptionDraft>(key: K, value: AssumptionDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <div className="rounded-md border border-violet-200 bg-background p-3 space-y-3 text-xs">
      <div className="space-y-1">
        <Label htmlFor="assumption-statement" className="text-[11px]">
          Énoncé de l'hypothèse
        </Label>
        <Textarea
          id="assumption-statement"
          value={draft.statement}
          onChange={(e) => set("statement", e.target.value)}
          placeholder="Ex : poids brut estimé à 12 tonnes en l'absence de packing list"
          className="text-xs min-h-[60px]"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px]">Type de valeur</Label>
          <Select
            value={draft.valueType}
            onValueChange={(v) =>
              onChange({ ...draft, valueType: v as AssumptionValueType, valueInput: v === "boolean" ? false : "" })
            }
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSUMPTION_VALUE_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {ASSUMPTION_VALUE_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label htmlFor="assumption-value" className="text-[11px]">
            Valeur supposée
          </Label>
          {draft.valueType === "boolean" ? (
            <div className="flex items-center gap-2 h-8">
              <Switch
                id="assumption-value"
                checked={draft.valueInput === true}
                onCheckedChange={(checked) => set("valueInput", checked)}
              />
              <span className="text-muted-foreground">
                {draft.valueInput === true ? "Oui" : "Non"}
              </span>
            </div>
          ) : draft.valueType === "json" ? (
            <Textarea
              id="assumption-value"
              value={typeof draft.valueInput === "string" ? draft.valueInput : ""}
              onChange={(e) => set("valueInput", e.target.value)}
              placeholder='{"unit":"kg"}'
              className="text-xs font-mono min-h-[60px]"
            />
          ) : (
            <Input
              id="assumption-value"
              value={typeof draft.valueInput === "string" ? draft.valueInput : ""}
              onChange={(e) => set("valueInput", e.target.value)}
              placeholder={draft.valueType === "date" ? "AAAA-MM-JJ" : ""}
              className="h-8 text-xs"
            />
          )}
        </div>
      </div>

      {mode === "create" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label className="text-[11px]">Nature</Label>
            <Select
              value={draft.assumptionType}
              onValueChange={(v) => set("assumptionType", v as AssumptionType)}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSUMPTION_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="text-xs">
                    {ASSUMPTION_TYPE_LABELS[t] ?? t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="assumption-scope" className="text-[11px]">
              Périmètre
            </Label>
            <Input
              id="assumption-scope"
              value={draft.scopeKey}
              onChange={(e) => set("scopeKey", e.target.value)}
              placeholder="case, lot:2, commodity:bus…"
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="assumption-fact-key" className="text-[11px]">
              Fait anticipé (optionnel)
            </Label>
            <Input
              id="assumption-fact-key"
              value={draft.assumedFactKey}
              onChange={(e) => set("assumedFactKey", e.target.value)}
              placeholder="cargo.weight_kg"
              className="h-8 text-xs font-mono"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="assumption-gap-key" className="text-[11px]">
              Gap lié (optionnel)
            </Label>
            <Input
              id="assumption-gap-key"
              value={draft.gapKey}
              onChange={(e) => set("gapKey", e.target.value)}
              placeholder="cargo.weight_kg"
              className="h-8 text-xs font-mono"
            />
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Périmètre, nature, fait anticipé et gap sont hérités de l'hypothèse révisée.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-[11px]">Provenance</Label>
          <Select
            value={draft.sourceType}
            onValueChange={(v) => set("sourceType", v as AssumptionSourceType)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSUMPTION_SOURCE_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {ASSUMPTION_SOURCE_LABELS[t] ?? t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-[11px]">Niveau de risque</Label>
          <Select
            value={draft.riskLevel}
            onValueChange={(v) => set("riskLevel", v as AssumptionRiskLevel)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSUMPTION_RISK_LEVELS.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {RISK_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="assumption-basis" className="text-[11px]">
          Base / justification (optionnel)
        </Label>
        <Textarea
          id="assumption-basis"
          value={draft.basis}
          onChange={(e) => set("basis", e.target.value)}
          className="text-xs min-h-[44px]"
        />
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="assumption-client-visible"
          checked={draft.clientVisible}
          onCheckedChange={(checked) => set("clientVisible", checked)}
        />
        <Label htmlFor="assumption-client-visible" className="text-[11px] font-normal">
          Visible par le client (désactivé par défaut)
        </Label>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onCancel} disabled={submitting}>
          Annuler
        </Button>
        <Button size="sm" className="h-7 text-xs" onClick={onSubmit} disabled={submitting}>
          {submitting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
          {mode === "create" ? "Enregistrer l'hypothèse" : "Enregistrer la révision"}
        </Button>
      </div>
    </div>
  );
}

export function QuoteScenarioAssumptionsPanel({ caseId }: QuoteScenarioAssumptionsPanelProps) {
  const queryClient = useQueryClient();
  const [formMode, setFormMode] = useState<"none" | "create" | "revise">("none");
  const [reviseTargetId, setReviseTargetId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssumptionDraft>(emptyDraft);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // P1-A3 : promotion EXPLICITE et UNITAIRE. Une seule hypothèse à la fois ;
  // aucune action de masse n'existe dans ce panneau.
  const [promotionTarget, setPromotionTarget] = useState<PromotableAssumption | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["quote-scenario-assumptions", caseId],
    staleTime: 60_000,
    enabled: !!caseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("quote_scenario_assumptions")
        .select(SELECTED_COLUMNS)
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as QuoteScenarioAssumption[];
    },
  });

  const mutation = useMutation({
    mutationFn: async (input: {
      operation: AssumptionOperation;
      draft: AssumptionDraft | null;
      assumptionId?: string;
      idempotencyKey: string;
    }) => {
      // La clé appartient à la mutation logique, pas à l'exécution de
      // mutationFn : tout rejeu de transport conserve donc exactement la même
      // clé et la RPC peut distinguer replay et collision sémantique.
      const built = buildAssumptionRequestBody(
        caseId,
        input.operation,
        input.idempotencyKey,
        input.draft,
        input.assumptionId,
      );
      if (!built.ok) throw new Error(built.message);

      const { data, error } = await supabase.functions.invoke(
        "manage-scenario-assumption",
        { body: built.body },
      );
      if (error) {
        const detail = await readEdgeErrorMessage(error);
        throw new Error(detail ?? error.message ?? "Mutation refusée");
      }
      return data;
    },
    onSuccess: async (_data, variables) => {
      toast.success(
        variables.operation === "create"
          ? "Hypothèse enregistrée."
          : variables.operation === "revise"
            ? "Hypothèse révisée."
            : variables.operation === "confirm_client"
              ? "Hypothèse confirmée côté client."
              : "Hypothèse réfutée.",
      );
      setFormMode("none");
      setReviseTargetId(null);
      setDraft(emptyDraft());
      await queryClient.invalidateQueries({
        queryKey: ["quote-scenario-assumptions", caseId],
      });
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err) ?? "Mutation refusée");
    },
    onSettled: () => setPendingId(null),
  });

  const runTransition = (
    assumptionId: string,
    operation: Exclude<AssumptionOperation, "create" | "revise">,
  ) => {
    setPendingId(assumptionId);
    mutation.mutate({
      operation,
      draft: null,
      assumptionId,
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const startRevise = (a: QuoteScenarioAssumption) => {
    setReviseTargetId(a.id);
    setDraft(draftFromAssumption(a));
    setFormMode("revise");
  };

  const cancelForm = () => {
    setFormMode("none");
    setReviseTargetId(null);
    setDraft(emptyDraft());
  };

  const submitForm = () => {
    if (formMode === "create") {
      mutation.mutate({
        operation: "create",
        draft,
        idempotencyKey: crypto.randomUUID(),
      });
    } else if (formMode === "revise" && reviseTargetId) {
      setPendingId(reviseTargetId);
      mutation.mutate({
        operation: "revise",
        draft,
        assumptionId: reviseTargetId,
        idempotencyKey: crypto.randomUUID(),
      });
    }
  };

  if (isLoading) {
    return (
      <Card className="mb-6 border-border/50">
        <CardContent className="py-3 px-4 text-xs text-muted-foreground">
          Chargement des hypothèses…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    const message = errorMessage(error);
    return (
      <Alert className="mb-6">
        <AlertDescription className="text-xs">
          <span className="font-medium">Hypothèses indisponibles</span>
          {message ? <span className="text-muted-foreground"> — {message}</span> : null}
        </AlertDescription>
      </Alert>
    );
  }

  const assumptions = data ?? [];
  const submitting = mutation.isPending;

  return (
    <Card className="mb-6 border-violet-200 bg-violet-50/30">
      <CardHeader className="py-3 px-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-violet-600" />
              Hypothèses opérateur
              <Badge variant="secondary" className="text-[10px] ml-1">
                {assumptions.length}
              </Badge>
            </CardTitle>
            <p className="text-[11px] text-muted-foreground mt-1">
              Ce sont des hypothèses, pas des facts confirmés : aucune n'entre dans un calcul
              de prix. Une promotion en fact reste possible, mais jamais automatique — un geste
              explicite et attesté, hypothèse par hypothèse.
            </p>
          </div>
          {formMode === "none" ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs shrink-0"
              onClick={() => {
                setDraft(emptyDraft());
                setFormMode("create");
              }}
            >
              <Plus className="h-3 w-3 mr-1" />
              Ajouter
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="py-2 px-4 space-y-2">
        {formMode === "create" ? (
          <AssumptionForm
            mode="create"
            draft={draft}
            onChange={setDraft}
            onSubmit={submitForm}
            onCancel={cancelForm}
            submitting={submitting}
          />
        ) : null}

        {assumptions.length === 0 && formMode === "none" ? (
          <p className="text-xs text-muted-foreground py-1">
            Aucune hypothèse enregistrée pour ce dossier.
          </p>
        ) : null}

        {assumptions.map((a) => {
          const statusLabel = ASSUMPTION_STATUS_LABELS[a.status] ?? a.status;
          const riskLabel = RISK_LABELS[a.risk_level] ?? a.risk_level;
          const riskClass = RISK_CLASSES[a.risk_level] ?? "bg-muted text-muted-foreground";
          const showSources = hasArrayItems(a.source_refs);
          const showMetadata = hasObjectKeys(a.metadata);
          const actions = allowedActionsForStatus(a.status);
          const isPending = submitting && pendingId === a.id;
          // Promouvoir reste possible depuis `client_confirmed`, que
          // `allowedActionsForStatus` (transitions P1-A1) laisse sans action :
          // compatibilité client et promotion sont deux gestes distincts.
          const promotable = canPromote(a.status, a.assumed_value_type, a.assumed_fact_key);

          if (formMode === "revise" && reviseTargetId === a.id) {
            return (
              <AssumptionForm
                key={a.id}
                mode="revise"
                draft={draft}
                onChange={setDraft}
                onSubmit={submitForm}
                onCancel={cancelForm}
                submitting={submitting}
              />
            );
          }

          return (
            <div
              key={a.id}
              className="rounded-md border border-border/60 bg-background/60 p-2.5 text-xs"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px]">
                    {a.scope_key}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    {ASSUMPTION_TYPE_LABELS[a.assumption_type] ?? a.assumption_type}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                  <Badge variant="outline" className="text-[10px]">
                    {statusLabel}
                  </Badge>
                  <Badge variant="outline" className={`text-[10px] ${riskClass}`}>
                    {riskLabel}
                  </Badge>
                  {a.client_visible ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-sky-50 text-sky-700 border-sky-200"
                    >
                      Visible client
                    </Badge>
                  ) : null}
                  {a.promoted_fact_id ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-blue-50 text-blue-700 border-blue-200"
                      title="Référence informative vers un fact lié — pas une promotion automatique."
                    >
                      <Link2 className="h-3 w-3 mr-1" />
                      Fact lié
                    </Badge>
                  ) : null}
                </div>
              </div>

              <p className="mt-1.5 text-foreground">{a.statement}</p>

              <p className="mt-1 text-muted-foreground">
                <span className="font-medium">Valeur supposée : </span>
                <span className="font-mono">
                  {formatAssumptionValue(a.assumed_value_type, a.assumed_value)}
                </span>
                {a.assumed_value_type ? (
                  <span className="ml-1 text-[10px]">
                    ({ASSUMPTION_VALUE_TYPE_LABELS[a.assumed_value_type as AssumptionValueType] ??
                      a.assumed_value_type})
                  </span>
                ) : null}
              </p>

              {a.basis ? (
                <p className="mt-1 text-muted-foreground">
                  <span className="font-medium">Base : </span>
                  {a.basis}
                </p>
              ) : null}

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {a.gap_key ? (
                  <span>
                    Gap : <span className="font-mono">{a.gap_key}</span>
                  </span>
                ) : null}
                {a.assumed_fact_key ? (
                  <span>
                    Fait anticipé : <span className="font-mono">{a.assumed_fact_key}</span>
                  </span>
                ) : null}
                <span>Visible client : {a.client_visible ? "oui" : "non"}</span>
                <span>Provenance : {ASSUMPTION_SOURCE_LABELS[a.source_type] ?? a.source_type}</span>
                {a.supersedes_assumption_id ? <span>Révision d'une version antérieure</span> : null}
                {showSources ? <span>Sources disponibles</span> : null}
                {showMetadata ? <span>Métadonnées disponibles</span> : null}
                <span>{formatLocalDate(a.created_at)}</span>
              </div>

              {(actions.length > 0 || promotable) && formMode === "none" ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {promotable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px] border-violet-300 text-violet-800 hover:bg-violet-100"
                      disabled={submitting}
                      onClick={() =>
                        setPromotionTarget({
                          id: a.id,
                          status: a.status,
                          statement: a.statement,
                          assumed_value: a.assumed_value,
                          assumed_value_type: a.assumed_value_type,
                          assumed_fact_key: a.assumed_fact_key,
                          scope_key: a.scope_key,
                        })
                      }
                    >
                      <ShieldCheck className="h-3 w-3 mr-1" />
                      Promouvoir en fait
                    </Button>
                  ) : null}
                  {actions.map((action) => (
                    <Button
                      key={action}
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px]"
                      disabled={submitting}
                      onClick={() =>
                        action === "revise" ? startRevise(a) : runTransition(a.id, action)
                      }
                    >
                      {isPending ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : action === "revise" ? (
                        <Pencil className="h-3 w-3 mr-1" />
                      ) : action === "confirm_client" ? (
                        <Check className="h-3 w-3 mr-1" />
                      ) : (
                        <X className="h-3 w-3 mr-1" />
                      )}
                      {ACTION_LABELS[action]}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </CardContent>

      {/* Promotion unitaire : le dialogue ne connaît qu'UNE hypothèse à la fois. */}
      <AssumptionPromotionDialog
        caseId={caseId}
        assumption={promotionTarget}
        onOpenChange={(open) => {
          if (!open) setPromotionTarget(null);
        }}
      />
    </Card>
  );
}
