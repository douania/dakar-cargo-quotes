import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { Search, AlertTriangle, Snowflake, ArrowRightLeft, CircleOff, CheckCircle2, CircleDot, HelpCircle } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────
type DesignationStatus =
  | "Vrac"
  | "Atypique"
  | "Renvoi tarifaire"
  | "Gap source"
  | "Résoluble complet"
  | "Résoluble partiel"
  | "Non résolu";

interface ResolvedAmounts {
  p1: number | null;
  p2: number | null;
  p3: number | null;
}

// ─── Status helpers ──────────────────────────────────────────────────
function computeStatus(
  row: any,
  resolved: ResolvedAmounts
): DesignationStatus {
  const isVrac =
    !row.storage_code_p1 && !row.storage_code_p2 && !row.storage_code_p3;

  const isAtypical =
    row.designation_label === "Cale frigo" ||
    row.unit_basis === "atypical";

  const isRedirect =
    /voir tarif/i.test(row.designation_label || "") ||
    /redirection|renvoi tarifaire|voir tarif/i.test(row.notes || "");

  const isSourceGap =
    row.storage_code_p2 === "520" || row.storage_code_p3 === "620";

  const resolvedCount = [resolved.p1, resolved.p2, resolved.p3].filter(
    (v) => v != null
  ).length;

  // Priority order as specified
  if (isVrac) return "Vrac";
  if (isAtypical) return "Atypique";
  if (isRedirect) return "Renvoi tarifaire";
  if (isSourceGap) return "Gap source";
  if (resolvedCount === 3) return "Résoluble complet";
  if (resolvedCount > 0) return "Résoluble partiel";
  return "Non résolu";
}

const statusConfig: Record<
  DesignationStatus,
  { color: string; icon: typeof CheckCircle2 }
