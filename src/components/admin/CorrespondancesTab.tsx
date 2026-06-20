import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Check, Filter, Trash2 } from "lucide-react";
import { normalizeForMatch } from "@/lib/normalizeForMatch";

const SOURCE_TYPES = ["manual", "document_extraction", "operator_correction", "seeded_synonym"] as const;

interface DesignationMatch {
  id: string;
  observed_term: string;
  normalized_term: string | null;
  commodity_category_id: string | null;
  pad_category_candidate: string | null;
  match_score: number | null;
  match_reason: string | null;
  match_method: string | null;
  source_type: string | null;
  source_reference: string | null;
  is_validated: boolean;
  validated_at: string | null;
  notes_operator: string | null;
  created_at: string;
}

interface CorrespondancesTabProps {
  categories: { id: string; designation_raw: string; designation_normalized: string | null; pad_category: string | null }[];
}

const defaultMatchForm = {
  observed_term: "",
  normalized_term: "",
  commodity_category_id: "",
  pad_category_candidate: "",
  match_score: 0.8,
  match_reason: "",
  match_method: "manual_exact",
  source_type: "manual" as string,
  source_reference: "",
  notes_operator: "",
};

export default function CorrespondancesTab({ categories }: CorrespondancesTabProps) {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [filterValidated, setFilterValidated] = useState("all");
  const [filterSourceType, setFilterSourceType] = useState("all");
  const [form, setForm] = useState(defaultMatchForm);

  const { data: matches, isLoading } = useQuery({
    queryKey: ["commodity-designation-matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("commodity_designation_matches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as DesignationMatch[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const normalized = normalizeForMatch(form.observed_term);
      const catId = form.commodity_category_id || null;
      const padCand = form.pad_category_candidate || null;

      // Upsert logic: check existing
      let existingId: string | null = null;
      if (catId) {
        const { data } = await supabase
          .from("commodity_designation_matches")
          .select("id")
          .eq("normalized_term", normalized)
          .eq("commodity_category_id", catId)
          .maybeSingle();
        existingId = data?.id || null;
      } else if (padCand) {
        const { data } = await supabase
          .from("commodity_designation_matches")
          .select("id")
          .eq("normalized_term", normalized)
          .eq("pad_category_candidate", padCand)
          .is("commodity_category_id", null)
          .maybeSingle();
        existingId = data?.id || null;
      }

      const payload = {
        observed_term: form.observed_term.trim(),
        normalized_term: normalized,
        commodity_category_id: catId,
        pad_category_candidate: padCand,
        match_score: form.match_score,
        match_reason: form.match_reason || null,
        match_method: form.match_method || null,
        source_type: form.source_type,
        source_reference: form.source_reference || null,
        notes_operator: form.notes_operator || null,
        is_validated: false,
      };

      if (existingId) {
        const { error } = await supabase
          .from("commodity_designation_matches")
          .update(payload)
          .eq("id", existingId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("commodity_designation_matches")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commodity-designation-matches"] });
      toast.success("Correspondance enregistrée");
      setIsDialogOpen(false);
      setForm(defaultMatchForm);
    },
    onError: (e) => toast.error("Erreur: " + e.message),
  });

  const validateMutation = useMutation({
    mutationFn: async (row: { id: string; commodity_category_id: string | null; source_reference: string | null }) => {
      if (!row.commodity_category_id) {
        throw new Error("Sélectionner une catégorie officielle avant de valider.");
      }
      const messages: Record<string, string> = {
        PAD_ADMIN_REQUIRED: "Rôle PAD admin requis pour valider cette correspondance.",
        PAD_ALIAS_COLLISION: "Collision PAD : ce terme est déjà lié à une autre catégorie.",
        CDM_NORMALIZED_TERM_REQUIRED: "Terme normalisé manquant.",
        TARGET_CATEGORY_NOT_FOUND: "Catégorie cible introuvable.",
        TARGET_PAD_CATEGORY_REQUIRED: "La catégorie cible n'a pas de catégorie PAD.",
      };
      const toMsg = (code?: string) => code ? (messages[code] ?? "Validation impossible.") : "Validation impossible.";

      const { data, error } = await supabase.functions.invoke("validate-pad-alias-enrichment", {
        body: {
          cdm_id: row.id,
          commodity_category_id: row.commodity_category_id,
          source_reference: row.source_reference ?? null,
        },
      });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        let code: string | undefined;
        if (ctx) {
          try {
            const body = await ctx.json();
            code = (body as { error?: string })?.error;
          } catch {
            // not JSON — ignore
          }
        }
        throw new Error(toMsg(code));
      }
      const payload = data as { ok: boolean; status?: string; error?: string } | null;
      if (!payload?.ok) {
        throw new Error(toMsg(payload?.error));
      }
      return payload;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["commodity-designation-matches"] });
      queryClient.invalidateQueries({ queryKey: ["pad-aliases"] });
      const status = data?.status;
      if (status === "created") {
        toast.success("Correspondance validée et alias PAD créé");
      } else if (status === "validated_existing") {
        toast.success("Correspondance validée avec alias PAD existant");
      } else if (status === "already_exists") {
        toast.success("Alias PAD déjà existant");
      } else {
        toast.success("Correspondance validée");
      }
    },
    onError: (e) => toast.error("Erreur: " + (e as Error).message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("commodity_designation_matches")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["commodity-designation-matches"] });
      toast.success("Supprimée");
    },
  });

  const filtered = matches?.filter((m) => {
    if (filterValidated === "validated" && !m.is_validated) return false;
    if (filterValidated === "pending" && m.is_validated) return false;
    if (filterSourceType !== "all" && m.source_type !== filterSourceType) return false;
    return true;
  });

  const getCategoryLabel = (catId: string | null) => {
    if (!catId) return null;
    const cat = categories.find((c) => c.id === catId);
    return cat ? (cat.pad_category ? `${cat.pad_category} — ${cat.designation_normalized || cat.designation_raw}` : cat.designation_normalized || cat.designation_raw) : catId.slice(0, 8);
  };

  return (
    <div className="space-y-4">
      {/* Filters + Add */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterValidated} onValueChange={setFilterValidated}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes</SelectItem>
              <SelectItem value="validated">Validées</SelectItem>
              <SelectItem value="pending">En attente</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Select value={filterSourceType} onValueChange={setFilterSourceType}>
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes sources</SelectItem>
            {SOURCE_TYPES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setIsDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Ajouter
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border rounded-md p-3">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-xl font-bold">{matches?.length || 0}</p>
        </div>
        <div className="bg-card border rounded-md p-3">
          <p className="text-xs text-muted-foreground">Validées</p>
          <p className="text-xl font-bold text-green-600">{matches?.filter((m) => m.is_validated).length || 0}</p>
        </div>
        <div className="bg-card border rounded-md p-3">
          <p className="text-xs text-muted-foreground">En attente</p>
          <p className="text-xl font-bold text-amber-500">{matches?.filter((m) => !m.is_validated).length || 0}</p>
        </div>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Terme observé</TableHead>
              <TableHead>Catégorie</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Méthode</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">Chargement...</TableCell>
              </TableRow>
            ) : !filtered?.length ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Aucune correspondance</TableCell>
              </TableRow>
            ) : (
              filtered.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div>
                      <span className="font-medium text-sm">{m.observed_term}</span>
                      {m.normalized_term && m.normalized_term !== m.observed_term && (
                        <span className="block text-xs text-muted-foreground">{m.normalized_term}</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {m.commodity_category_id ? (
                      <span className="text-sm">{getCategoryLabel(m.commodity_category_id)}</span>
                    ) : m.pad_category_candidate ? (
                      <Badge variant="outline" className="text-xs">{m.pad_category_candidate}</Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-mono">
                      {m.match_score != null ? `${Math.round(m.match_score * 100)}%` : "—"}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">{m.match_method || m.source_type || "—"}</span>
                  </TableCell>
                  <TableCell>
                    {m.is_validated ? (
                      <Badge className="bg-green-600 text-white text-xs">Validé</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">En attente</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {!m.is_validated && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => validateMutation.mutate({ id: m.id, commodity_category_id: m.commodity_category_id, source_reference: m.source_reference })}
                          disabled={validateMutation.isPending || !m.commodity_category_id}
                          title={!m.commodity_category_id ? "Sélectionner une catégorie officielle avant de valider" : undefined}
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => {
                          if (confirm("Supprimer cette correspondance ?"))
                            deleteMutation.mutate(m.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Add dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajouter un synonyme</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveMutation.mutate();
            }}
            className="space-y-3"
          >
            <div>
              <label className="text-xs font-medium">Terme observé *</label>
              <Input
                value={form.observed_term}
                onChange={(e) => setForm({ ...form, observed_term: e.target.value })}
                required
                placeholder="lavabos, wash basin..."
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Catégorie officielle</label>
              <Select
                value={form.commodity_category_id}
                onValueChange={(v) => setForm({ ...form, commodity_category_id: v })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Optionnel..." />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.pad_category ? `${c.pad_category} — ` : ""}
                      {c.designation_normalized || c.designation_raw}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium">Catégorie PAD candidate (si pas de FK)</label>
              <Input
                value={form.pad_category_candidate}
                onChange={(e) => setForm({ ...form, pad_category_candidate: e.target.value })}
                placeholder="T02, T07..."
                className="h-8 text-sm"
                disabled={!!form.commodity_category_id}
              />
            </div>
            <div>
              <label className="text-xs font-medium">Raison</label>
              <Input
                value={form.match_reason}
                onChange={(e) => setForm({ ...form, match_reason: e.target.value })}
                placeholder="Terme similaire à..."
                className="h-8 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Référence source</label>
              <Input
                value={form.source_reference}
                onChange={(e) => setForm({ ...form, source_reference: e.target.value })}
                placeholder="BL, facture..."
                className="h-8 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsDialogOpen(false)}
              >
                Annuler
              </Button>
              <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                Enregistrer
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
