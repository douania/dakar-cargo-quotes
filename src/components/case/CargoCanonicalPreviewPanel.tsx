/**
 * MULTI-CARGO-LINES-ARCHITECTURE-1
 * CargoCanonicalPreviewPanel — preview READ-ONLY + adoption explicite opérateur.
 *
 * Doctrine :
 *   1. PREVIEW (lecture seule) — sur action explicite, dérive le cargo canonique
 *      depuis les pièces jointes via `derive-cargo-canonical-payload` (qui appelle
 *      lui-même le canonicalizer en dry_run). Rien n'est persisté.
 *   2. ADOPTION (écriture cargo canonique uniquement) — sur confirmation opérateur
 *      explicite, adopte le `derived_payload` déjà renvoyé par le dry-run réussi
 *      en appelant `canonicalize-cargo-from-case` en mode "commit".
 *
 * Garde-fous :
 *   - Preview : appelle UNIQUEMENT `derive-cargo-canonical-payload`.
 *   - Adoption : appelle UNIQUEMENT `canonicalize-cargo-from-case` (mode commit),
 *     en réutilisant le `derived_payload` du dry-run (jamais de re-dérivation).
 *   - N'appelle JAMAIS `write-cargo-canonical` directement depuis le frontend.
 *   - N'appelle JAMAIS `run-pricing` ni `set-case-fact` ; n'écrit PAS quote_facts ;
 *     ne résout PAS quote_gaps ; ne réutilise PAS saveGapAnswer.
 *   - Cible d'écriture : cargo_lines / cargo_equipment uniquement.
 *   - Confirmation opérateur obligatoire avant commit ; bouton désactivé pendant
 *     l'appel ; aucun fallback d'écriture en cas d'erreur.
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
  Boxes,
  Eye,
  Info,
  Loader2,
  PackageCheck,
  PackageSearch,
} from "lucide-react";

/* ---------- Types locaux (aucun import depuis types.ts) ---------- */
interface EquipmentRow {
  equipment_type?: string;
  quantity?: number;
  status?: string;
  source_excerpt?: string | null;
}

interface CargoLineRow {
  line_index?: number;
  status?: string;
  description?: string | null;
  hs_code?: string | null;
  value_number?: number | null;
  value_currency?: string | null;
  weight_kg?: number | null;
  volume_cbm?: number | null;
  pieces_count?: number | null;
  equipment?: EquipmentRow[];
}

/** Source normalisée renvoyée dans derived_payload (réutilisée telle quelle au commit). */
interface DerivedSource {
  source_email_id: string | null;
  source_quote_request_line_id: string | null;
  source_excerpt: string | null;
}

interface DerivedCargoPayload {
  cargo_lines?: CargoLineRow[];
  unallocated_equipment?: EquipmentRow[];
}

interface DeriveResult {
  ok?: boolean;
  case_id?: string;
  error?: { code?: string; message?: string };
  // derived_payload est renvoyé tel quel par le dry-run réussi et réutilisé
  // INTÉGRALEMENT pour l'adoption (case_id + source + cargo_payload).
  derived_payload?: {
    case_id?: string;
    source?: DerivedSource;
    cargo_payload?: DerivedCargoPayload;
  };
  canonicalize_dry_run?:
    | { ok?: boolean; error?: { code?: string; message?: string }; [k: string]: unknown }
    | null;
  canonicalize_status?: number;
  warnings?: string[];
  sources_used?: Array<{ id: string; filename: string | null }>;
  correlation_id?: string;
}

type PanelState = "idle" | "loading" | "done" | "error";

const fmt = (v: number | null | undefined): string =>
  v === null || v === undefined ? "—" : String(v);

