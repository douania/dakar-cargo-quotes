/**
 * CARGO-CANONICAL-TO-LEGACY-FACTS-SYNC-AUDIT-1
 * CargoCanonicalLegacyFactsSyncPanel — preview (dry_run) + sync explicite opérateur
 * d'une projection minimale du cargo canonique vers les legacy quote_facts.
 *
 * Doctrine :
 *   1. PREVIEW (dry_run) — appelle sync-canonical-cargo-to-legacy-facts en mode
 *      "dry_run". AUCUNE écriture. Affiche les facts candidats et les facts ignorés.
 *   2. SYNC (commit) — sur confirmation opérateur explicite, appelle la MÊME fonction
 *      en mode "commit". Écrit UNIQUEMENT quote_facts (côté Edge Function).
 *
 * Garde-fous (UI) :
 *   - Appelle UNIQUEMENT sync-canonical-cargo-to-legacy-facts (dry_run / commit).
 *   - N'appelle JAMAIS run-pricing / set-case-fact / canonicalize-cargo-from-case /
 *     write-cargo-canonical ; n'utilise PAS saveGapAnswer ; ne touche PAS quote_gaps.
 *   - Bouton SÉPARÉ de « Adopter le cargo canonique » (mécanismes distincts).
 *   - Confirmation opérateur obligatoire avant commit.
 *   - Après succès : rafraîchit case/facts/events/gaps via onSynced (callback parent).
 *     Ne déclenche PAS pricingRefreshToken ; n'appelle PAS PricingLaunchPanel.
 */

import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertTriangle,
  ArrowRightLeft,
  Eye,
  Info,
  Loader2,
} from "lucide-react";

/* ---------- Types locaux (aucun import depuis types.ts) ---------- */
interface FactCandidate {
  fact_key: string;
  fact_category?: string;
  value_text?: string | null;
  value_number?: number | null;
  value_json?: unknown;
  reason?: string;
}

interface SkippedFact {
  fact_key: string;
  reason?: string;
}

interface SyncData {
  mode?: string;
  case_id?: string;
  facts?: FactCandidate[];
  skipped?: SkippedFact[];
  written?: Array<{ fact_key: string; fact_id: string }>;
  source_type?: string;
}

interface SyncEnvelope {
  ok?: boolean;
  data?: SyncData;
  error?: { code?: string; message?: string };
}

type PanelState = "idle" | "loading" | "done" | "error";

function formatValue(f: FactCandidate): string {
  if (f.value_json !== null && f.value_json !== undefined) {
    return JSON.stringify(f.value_json);
  }
  if (f.value_number !== null && f.value_number !== undefined) {
    return String(f.value_number);
  }
  if (f.value_text !== null && f.value_text !== undefined) {
    return f.value_text;
  }
  return "—";
}

async function readErrorBody(error: unknown): Promise<SyncEnvelope | null> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx && typeof (ctx as Response).json === "function") {
    try {
      return (await (ctx as Response).json()) as SyncEnvelope;
    } catch {
      return null;
    }
  }
  return null;
}

