import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import type { SelectedScenarioEstimate } from "./ScenarioEstimateResult";

export function OperatorBasisAdoption({ estimate, onAdopted, onReview }: {
  estimate: SelectedScenarioEstimate; onAdopted?: () => void; onReview?: () => void;
}) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ runId: string; text: string; error: boolean } | null>(null);
  const run = estimate.run;
  if (!run || run.status !== "success" || !estimate.scopeHash) return null;
  const adopt = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(null);
    try {
      const { data, error } = await supabase.functions.invoke("adopt-operator-quotation-basis", { body: {
        case_id: estimate.caseId,
        scenario_id: run.scenario_id,
        scenario_pricing_run_id: run.id,
        expected_scope_hash: estimate.scopeHash,
        idempotency_key: `operator-basis:${run.id}`,
      } });
      if (error) {
        let detail = error.message;
        if (error.context instanceof Response) {
          const payload = await error.context.json().catch(() => null);
          detail = payload?.error?.message ?? payload?.message ?? detail;
        }
        throw new Error(detail);
      }
      const result = data?.data ?? data;
      if (!result?.pricing_run_id || !Number.isInteger(result.run_number)) throw new Error("Réponse de création invalide");
      setMessage({ runId: run.id, text: `Pricing Run #${result.run_number} ${result.idempotent_replay ? "déjà disponible" : "créé"}. Vous pouvez créer sa version, son PDF et son brouillon.`, error: false });
      onAdopted?.();
    } catch (error) {
      setMessage({ runId: run.id, text: error instanceof Error ? error.message : "Création refusée", error: true });
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return <section className="rounded border p-3 space-y-2" aria-label="Devis sur bases retenues">
    <p className="text-sm">Préparer le devis avec ces hypothèses et réserves, sans confirmation préalable du client. Les bases figureront dans le PDF et le brouillon. Une correction ultérieure permet de réviser les bases et de recalculer.</p>
    <div className="flex flex-wrap gap-2">
      <Button onClick={adopt} disabled={pending || estimate.pending || !!estimate.error}>{pending ? "Préparation en cours…" : "Préparer le devis sur ces bases"}</Button>
      {onReview && <Button variant="outline" disabled={pending} onClick={onReview}>Revoir ou corriger les bases</Button>}
    </div>
    {message?.runId === run.id && <p role={message.error ? "alert" : "status"} className="text-sm">{message.text}</p>}
  </section>;
}