export function CargoCanonicalPreviewPanel({
  caseId,
  onAdopted,
}: {
  caseId: string;
  /** Appelé après une adoption réussie (refresh UI côté parent). */
  onAdopted?: () => void;
}) {
  const [state, setState] = useState<PanelState>("idle");
  const [result, setResult] = useState<DeriveResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Adoption explicite opérateur (commit) — distincte de la prévisualisation.
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [adopting, setAdopting] = useState(false);

  async function handlePreview() {
    setState("loading");
    setErrorMsg(null);
    setResult(null);

    try {
      // SEUL appel autorisé en Phase 2-P. Aucun mode commit.
      const { data, error } = await supabase.functions.invoke<DeriveResult>(
        "derive-cargo-canonical-payload",
        { body: { case_id: caseId } },
      );

      if (error) {
        // invoke() lève sur status non-2xx : le corps utile est dans error.context.
        // La fonction derive renvoie ses champs (warnings, canonicalize_status…)
        // aussi sur ses réponses non-2xx → on tente de les afficher.
        const ctx = (error as { context?: unknown }).context;
        let body: DeriveResult | null = null;
        if (ctx && typeof (ctx as Response).json === "function") {
          try {
            body = (await (ctx as Response).json()) as DeriveResult;
          } catch {
            body = null;
          }
        }
        if (body) {
          setResult(body);
          setState("done");
          return;
        }
        setErrorMsg(error.message ?? "Erreur réseau lors de la prévisualisation");
        setState("error");
        return;
      }

      setResult(data ?? null);
      setState("done");
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : "Erreur inconnue");
      setState("error");
    }
  }

  /**
   * Adoption explicite opérateur (commit). Réutilise INTÉGRALEMENT le
   * derived_payload du dry-run réussi. SEUL appel autorisé :
   * `canonicalize-cargo-from-case` en mode "commit". Aucune autre écriture
   * (jamais write-cargo-canonical direct, run-pricing, set-case-fact,
   * quote_facts, quote_gaps, saveGapAnswer). En cas d'erreur : aucun fallback.
   */
  async function handleAdopt() {
    const derived = result?.derived_payload;
    if (!derived?.case_id || !derived.source || !derived.cargo_payload) {
      toast.error("Payload dérivé indisponible : relancez la prévisualisation.");
      return;
    }

    setAdopting(true);
    try {
      const { error } = await supabase.functions.invoke(
        "canonicalize-cargo-from-case",
        {
          body: {
            case_id: derived.case_id,
            mode: "commit",
            source: derived.source,
            cargo_payload: derived.cargo_payload,
          },
        },
      );

      if (error) {
        // Aucun fallback d'écriture : on remonte l'erreur du canonicalizer.
        let msg = error.message ?? "Échec de l'adoption du cargo canonique";
        const ctx = (error as { context?: unknown }).context;
        if (ctx && typeof (ctx as Response).json === "function") {
          try {
            const body = (await (ctx as Response).json()) as {
              error?: { message?: string };
            };
            if (body?.error?.message) msg = body.error.message;
          } catch {
            /* conserver le message par défaut */
          }
        }
        toast.error(msg);
        return;
      }

      toast.success("Cargo canonique adopté (cargo_lines / cargo_equipment).");
      setConfirmOpen(false);
      onAdopted?.();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error ? err.message : "Erreur inconnue lors de l'adoption",
      );
    } finally {
      setAdopting(false);
    }
  }

  const cargoLines = result?.derived_payload?.cargo_payload?.cargo_lines ?? [];
  const unallocated = result?.derived_payload?.cargo_payload?.unallocated_equipment ?? [];
  const warnings = result?.warnings ?? [];
  const sources = result?.sources_used ?? [];
  const canonStatus = result?.canonicalize_status;
  const canonDryRun = result?.canonicalize_dry_run ?? null;
  const dryRunError =
    canonDryRun && canonDryRun.ok === false ? canonDryRun.error ?? null : null;
  const topError = result && result.ok === false ? result.error ?? null : null;
  const canonOk = typeof canonStatus === "number" && canonStatus >= 200 && canonStatus < 300;
  // Adoption proposée UNIQUEMENT après un dry-run 2xx sans erreur, et seulement si
  // le derived_payload réutilisable (case_id + source + cargo_payload) est présent.
  const derivedPayload = result?.derived_payload ?? null;
  const canAdopt =
    canonOk &&
    !topError &&
    !dryRunError &&
    !!derivedPayload?.case_id &&
    !!derivedPayload?.source &&
    !!derivedPayload?.cargo_payload;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageSearch className="h-5 w-5 text-primary" />
          Cargo canonique — prévisualisation
        </CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" />
          Prévisualisation uniquement. Aucune donnée cargo canonique n’est écrite.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={handlePreview} disabled={state === "loading"} className="gap-2">
          {state === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
          Prévisualiser depuis les pièces jointes
        </Button>

        {state === "error" && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Prévisualisation impossible</AlertTitle>
            <AlertDescription>{errorMsg}</AlertDescription>
          </Alert>
        )}

        {state === "done" && result && (
          <div className="space-y-4">
            {/* Statut canonicalize + erreurs éventuelles */}
            <div className="flex flex-wrap items-center gap-2">
              {typeof canonStatus === "number" && (
                <Badge variant={canonOk ? "outline" : "destructive"}>
                  canonicalize_status : {canonStatus}
                </Badge>
              )}
            </div>

            {/* Adoption explicite opérateur — visible uniquement après dry-run 2xx. */}
            {canAdopt && (
              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <Button
                  variant="default"
                  className="gap-2"
                  disabled={adopting}
                  onClick={() => setConfirmOpen(true)}
                >
                  {adopting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <PackageCheck className="h-4 w-4" />
                  )}
                  Adopter le cargo canonique
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Adopter le cargo canonique ?</AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2 text-sm">
                        <p>
                          Cette action écrit <strong>uniquement</strong> le cargo
                          canonique.
                        </p>
                        <ul className="list-disc pl-5 space-y-0.5">
                          <li>Cible : <strong>cargo_lines</strong> / <strong>cargo_equipment</strong>.</li>
                          <li><strong>quote_facts</strong> ne sera pas modifié.</li>
                          <li><strong>quote_gaps</strong> ne sera pas résolu.</li>
                          <li>Le pricing n'est <strong>pas</strong> lancé automatiquement.</li>
                        </ul>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={adopting}>Annuler</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={adopting}
                      onClick={(e) => {
                        // Empêche la fermeture auto : on pilote l'état pendant l'appel.
                        e.preventDefault();
                        void handleAdopt();
                      }}
                    >
                      {adopting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : null}
                      Confirmer l'adoption
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            {topError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>{topError.code ?? "Erreur"}</AlertTitle>
                <AlertDescription>{topError.message ?? "—"}</AlertDescription>
              </Alert>
            )}

            {dryRunError && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>
                  Canonicalizer (dry_run) : {dryRunError.code ?? "rejet"}
                </AlertTitle>
                <AlertDescription>{dryRunError.message ?? "—"}</AlertDescription>
              </Alert>
            )}

            {/* Warnings */}
            {warnings.length > 0 && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Avertissements ({warnings.length})</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Sources utilisées */}
            <div>
              <p className="text-sm font-semibold mb-1">Sources utilisées ({sources.length})</p>
              {sources.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune source.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {sources.map((s) => (
                    <Badge key={s.id} variant="secondary">
                      {s.filename ?? s.id}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Cargo lines */}
            <div>
              <p className="text-sm font-semibold mb-1 flex items-center gap-1.5">
                <Boxes className="h-4 w-4" />
                Lignes cargo ({cargoLines.length})
              </p>
              {cargoLines.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucune ligne cargo dérivée.</p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Désignation</TableHead>
                        <TableHead>HS</TableHead>
                        <TableHead>Pièces</TableHead>
                        <TableHead>Valeur</TableHead>
                        <TableHead>Poids (kg)</TableHead>
                        <TableHead>Volume (cbm)</TableHead>
                        <TableHead>Statut</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cargoLines.map((l, i) => (
                        <TableRow key={l.line_index ?? i}>
                          <TableCell>{fmt(l.line_index)}</TableCell>
                          <TableCell>{l.description ?? "—"}</TableCell>
                          <TableCell>{l.hs_code ?? "—"}</TableCell>
                          <TableCell>{fmt(l.pieces_count)}</TableCell>
                          <TableCell>
                            {l.value_number === null || l.value_number === undefined
                              ? "—"
                              : `${l.value_number} ${l.value_currency ?? ""}`.trim()}
                          </TableCell>
                          <TableCell>{fmt(l.weight_kg)}</TableCell>
                          <TableCell>{fmt(l.volume_cbm)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{l.status ?? "—"}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {/* Équipements non alloués */}
            <div>
              <p className="text-sm font-semibold mb-1">
                Équipements non alloués ({unallocated.length})
              </p>
              {unallocated.length === 0 ? (
                <p className="text-sm text-muted-foreground">Aucun équipement non alloué.</p>
              ) : (
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Type</TableHead>
                        <TableHead>Quantité</TableHead>
                        <TableHead>Statut</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unallocated.map((e, i) => (
                        <TableRow key={i}>
                          <TableCell>{e.equipment_type ?? "—"}</TableCell>
                          <TableCell>{fmt(e.quantity)}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{e.status ?? "—"}</Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default CargoCanonicalPreviewPanel;
