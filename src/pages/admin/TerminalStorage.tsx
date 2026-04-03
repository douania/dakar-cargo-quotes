import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MainLayout } from "@/components/layout/MainLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Search, AlertTriangle, Snowflake, ArrowRightLeft, CircleOff, CheckCircle2,
  CircleDot, HelpCircle, Plus, ShieldCheck, Trash2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { normalizeForMatch } from "@/lib/normalizeForMatch";

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
    row.designation_label === "Cale frigo" || row.unit_basis === "atypical";
  const isRedirect =
    /voir tarif/i.test(row.designation_label || "") ||
    /redirection|renvoi tarifaire|voir tarif/i.test(row.notes || "");
  const isSourceGap =
    row.storage_code_p2 === "520" || row.storage_code_p3 === "620";
  const resolvedCount = [resolved.p1, resolved.p2, resolved.p3].filter(
    (v) => v != null
  ).length;

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

const allStatuses: DesignationStatus[] = [
  "Vrac", "Atypique", "Renvoi tarifaire", "Gap source",
  "Résoluble complet", "Résoluble partiel", "Non résolu",
];

// ─── Source type badge colors ────────────────────────────────────────
const sourceTypeColors: Record<string, string> = {
  seeded_synonym: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-0",
  manual: "bg-muted text-muted-foreground border-0",
  operator_correction: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 border-0",
  ai_suggestion_validated: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 border-0",
};