> = {
  Vrac: { color: "bg-muted text-muted-foreground", icon: CircleOff },
  Atypique: { color: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200", icon: Snowflake },
  "Renvoi tarifaire": { color: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200", icon: ArrowRightLeft },
  "Gap source": { color: "bg-destructive/15 text-destructive", icon: AlertTriangle },
  "Résoluble complet": { color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200", icon: CheckCircle2 },
  "Résoluble partiel": { color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200", icon: CircleDot },
  "Non résolu": { color: "bg-destructive/15 text-destructive", icon: HelpCircle },
};

function StatusBadge({ status }: { status: DesignationStatus }) {
  const cfg = statusConfig[status];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={`gap-1 ${cfg.color} border-0`}>
      <Icon className="h-3 w-3" />
      {status}
    </Badge>
  );
}

// ─── Format helpers ──────────────────────────────────────────────────
const fmt = (v: number | null) =>
  v != null
    ? v.toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " FCFA"
    : "—";

function codeFamily(p1?: string | null, p2?: string | null, p3?: string | null) {
  const codes = [p1, p2, p3].filter(Boolean);
  if (codes.length === 0) return "—";
  return codes.join(" / ");
}

// ─── Main component ─────────────────────────────────────────────────
export default function TerminalStorage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Fetch designations
  const { data: designations, isLoading: loadingDes } = useQuery({
    queryKey: ["terminal-designations-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terminal_designations")
        .select("*")
        .eq("terminal_provider", "dakar_terminal")
        .order("tariff_position");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch tariff codes
  const { data: tariffCodes, isLoading: loadingTc } = useQuery({
    queryKey: ["terminal-tariff-codes-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terminal_tariff_codes")
        .select("*")
        .eq("terminal_provider", "dakar_terminal")
        .eq("tariff_type", "storage");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Build lookup map: "${code}_${period}" → amount
  const rateMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!tariffCodes) return m;
    for (const tc of tariffCodes) {
      m.set(`${tc.code}_${tc.period}`, tc.amount);
    }
    return m;
  }, [tariffCodes]);

  // Enrich rows
  const enrichedRows = useMemo(() => {
    if (!designations) return [];
    return designations.map((d) => {
      const resolved: ResolvedAmounts = {
        p1: d.storage_code_p1 ? rateMap.get(`${d.storage_code_p1}_P1`) ?? null : null,
        p2: d.storage_code_p2 ? rateMap.get(`${d.storage_code_p2}_P2`) ?? null : null,
        p3: d.storage_code_p3 ? rateMap.get(`${d.storage_code_p3}_P3`) ?? null : null,
      };
      const status = computeStatus(d, resolved);
      return { ...d, resolved, status };
    });
  }, [designations, rateMap]);

  // Filter
  const filtered = useMemo(() => {
    return enrichedRows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          (r.designation_label || "").toLowerCase().includes(q) ||
          (r.tariff_position?.toString() || "").includes(q) ||
          (r.storage_code_p1 || "").includes(q) ||
          (r.storage_code_p2 || "").includes(q) ||
          (r.storage_code_p3 || "").includes(q)
        );
      }
      return true;
    });
  }, [enrichedRows, search, statusFilter]);

  // KPI counters
  const kpis = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of enrichedRows) {
      counts[r.status] = (counts[r.status] || 0) + 1;
    }
    return {
      total: enrichedRows.length,
      ...counts,
    };
  }, [enrichedRows]);

  const isLoading = loadingDes || loadingTc;

  const allStatuses: DesignationStatus[] = [
    "Vrac",
    "Atypique",
    "Renvoi tarifaire",
    "Gap source",
    "Résoluble complet",
    "Résoluble partiel",
    "Non résolu",
  ];

  return (
    <MainLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Magasinage Dakar Terminal
          </h1>
          <p className="text-sm text-muted-foreground">
            Référentiel lecture seule — désignations ↔ codes tarifaires storage
          </p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Card className="col-span-1">
            <CardContent className="p-3 text-center">
              <p className="text-2xl font-bold text-foreground">{kpis.total}</p>
              <p className="text-xs text-muted-foreground">Total</p>
            </CardContent>
          </Card>
          {allStatuses.map((s) => {
            const cfg = statusConfig[s];
            const Icon = cfg.icon;
            return (
              <Card
                key={s}
                className="col-span-1 cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all"
                onClick={() => setStatusFilter(statusFilter === s ? "all" : s)}
              >
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">
                    {kpis[s] || 0}
                  </p>
                  <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                    <Icon className="h-3 w-3" />
                    {s}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher désignation, position, code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[220px]">
                <SelectValue placeholder="Filtrer par statut" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous les statuts</SelectItem>
                {allStatuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s} ({kpis[s] || 0})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {filtered.length} désignation{filtered.length > 1 ? "s" : ""}
              {statusFilter !== "all" && (
                <Badge variant="secondary" className="ml-2">
                  {statusFilter}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">
                Chargement du référentiel…
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">Désignation</TableHead>
                      <TableHead className="text-center">Position</TableHead>
                      <TableHead className="text-center">Codes P1/P2/P3</TableHead>
                      <TableHead className="text-right">Montant P1</TableHead>
                      <TableHead className="text-right">Montant P2</TableHead>
                      <TableHead className="text-right">Montant P3</TableHead>
                      <TableHead className="text-center">Unité</TableHead>
                      <TableHead className="text-center">Preuve</TableHead>
                      <TableHead className="text-center">Statut</TableHead>
                      <TableHead className="min-w-[120px]">Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium text-sm max-w-[280px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate block">
                                {row.designation_label}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-sm">
                              {row.designation_label}
                            </TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-center text-sm tabular-nums">
                          {row.tariff_position ?? "—"}
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground tabular-nums">
                          {codeFamily(
                            row.storage_code_p1,
                            row.storage_code_p2,
                            row.storage_code_p3
                          )}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {fmt(row.resolved.p1)}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {fmt(row.resolved.p2)}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {fmt(row.resolved.p3)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className="text-xs">
                            {row.unit_basis || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              row.evidence_level === "official"
                                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0"
                                : row.evidence_level === "to_confirm"
                                ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-0"
                                : ""
                            }`}
                          >
                            {row.evidence_level || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          <StatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[160px]">
                          {row.notes ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="truncate block">
                                  {row.notes}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-sm">
                                {row.notes}
                              </TooltipContent>
                            </Tooltip>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filtered.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={10}
                          className="text-center py-8 text-muted-foreground"
                        >
                          Aucune désignation trouvée
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