export function CargoCanonicalLegacyFactsSyncPanel({
  caseId,
  onSynced,
}: {
  caseId: string;
  /** Appelé après une synchronisation réussie (refresh case/facts/events/gaps). */
  onSynced?: () => void;
}) {
  const [state, setState] = useState<PanelState>("idle");
  const [preview, setPreview] = useState<SyncData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function handlePreview() {
    setState("loading");
    setErrorMsg(null);
    setPreview(null);

    try {
      const { data, error } = await supabase.functions.invoke<SyncEnvelope>(
        "sync-canonical-cargo-to-legacy-facts",
        { body: { case_id: caseId, mode: "dry_run" } },
      );

      if (error) {
        const body = await readErrorBody(error);
        if (body?.error) {
          setErrorMsg(body.error.message ?? "Prévisualisation impossible");
          setState("error");
          return;
        }
        setErrorMsg(error.message ?? "Erreur réseau lors de la prévisualisation");
        setState("error");
        return;
      }

      setPreview(data?.data ?? null);
      setState("done");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur inconnue");
      setState("error");
    }
  }

  /**
   * Sync explicite opérateur (commit). SEUL appel : la même Edge Function en mode
   * "commit". Aucune autre écriture côté UI. En cas d'erreur : aucun fallback.
   */
  async function handleSync() {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke<SyncEnvelope>(
        "sync-canonical-cargo-to-legacy-facts",
        { body: { case_id: caseId, mode: "commit" } },
      );

      if (error) {
        const body = await readErrorBody(error);
        toast.error(
          body?.error?.message ?? error.message ?? "Échec de la synchronisation",
        );
        return;
      }

      const written = data?.data?.written?.length ?? 0;
      toast.success(
        written > 0
          ? `${written} fact(s) legacy synchronisé(s) (quote_facts).`
          : "Aucun fact à synchroniser.",
      );
      setConfirmOpen(false);
      onSynced?.();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Erreur inconnue lors de la synchronisation",
      );
    } finally {
      setSyncing(false);
    }
  }

  const facts = preview?.facts ?? [];
  const skipped = preview?.skipped ?? [];
  const canSync = state === "done" && facts.length > 0;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ArrowRightLeft className="h-5 w-5 text-primary" />
          Cargo canonique → facts legacy
        </CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" />
          Projection minimale vers quote_facts. Mécanisme distinct de l'adoption
          canonique. Aucun pricing n'est lancé.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={handlePreview} disabled={state === "loading"} className="gap-2">
          {state === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          Prévisualiser la synchronisation
        </Button>

        {state === "error" && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Prévisualisation impossible</AlertTitle>
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}

        {state === "done" && preview && (
          <div className="space-y-4">
            {/* Bouton sync explicite — séparé d'« Adopter le cargo canonique » */}
            {canSync && (
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <Button
                  variant="default"
                  className="gap-2"
                  disabled={syncing}
                  onClick={() => setConfirmOpen(true)}
                >
                  {syncing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowRightLeft className="h-4 w-4" />
                  )}
                  Synchroniser vers facts legacy
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Synchroniser vers les facts legacy ?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2 text-sm">
                        <p>
                          Cette action écrit <strong>uniquement</strong> les facts
                          legacy listés ci-dessous (<strong>quote_facts</strong>).
                        </p>
                        <ul className="list-disc pl-5 space-y-0.5">
                          <li><strong>cargo_lines</strong> / <strong>cargo_equipment</strong> ne sont pas modifiés.</li>
                          <li><strong>quote_gaps</strong> ne sera pas résolu.</li>
                          <li>Le pricing n'est <strong>pas</strong> lancé automatiquement.</li>
                        </ul>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={syncing}>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={syncing}
                      onClick={(e) => {
                        e.preventDefault();
                        void handleSync();
                      }}
                    >
                      {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Confirmer la synchronisation
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {/* Facts à écrire */}
            <div>
              <p className="text-sm font-semibold mb-1">
                Facts à écrire ({facts.length})
              </p>
              {facts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Aucun fact candidat déterministe.
                </p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Clé</TableHead>
                        <TableHead>Valeur</TableHead>
                        <TableHead>Raison</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {facts.map((f) => (
                        <TableRow key={f.fact_key}>
                          <TableCell className="font-mono text-xs">{f.fact_key}</TableCell>
                          <TableCell className="font-mono text-xs">{formatValue(f)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {f.reason ?? "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Facts ignorés */}
            <div>
              <p className="text-sm font-semibold mb-1">
                Facts ignorés ({skipped.length})
              </p>
              {skipped.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun fact ignoré.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {skipped.map((s) => (
                    <div key={s.fact_key} className="flex items-center gap-2 text-xs">
                      <Badge variant="secondary" className="font-mono">{s.fact_key}</Badge>
                      <span className="text-muted-foreground">{s.reason ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CargoCanonicalLegacyFactsSyncPanel;
