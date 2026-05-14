/**
 * MAP-5A — Panneau UI lecture seule "Candidats de classification".
 *
 * FRONTEND-ONLY. Strictement aucune écriture DB.
 * - Appelle l'Edge Function MAP-4 `get-commodity-classification-candidates` (read-only).
 * - Aucun INSERT/UPDATE/DELETE, aucun set-case-fact, aucun run-pricing.
 * - Aucune écriture quote_facts / case_facts / cargo.*.
 * - Aucune action accepter/rejeter/superseder (réservé MAP-5B).
 * - Aucun moteur de suggestion automatique.
 * - Aucun import depuis @/integrations/supabase/types (types locaux uniquement).
 * - Aucune dépendance sur padNstConstants.
 */

import { useCallback, useEffect, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
  ChevronDown,
  Info,
  ListChecks,
  Loader2,
  RefreshCw,
} from "lucide-react";

/* ---------- Types locaux (pas d'import depuis types.ts) ---------- */

type CandidateKind =
  | "cn8"
  | "hs6"
  | "hs10_uemoa"
  | "nhm"
  | "nst2007"
  | "nstr"
  | "pad_label"
  | "pad_category";

type CandidateStatus = "suggested" | "accepted" | "rejected" | "superseded";

type CommodityClassificationCandidate = {
  id: string;
  case_id: string;
  article_id: string | null;
  candidate_kind: string;
  candidate_value: string | null;
  designation_normalized: string | null;
  pad_category: string | null;
  confidence: number | null;
  status: string;
  source: string;
  is_current: boolean;
  rank: number | null;
  created_at: string;
  // Champs additionnels tolérés sans typage strict.
  [k: string]: unknown;
};

type GetCandidatesResponse = {
  case_id: string;
  count: number;
  candidates: CommodityClassificationCandidate[];
};

type FetchState = "idle" | "loading" | "success" | "empty" | "error";

interface Props {
  caseId: string;
}

const CANDIDATE_KIND_OPTIONS: Array<{ value: CandidateKind; label: string }> = [
  { value: "cn8", label: "CN8" },
  { value: "hs6", label: "HS6" },
  { value: "hs10_uemoa", label: "HS10 UEMOA" },
  { value: "nhm", label: "NHM" },
  { value: "nst2007", label: "NST 2007" },
  { value: "nstr", label: "NSTR" },
  { value: "pad_label", label: "PAD label" },
  { value: "pad_category", label: "PAD category" },
];

const STATUS_OPTIONS: Array<{ value: CandidateStatus; label: string }> = [
  { value: "suggested", label: "Suggéré" },
  { value: "accepted", label: "Accepté" },
  { value: "rejected", label: "Rejeté" },
  { value: "superseded", label: "Superseded" },
];

const ALL = "__all__";

