import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Plus, Check, Trash2, Search } from "lucide-react";
import { normalizeForMatch } from "@/lib/normalizeForMatch";

interface PadCategory {
  id: string;
  designation_raw: string;
  pad_category: string | null;
}

interface PadAlias {
  id: string;
  bl_term: string;
  normalized_term: string;
  commodity_category_id: string;
  pad_category: string | null;
  is_validated: boolean;
  validated_at: string | null;
  validated_by: string | null;
  source_type: string | null;
  created_at: string;
  commodity_categories?: {
    designation_raw: string;
    pad_category: string | null;
  };
}

interface PadAliasTabProps {
  categories: PadCategory[];
}

type StatusFilter = "all" | "pending" | "validated";

export default function PadAliasTab({ categories }: PadAliasTabProps) {
  const queryClient = useQueryClient();
  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [newBlTerm, setNewBlTerm] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");

  const normalizedPreview = newBlTerm ? normalizeForMatch(newBlTerm) : "";

  const { data: aliases = [], isLoading } = useQuery({
    queryKey: ["pad-aliases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pad_designation_aliases")
        .select("*, commodity_categories(designation_raw, pad_category)")
        .order("is_validated", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PadAlias[];
    },
  });

  const filtered = aliases.filter((a) => {
    if (statusFilter === "pending" && a.is_validated) return false;
    if (statusFilter === "validated" && !a.is_validated) return false;
    if (searchText) {
      const s = searchText.toLowerCase();
      const matchesText =
        a.bl_term.toLowerCase().includes(s) ||
        a.normalized_term.toLowerCase().includes(s) ||
        (a.commodity_categories?.designation_raw || "").toLowerCase().includes(s);
      if (!matchesText) return false;
    }
    return true;
  });

  const totalCount = aliases.length;
  const pendingCount = aliases.filter((a) => !a.is_validated).length;
  const validatedCount = aliases.filter((a) => a.is_validated).length;

  const validateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pad_designation_aliases")
        .update({
          is_validated: true,
          validated_at: new Date().toISOString(),
          validated_by: (await supabase.auth.getUser()).data.user?.id || null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pad-aliases"] });
      toast.success("Alias PAD validé");
    },
    onError: (e) => toast.error("Erreur: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("pad_designation_aliases")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pad-aliases"] });
      toast.success("Alias PAD supprimé");
    },
    onError: (e) => toast.error("Erreur: " + e.message),
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const normalized = normalizeForMatch(newBlTerm);
      if (!normalized || !newCategoryId) throw new Error("Champs requis manquants");

      // Anti-duplicate check
      const { data: existing } = await supabase
        .from("pad_designation_aliases")
        .select("id")
        .eq("normalized_term", normalized)
        .eq("commodity_category_id", newCategoryId)
        .limit(1);

      if (existing && existing.length > 0) {
        throw new Error("Un alias PAD identique existe déjà pour ce terme et cette catégorie");
      }

      const selectedCat = categories.find((c) => c.id === newCategoryId);
      const { error } = await supabase
        .from("pad_designation_aliases")
        .insert({
          bl_term: newBlTerm.trim(),
          normalized_term: normalized,
          commodity_category_id: newCategoryId,
          pad_category: selectedCat?.pad_category || null,
          is_validated: false,
          source_type: "manual",
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pad-aliases"] });
      toast.success("Alias PAD créé (en attente de validation)");
      setIsCreateOpen(false);
      setNewBlTerm("");
      setNewCategoryId("");
    },
    onError: (e) => toast.error(e.message),
  });

  const formatValidatedBy = (v: string | null) => {
    if (!v) return "Système";
    return v.substring(0, 8) + "…";
  };

  const padCategories = categories.filter((c) => c.pad_category);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <button
          onClick={() => setStatusFilter("all")}
          className={`bg-card rounded-lg p-4 border text-left transition-colors ${statusFilter === "all" ? "ring-2 ring-primary" : ""}`}
        >
          <p className="text-sm text-muted-foreground">Total alias</p>
          <p className="text-2xl font-bold">{totalCount}</p>
        </button>
        <button
          onClick={() => setStatusFilter("pending")}
          className={`bg-card rounded-lg p-4 border text-left transition-colors ${statusFilter === "pending" ? "ring-2 ring-primary" : ""}`}
        >
          <p className="text-sm text-muted-foreground">En attente</p>
          <p className="text-2xl font-bold text-amber-500">{pendingCount}</p>
        </button>
        <button
          onClick={() => setStatusFilter("validated")}
          className={`bg-card rounded-lg p-4 border text-left transition-colors ${statusFilter === "validated" ? "ring-2 ring-primary" : ""}`}
        >
          <p className="text-sm text-muted-foreground">Validés</p>
          <p className="text-2xl font-bold text-green-600">{validatedCount}</p>
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un alias PAD..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9"
          />
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-2 h-4 w-4" />Ajouter un alias PAD</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ajouter un alias PAD</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createMutation.mutate();
              }}
              className="space-y-4"
            >
              <div>
                <Label>Terme BL</Label>
                <Input
                  value={newBlTerm}
                  onChange={(e) => setNewBlTerm(e.target.value)}
                  placeholder="ex: ceramic tiles"
                  required
                />
              </div>
              <div>
                <Label>Terme normalisé</Label>
                <Input value={normalizedPreview} readOnly className="bg-muted" />
              </div>
              <div>
                <Label>Catégorie PAD cible</Label>
                <Select value={newCategoryId} onValueChange={setNewCategoryId} required>
                  <SelectTrigger><SelectValue placeholder="Sélectionner une catégorie..." /></SelectTrigger>
                  <SelectContent>
                    {padCategories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.pad_category} — {c.designation_raw}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsCreateOpen(false)}>Annuler</Button>
                <Button type="submit" disabled={!newBlTerm.trim() || !newCategoryId || createMutation.isPending}>
                  Créer
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Terme BL</TableHead>
              <TableHead>Normalisé</TableHead>
              <TableHead>Catégorie PAD</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead>Validé par</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8">Chargement...</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  Aucun alias PAD trouvé
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.bl_term}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{a.normalized_term}</TableCell>
                  <TableCell>
                    <div>
                      <Badge variant="outline">{a.pad_category || "—"}</Badge>
                      <span className="block text-xs text-muted-foreground mt-0.5">
                        {a.commodity_categories?.designation_raw || "—"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {a.source_type === "seed" ? "Seed" : a.source_type === "ai_suggestion_validated" ? "IA validée" : "Manuel"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {a.is_validated ? (
                      <Badge className="bg-green-600 text-white">Validé</Badge>
                    ) : (
                      <Badge className="bg-amber-500 text-white animate-pulse">En attente</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.is_validated ? formatValidatedBy(a.validated_by) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {!a.is_validated && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-green-600"
                          onClick={() => validateMutation.mutate(a.id)}
                          title="Valider"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                      )}
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-destructive" title="Supprimer">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Supprimer cet alias PAD ?</AlertDialogTitle>
                            <AlertDialogDescription>
                              L'alias « {a.bl_term} » → {a.pad_category} sera supprimé définitivement.
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
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
