/**
 * MULTI-CARGO-LINES-ARCHITECTURE-1 — Phase 2-P
 * CargoCanonicalPreviewPanel — aperçu opérateur READ-ONLY (dry-run).
 *
 * Déclenche, sur action explicite uniquement, la dérivation cargo canonique
 * depuis les pièces jointes via l'Edge Function `derive-cargo-canonical-payload`
 * (qui appelle elle-même le canonicalizer en dry_run).
 *
 * Garde-fous (Phase 2-P) :
 *   - Appelle UNIQUEMENT `derive-cargo-canonical-payload`.
 *   - N'appelle jamais `write-cargo-canonical` ni `canonicalize-cargo-from-case`.
 *   - Aucun mode commit, aucune écriture DB, aucun déclenchement au montage.
 *   - Prévisualisation seule : rien n'est persisté.
 */

import { useState } from "react";
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
  AlertTriangle,
  Boxes,
  Eye,
  Info,
  Loader2,
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

interface DeriveResult {
  ok?: boolean;
  case_id?: string;
  error?: { code?: string; message?: string };
  derived_payload?: {
    cargo_payload?: {
      cargo_lines?: CargoLineRow[];
      unallocated_equipment?: EquipmentRow[];
    };
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

export function CargoCanonicalPreviewPanel({ caseId }: { caseId: string }) {
  const [state, setState] = useState<PanelState>("idle");
  const [result, setResult] = useState<DeriveResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