// ═══════════════════════════════════════════════════════════════════════
// Designations Tab (existing content, extracted)
// ═══════════════════════════════════════════════════════════════════════
function DesignationsTab() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

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

  const rateMap = useMemo(() => {
    const m = new Map<string, number>();
    if (!tariffCodes) return m;
    for (const tc of tariffCodes) {
      m.set(`${tc.code}_${tc.period}`, tc.amount_per_unit);
    }
    return m;
  }, [tariffCodes]);

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

  const kpis = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of enrichedRows) {
      counts[r.status] = (counts[r.status] || 0) + 1;
    }
    return { total: enrichedRows.length, ...counts };
  }, [enrichedRows]);

  const isLoading = loadingDes || loadingTc;

  return (
    <div className="space-y-6">
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
                <p className="text-2xl font-bold text-foreground">{kpis[s] || 0}</p>
                <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
                  <Icon className="h-3 w-3" /> {s}
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
                <SelectItem key={s} value={s}>{s} ({kpis[s] || 0})</SelectItem>
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
            {statusFilter !== "all" && <Badge variant="secondary" className="ml-2">{statusFilter}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Chargement du référentiel…</div>
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
                            <span className="truncate block">{row.designation_label}</span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-sm">{row.designation_label}</TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-center text-sm tabular-nums">{row.tariff_position ?? "—"}</TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground tabular-nums">
                        {codeFamily(row.storage_code_p1, row.storage_code_p2, row.storage_code_p3)}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmt(row.resolved.p1)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmt(row.resolved.p2)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmt(row.resolved.p3)}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className="text-xs">{row.unit_basis || "—"}</Badge>
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
                      <TableCell className="text-center"><StatusBadge status={row.status} /></TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[160px]">
                        {row.notes ? (
                          <Tooltip>
                            <TooltipTrigger asChild><span className="truncate block">{row.notes}</span></TooltipTrigger>
                            <TooltipContent side="left" className="max-w-sm">{row.notes}</TooltipContent>
                          </Tooltip>
                        ) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
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
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Alias Tab (new)
// ═══════════════════════════════════════════════════════════════════════
function AliasTab() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [newBlTerm, setNewBlTerm] = useState("");
  const [newDesignationId, setNewDesignationId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  // Fetch aliases with joined designation label
  const { data: aliases, isLoading } = useQuery({
    queryKey: ["terminal-aliases-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terminal_designation_aliases")
        .select("*, terminal_designations(designation_label)")
        .order("is_validated", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Fetch designations for the selector
  const { data: designations } = useQuery({
    queryKey: ["terminal-designations-admin"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("terminal_designations")
        .select("id, designation_label")
        .eq("terminal_provider", "dakar_terminal")
        .order("designation_label");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Validate mutation
  const validateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("terminal_designation_aliases")
        .update({ is_validated: true, validated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["terminal-aliases-admin"] });
      toast({ title: "Alias validé" });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("terminal_designation_aliases")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["terminal-aliases-admin"] });
      toast({ title: "Alias supprimé" });
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async ({ bl_term, terminal_designation_id }: { bl_term: string; terminal_designation_id: string }) => {
      const normalized = normalizeForMatch(bl_term);
      const { error } = await supabase
        .from("terminal_designation_aliases")
        .insert({
          bl_term,
          normalized_term: normalized,
          terminal_designation_id,
          source_type: "manual",
          is_validated: false,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["terminal-aliases-admin"] });
      setNewBlTerm("");
      setNewDesignationId("");
      setDialogOpen(false);
      toast({ title: "Alias créé (en attente de validation)" });
    },
    onError: (err: any) => {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    },
  });

  const computedNormalized = newBlTerm.trim() ? normalizeForMatch(newBlTerm) : "";

  // Filter + sort (pending first, then validated, then created_at desc — already from query)
  const filtered = useMemo(() => {
    if (!aliases) return [];
    return aliases.filter((a: any) => {
      if (statusFilter === "validated" && !a.is_validated) return false;
      if (statusFilter === "pending" && a.is_validated) return false;
      if (search) {
        const q = search.toLowerCase();
        const desLabel = (a.terminal_designations as any)?.designation_label || "";
        return (
          (a.bl_term || "").toLowerCase().includes(q) ||
          (a.normalized_term || "").toLowerCase().includes(q) ||
          desLabel.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [aliases, search, statusFilter]);

  // KPIs
  const kpis = useMemo(() => {
    if (!aliases) return { total: 0, validated: 0, pending: 0 };
    const validated = aliases.filter((a: any) => a.is_validated).length;
    return { total: aliases.length, validated, pending: aliases.length - validated };
  }, [aliases]);

  const formatValidatedBy = (validatedBy: string | null) => {
    if (!validatedBy) return "Système";
    return `Utilisateur (${validatedBy.slice(0, 8)}…)`;
  };

  return (
    <div className="space-y-6">
      {/* KPI */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{kpis.total}</p>
            <p className="text-xs text-muted-foreground">Total alias</p>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all"
          onClick={() => setStatusFilter(statusFilter === "pending" ? "all" : "pending")}
        >
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{kpis.pending}</p>
            <p className="text-xs text-muted-foreground">En attente</p>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:ring-1 hover:ring-primary/30 transition-all"
          onClick={() => setStatusFilter(statusFilter === "validated" ? "all" : "validated")}
        >
          <CardContent className="p-3 text-center">
            <p className="text-2xl font-bold text-foreground">{kpis.validated}</p>
            <p className="text-xs text-muted-foreground">Validés</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters + Add */}
      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher alias, désignation…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Statut" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous ({kpis.total})</SelectItem>
              <SelectItem value="pending">En attente ({kpis.pending})</SelectItem>
              <SelectItem value="validated">Validés ({kpis.validated})</SelectItem>
            </SelectContent>
          </Select>

          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1">
                <Plus className="h-4 w-4" /> Ajouter un alias
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouvel alias BL → désignation terminale</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Terme BL (tel qu'il apparaît sur le connaissement)</Label>
                  <Input
                    value={newBlTerm}
                    onChange={(e) => setNewBlTerm(e.target.value)}
                    placeholder="ex: ceramic tiles"
                  />
                </div>
                <div>
                  <Label>Terme normalisé (calculé automatiquement)</Label>
                  <Input
                    value={computedNormalized}
                    readOnly
                    disabled
                    className="bg-muted"
                  />
                </div>
                <div>
                  <Label>Désignation terminale cible</Label>
                  <Select value={newDesignationId} onValueChange={setNewDesignationId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choisir une désignation…" />
                    </SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      {(designations || []).map((d: any) => (
                        <SelectItem key={d.id} value={d.id}>
                          {d.designation_label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <p className="text-xs text-muted-foreground">
                  L'alias sera créé en attente de validation. Le moteur ne le consommera qu'après validation explicite.
                </p>
              </div>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="outline">Annuler</Button>
                </DialogClose>
                <Button
                  onClick={() => {
                    if (!newBlTerm.trim() || !newDesignationId) return;
                    createMutation.mutate({
                      bl_term: newBlTerm.trim(),
                      terminal_designation_id: newDesignationId,
                    });
                  }}
                  disabled={!newBlTerm.trim() || !newDesignationId || createMutation.isPending}
                >
                  Créer
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            {filtered.length} alias
            {statusFilter !== "all" && <Badge variant="secondary" className="ml-2">{statusFilter === "pending" ? "En attente" : "Validés"}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Chargement des alias…</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Terme BL</TableHead>
                    <TableHead>Normalisé</TableHead>
                    <TableHead>Désignation cible</TableHead>
                    <TableHead className="text-center">Source</TableHead>
                    <TableHead className="text-center">Statut</TableHead>
                    <TableHead className="text-center">Validé par</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((a: any) => {
                    const desLabel = (a.terminal_designations as any)?.designation_label || "—";
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium text-sm">{a.bl_term}</TableCell>
                        <TableCell className="text-xs text-muted-foreground font-mono">{a.normalized_term}</TableCell>
                        <TableCell className="text-sm max-w-[220px]">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="truncate block">{desLabel}</span>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-sm">{desLabel}</TooltipContent>
                          </Tooltip>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={`text-xs ${sourceTypeColors[a.source_type] || ""}`}>
                            {a.source_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-center">
                          {a.is_validated ? (
                            <Badge variant="outline" className="text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-0 gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Validé
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-0">
                              En attente
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center text-xs text-muted-foreground">
                          {formatValidatedBy(a.validated_by)}
                        </TableCell>
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            {!a.is_validated && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 gap-1 text-xs"
                                onClick={() => validateMutation.mutate(a.id)}
                                disabled={validateMutation.isPending}
                              >
                                <ShieldCheck className="h-3 w-3" /> Valider
                              </Button>
                            )}
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive">
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Supprimer l'alias ?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    L'alias « {a.bl_term} » → « {desLabel} » sera supprimé définitivement.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteMutation.mutate(a.id)}>
                                    Supprimer
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        Aucun alias trouvé
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
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main component
// ═══════════════════════════════════════════════════════════════════════
export default function TerminalStorage() {
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

        <Tabs defaultValue="designations">
          <TabsList>
            <TabsTrigger value="designations">Désignations</TabsTrigger>
            <TabsTrigger value="aliases">Alias BL</TabsTrigger>
          </TabsList>
          <TabsContent value="designations">
            <DesignationsTab />
          </TabsContent>
          <TabsContent value="aliases">
            <AliasTab />
          </TabsContent>
        </Tabs>
      </div>
    </MainLayout>
  );
}
