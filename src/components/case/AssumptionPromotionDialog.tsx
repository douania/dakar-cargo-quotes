/**
 * Phase P1-A3 — Dialogue de promotion d'UNE hypothèse en fait du dossier.
 *
 * Doctrine (docs/PROVISIONAL_SCENARIO_QUOTES.md) :
 *   - une promotion n'est JAMAIS automatique : elle exige une clé cible, une
 *     base de promotion d'un vocabulaire fermé et une attestation cochée ;
 *   - UNE hypothèse par geste : ce composant ne promeut que celle qu'on lui
 *     passe, et n'expose AUCUNE action de masse (arbitrage CTO n°4) ;
 *   - aucune dé-promotion (arbitrage CTO n°6) : rien ici ne la propose ;
 *   - aucun prix, aucun total, aucun devis, aucun email.
 *
 * Garde-fous (UI) :
 *   - AUCUNE écriture directe : pas de .insert/.update/.upsert/.delete/.rpc.
 *     La seule mutation possible est l'invocation de l'Edge Function
 *     `promote-scenario-assumption`. Les deux requêtes de ce composant sont des
 *     SELECT sous RLS, destinés à MONTRER ce qui va se passer.
 *   - Ce que l'opérateur voit est exactement ce qui part : la valeur affichée,
 *     le fait courant affiché et le périmètre de scénario affiché sont échoés
 *     au serveur, qui refuse si l'un d'eux a bougé entre-temps.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import {
  buildPromotionRequestBody,
  buildPromotionSignature,
  findPromotableFactKey,
  formatCurrentFactValue,
  formatPromotedValue,
  PROMOTION_BASES,
  PROMOTION_BASIS_LABELS,
  promotableKeysFor,
  promotionBlockReason,
  type CurrentFact,
  type PromotionBasis,
  type ScenarioContext,
} from "@/lib/factPromotion";

export interface PromotableAssumption {
  id: string;
  status: string;
  statement: string;
  assumed_value: unknown;
  assumed_value_type: string | null;
  assumed_fact_key: string | null;
  scope_key: string;
}

interface AssumptionPromotionDialogProps {
  caseId: string;
  assumption: PromotableAssumption | null;
  onOpenChange: (open: boolean) => void;
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
      const body = (await (ctx as Response).json()) as { error?: { message?: string } };
      return body?.error?.message ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export function AssumptionPromotionDialog({
  caseId,
  assumption,
  onOpenChange,
}: AssumptionPromotionDialogProps) {
  const queryClient = useQueryClient();
  const [factKey, setFactKey] = useState<string>("");
  const [basis, setBasis] = useState<PromotionBasis | null>(null);
  const [attested, setAttested] = useState(false);
  // Une réponse réseau perdue ne doit pas transformer le rejeu manuel du même
  // geste logique en nouvelle mutation. Changer un élément attesté produit une
  // nouvelle signature et donc une nouvelle clé.
  const mutationKeys = useRef(new Map<string, string>());

  const valueType = assumption?.assumed_value_type ?? null;
  const assumedFactKey = assumption?.assumed_fact_key ?? null;

  const candidates = useMemo(
    () => promotableKeysFor(valueType, assumedFactKey),
    [valueType, assumedFactKey],
  );

  const blockReason = assumption
    ? promotionBlockReason(assumption.status, valueType, assumedFactKey)
    : null;

  // Réinitialisation à chaque ouverture : ni la base ni l'attestation ne
  // survivent d'une hypothèse à l'autre — attester est un geste, pas un réglage.
  useEffect(() => {
    if (!assumption) return;
    setBasis(null);
    setAttested(false);
    setFactKey(candidates.length === 1 ? candidates[0].factKey : "");
  }, [assumption, candidates]);

  // Le fait courant que la promotion remplacera. Lecture seule sous RLS : ce
  // qui est affiché ici est exactement ce qui sera échoé au serveur.
  const currentFactQuery = useQuery({
    queryKey: ["quote-fact-current", caseId, factKey],
    enabled: !!caseId && factKey !== "" && !!assumption,
    staleTime: 0,
    queryFn: async (): Promise<CurrentFact | null> => {
      const { data, error } = await supabase
        .from("quote_facts")
        .select("id, value_text, value_number, source_type")
        .eq("case_id", caseId)
        .eq("fact_key", factKey)
        .eq("is_current", true)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as CurrentFact | null;
    },
  });

  // Scénario VIVANT auquel l'hypothèse est liée. Le serveur EXIGE ce contexte
  // dès qu'il en existe un : promouvoir « hors contexte » serait un geste aveugle.
  const scenarioQuery = useQuery({
    queryKey: ["quote-scenario-link-for-assumption", caseId, assumption?.id],
    enabled: !!caseId && !!assumption,
    staleTime: 0,
    queryFn: async (): Promise<ScenarioContext | null> => {
      const { data, error } = await supabase
        .from("quote_scenario_links")
        .select("scenario_id, quote_scenarios!inner(id, status, scope_hash)")
        .eq("case_id", caseId)
        .eq("assumption_id", assumption!.id)
        .neq("quote_scenarios.status", "superseded")
        .limit(2);
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length > 1) {
        throw new Error(
          "Cette hypothèse est liée à plusieurs scénarios actifs. La promotion est bloquée jusqu'à ce qu'un contexte unique soit sélectionné.",
        );
      }
      const row = rows[0] as unknown as
        | { quote_scenarios?: { id: string; scope_hash: string } | null }
        | undefined;
      const scenario = row?.quote_scenarios ?? null;
      if (!scenario) return null;
      return { scenarioId: scenario.id, scopeHash: scenario.scope_hash };
    },
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!assumption) throw new Error("Hypothèse manquante.");
      const draft = {
        assumptionId: assumption.id,
        assumptionStatus: assumption.status,
        valueType,
        value: assumption.assumed_value,
        assumedFactKey,
        factKey,
        basis,
        attested,
        currentFact: currentFactQuery.data ?? null,
        scenario: scenarioQuery.data ?? null,
      };
      const signature = buildPromotionSignature(caseId, draft);
      let idempotencyKey = mutationKeys.current.get(signature);
      if (!idempotencyKey) {
        idempotencyKey = crypto.randomUUID();
        mutationKeys.current.set(signature, idempotencyKey);
      }
      const built = buildPromotionRequestBody(caseId, idempotencyKey, draft);
      if (!built.ok) throw new Error(built.message);

      const { data, error } = await supabase.functions.invoke(
        "promote-scenario-assumption",
        { body: built.body },
      );
      if (error) {
        const detail = await readEdgeErrorMessage(error);
        throw new Error(detail ?? error.message ?? "Promotion refusée");
      }
      return data;
    },
    onSuccess: async () => {
      toast.success("Hypothèse promue en fait du dossier.");
      onOpenChange(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["quote-scenario-assumptions", caseId] }),
        queryClient.invalidateQueries({ queryKey: ["quote-fact-current", caseId] }),
      ]);
    },
    onError: (err: unknown) => {
      toast.error(errorMessage(err) ?? "Promotion refusée");
    },
  });

  const selected = factKey === "" ? null : findPromotableFactKey(factKey);
  const contextLoading = currentFactQuery.isLoading || scenarioQuery.isLoading;
  const contextError = currentFactQuery.error ?? scenarioQuery.error;
  const submitting = mutation.isPending;

  // Fail-closed : tant que le contexte n'est pas chargé, on ne peut pas attester
  // de ce qu'on remplace, donc on ne peut pas promouvoir.
  const canSubmit =
    !!assumption &&
    blockReason === null &&
    selected !== null &&
    basis !== null &&
    attested &&
    !contextLoading &&
    !contextError &&
    !submitting;

  return (
    <Dialog open={!!assumption} onOpenChange={(open) => !open && onOpenChange(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-violet-600" />
            Promouvoir cette hypothèse en fait
          </DialogTitle>
          <DialogDescription className="text-xs">
            La promotion est explicite, unitaire et définitive : elle inscrit la valeur dans les
            faits du dossier et clôt l'hypothèse. Aucune dé-promotion n'est possible ici, et aucun
            prix n'est calculé.
          </DialogDescription>
        </DialogHeader>

        {!assumption ? null : blockReason !== null ? (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">{blockReason}</AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3 text-xs">
            <div className="rounded-md border border-border/60 bg-muted/30 p-2.5">
              <p className="text-muted-foreground">Hypothèse</p>
              <p className="mt-0.5 text-foreground">{assumption.statement}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Périmètre <span className="font-mono">{assumption.scope_key}</span>
                {" · "}
                Statut{" "}
                {assumption.status === "client_confirmed" ? "confirmée client" : "active"}
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-[11px]">Fait cible</Label>
              {candidates.length === 1 ? (
                <p className="font-mono text-[11px] rounded-md border border-border/60 bg-background px-2 py-1.5">
                  {candidates[0].factKey}
                  <span className="ml-2 font-sans text-muted-foreground">
                    {candidates[0].label}
                  </span>
                </p>
              ) : (
                <Select value={factKey} onValueChange={setFactKey}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Choisir le fait à écrire" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((c) => (
                      <SelectItem key={c.factKey} value={c.factKey} className="text-xs">
                        {c.label} — <span className="font-mono">{c.factKey}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-[11px] text-muted-foreground">
                Les clés monétaires et tarifaires ne sont pas promouvables ; les classifications
                HS et PAD passent par leur workflow dédié.
              </p>
            </div>

            {/* Ce qui va exactement se passer : valeur écrite et fait remplacé. */}
            {selected === null ? null : contextLoading ? (
              <p className="text-muted-foreground">Lecture de l'état courant…</p>
            ) : contextError ? (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  État courant illisible — promotion impossible.
                  {errorMessage(contextError) ? ` ${errorMessage(contextError)}` : null}
                </AlertDescription>
              </Alert>
            ) : (
              <div className="rounded-md border border-violet-200 bg-violet-50/50 p-2.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground shrink-0">Fait courant :</span>
                  <span className="font-mono truncate">
                    {formatCurrentFactValue(currentFactQuery.data ?? null)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <ArrowRight className="h-3 w-3 shrink-0 text-violet-600" />
                  <span className="text-muted-foreground shrink-0">Valeur écrite :</span>
                  <span className="font-mono font-medium truncate">
                    {formatPromotedValue(valueType, assumption.assumed_value)}
                  </span>
                </div>
                {currentFactQuery.data ? (
                  <p className="text-[11px] text-amber-800">
                    Le fait courant sera remplacé et conservé en historique.
                  </p>
                ) : null}
                {scenarioQuery.data ? (
                  <p className="text-[11px] text-muted-foreground">
                    Contexte : scénario{" "}
                    <span className="font-mono">
                      {scenarioQuery.data.scenarioId.slice(0, 8)}
                    </span>{" "}
                    — périmètre{" "}
                    <span className="font-mono">
                      {scenarioQuery.data.scopeHash.slice(0, 12)}
                    </span>
                    . Si ce scénario est révisé entre-temps, la promotion sera refusée.
                  </p>
                ) : null}
              </div>
            )}

            <Separator />

            <div className="space-y-1">
              <Label className="text-[11px]">Base de la promotion</Label>
              <Select
                value={basis ?? ""}
                onValueChange={(v) => setBasis(v as PromotionBasis)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Sur quoi repose cette promotion ?" />
                </SelectTrigger>
                <SelectContent>
                  {PROMOTION_BASES.map((b) => (
                    <SelectItem key={b} value={b} className="text-xs">
                      {PROMOTION_BASIS_LABELS[b]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
              <Checkbox
                id="promotion-attestation"
                checked={attested}
                onCheckedChange={(checked) => setAttested(checked === true)}
                className="mt-0.5"
              />
              <Label
                htmlFor="promotion-attestation"
                className="text-[11px] font-normal leading-relaxed"
              >
                J'atteste que cette valeur n'est plus une hypothèse : elle devient un fait du
                dossier, opposable aux traitements en aval. Cette promotion est définitive et
                n'est pas réversible depuis cet écran.
              </Label>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Annuler
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
          >
            {submitting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : null}
            Promouvoir en fait
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