function confidenceTierClass(c: number | null): string {
  if (c == null) return "bg-muted text-muted-foreground border-border";
  if (c >= 0.8) return "bg-green-100 text-green-800 border-green-300 dark:bg-green-950/40 dark:text-green-300";
  if (c >= 0.5) return "bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950/40 dark:text-yellow-300";
  return "bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300";
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default function CommodityClassificationCandidatesPanel({ caseId }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<FetchState>("idle");
  const [candidates, setCandidates] = useState<CommodityClassificationCandidate[]>([]);
  const [count, setCount] = useState<number>(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filtres locaux (n'écrivent rien)
  const [kindFilter, setKindFilter] = useState<string>(ALL);
  const [statusFilter, setStatusFilter] = useState<string>(ALL);
  const [isCurrent, setIsCurrent] = useState<boolean>(true);

  const fetchCandidates = useCallback(async () => {
    setState("loading");
    setErrorMsg(null);
    try {
      const body: Record<string, unknown> = {
        case_id: caseId,
        limit: 100,
        offset: 0,
        filters: { is_current: isCurrent } as Record<string, unknown>,
      };
      if (kindFilter !== ALL) {
        (body.filters as Record<string, unknown>).candidate_kind = kindFilter;
      }
      if (statusFilter !== ALL) {
        (body.filters as Record<string, unknown>).status = statusFilter;
      }

      const { data, error } = await supabase.functions.invoke<GetCandidatesResponse>(
        "get-commodity-classification-candidates",
        { body },
      );
      if (error) throw error;
      const list = (data?.candidates ?? []) as CommodityClassificationCandidate[];
      setCandidates(list);
      setCount(data?.count ?? list.length);
      setState(list.length === 0 ? "empty" : "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Erreur inconnue";
      setErrorMsg(msg);
      setCandidates([]);
      setCount(0);
      setState("error");
    }
  }, [caseId, kindFilter, statusFilter, isCurrent]);

  // Premier fetch à l'ouverture, refetch quand les filtres changent (uniquement si déjà ouvert).
  useEffect(() => {
    if (!open) return;
    fetchCandidates();
  }, [open, fetchCandidates]);

  return (
    <Card className="mb-6">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <ListChecks className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm">Candidats de classification (lecture seule)</CardTitle>
              <Badge variant="outline" className="text-[10px]">READ_ONLY</Badge>
              <Badge variant="outline" className="text-[10px]">MAP-5A</Badge>
              {state === "success" || state === "empty" ? (
                <Badge variant="secondary" className="text-[10px]">{count} candidat(s)</Badge>
              ) : null}
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
                <span className="ml-1">{open ? "Fermer" : "Ouvrir"}</span>
              </Button>
            </CollapsibleTrigger>
          </div>
          <CardDescription className="text-xs">
            Lecture seule des candidats stockés en base pour ce dossier. Aucune action de validation ni écriture.
          </CardDescription>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4">
            {/* Filtres */}
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Type</Label>
                <Select value={kindFilter} onValueChange={setKindFilter}>
                  <SelectTrigger className="h-8 w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Tous</SelectItem>
                    {CANDIDATE_KIND_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Statut</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-8 w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>Tous</SelectItem>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2 pb-1">
                <Switch id="ccc-is-current" checked={isCurrent} onCheckedChange={setIsCurrent} />
                <Label htmlFor="ccc-is-current" className="text-xs">is_current uniquement</Label>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={fetchCandidates}
                disabled={state === "loading"}
                className="ml-auto"
              >
                {state === "loading" ? (
                  <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-3 w-3" />
                )}
                Rafraîchir
              </Button>
            </div>

            {/* États */}
            {state === "loading" && (
              <div className="space-y-2">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-3/4" />
              </div>
            )}

            {state === "error" && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Impossible de récupérer les candidats</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p className="text-xs">{errorMsg}</p>
                  <Button size="sm" variant="outline" onClick={fetchCandidates}>
                    Réessayer
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {state === "empty" && (
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription className="text-xs">
                  Aucun candidat pour ce dossier avec les filtres actuels.
                </AlertDescription>
              </Alert>
            )}

            {state === "success" && (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Type</TableHead>
                      <TableHead className="text-xs">Valeur</TableHead>
                      <TableHead className="text-xs">Désignation</TableHead>
                      <TableHead className="text-xs">PAD</TableHead>
                      <TableHead className="text-xs">Confiance</TableHead>
                      <TableHead className="text-xs">Statut</TableHead>
                      <TableHead className="text-xs">Source</TableHead>
                      <TableHead className="text-xs">Rang</TableHead>
                      <TableHead className="text-xs">Créé</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {candidates.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <Badge variant="outline" className="font-mono text-[10px]">{c.candidate_kind}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{c.candidate_value ?? "—"}</TableCell>
                        <TableCell className="text-xs max-w-[280px] truncate" title={c.designation_normalized ?? ""}>
                          {c.designation_normalized || "—"}
                        </TableCell>
                        <TableCell>
                          {c.pad_category ? (
                            <Badge variant="outline" className="font-mono text-[10px]">{c.pad_category}</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`text-[10px] ${confidenceTierClass(c.confidence)}`}>
                            {c.confidence != null ? `${(c.confidence * 100).toFixed(0)}%` : "—"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px]">{c.status}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">{c.source}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">{c.rank ?? "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{formatDate(c.created_at)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
