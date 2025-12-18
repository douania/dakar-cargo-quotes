import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Search, FileText, Plus, Save, X } from "lucide-react";
import { Link } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

interface CustomsRegime {
  id: string;
  code: string;
  name: string | null;
  dd: boolean;
  stx: boolean;
  rs: boolean;
  tin: boolean;
  tva: boolean;
  cosec: boolean;
  pcs: boolean;
  pcc: boolean;
  tpast: boolean;
  ta: boolean;
  fixed_amount: number;
  is_active: boolean;
}

const TAX_COLUMNS = ['dd', 'stx', 'rs', 'tin', 'tva', 'cosec', 'pcs', 'pcc', 'tpast', 'ta'] as const;

const TAX_LABELS: Record<string, string> = {
  dd: 'DD',
  stx: 'STX',
  rs: 'RS',
  tin: 'TIN',
  tva: 'TVA',
  cosec: 'COSEC',
  pcs: 'PCS',
  pcc: 'PCC',
  tpast: 'TPAST',
  ta: 'TA'
};

export default function CustomsRegimesAdmin() {
  const [search, setSearch] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editedRegime, setEditedRegime] = useState<Partial<CustomsRegime> | null>(null);
  const queryClient = useQueryClient();

  const { data: regimes, isLoading } = useQuery({
    queryKey: ["customs-regimes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customs_regimes")
        .select("*")
        .order("code");
      if (error) throw error;
      return data as CustomsRegime[];
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (regime: Partial<CustomsRegime> & { id: string }) => {
      const { error } = await supabase
        .from("customs_regimes")
        .update(regime)
        .eq("id", regime.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customs-regimes"] });
      toast({ title: "Régime mis à jour" });
      setEditingId(null);
      setEditedRegime(null);
    },
    onError: (error) => {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (regime: Partial<CustomsRegime> & { code: string }) => {
      const { error } = await supabase.from("customs_regimes").insert([regime]);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["customs-regimes"] });
      toast({ title: "Régime créé" });
      setIsAddDialogOpen(false);
    },
    onError: (error) => {
      toast({ title: "Erreur", description: error.message, variant: "destructive" });
    },
  });

  const filteredRegimes = regimes?.filter(
    (r) =>
      r.code.toLowerCase().includes(search.toLowerCase()) ||
      r.name?.toLowerCase().includes(search.toLowerCase())
  );

  const startEdit = (regime: CustomsRegime) => {
    setEditingId(regime.id);
    setEditedRegime({ ...regime });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditedRegime(null);
  };

  const saveEdit = () => {
    if (editedRegime && editingId) {
      updateMutation.mutate({ ...editedRegime, id: editingId });
    }
  };

  const toggleTax = (taxKey: string) => {
    if (editedRegime) {
      setEditedRegime({
        ...editedRegime,
        [taxKey]: !editedRegime[taxKey as keyof CustomsRegime],
      });
    }
  };

  // Count active taxes per regime
  const countActiveTaxes = (regime: CustomsRegime) => {
    return TAX_COLUMNS.filter((tax) => regime[tax]).length;
  };

  // Stats
  const totalRegimes = regimes?.length || 0;
  const activeRegimes = regimes?.filter((r) => r.is_active).length || 0;
  const avgTaxes = regimes
    ? (regimes.reduce((sum, r) => sum + countActiveTaxes(r), 0) / regimes.length).toFixed(1)
    : 0;

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-semibold">Régimes Douaniers</h1>
          </div>
        </div>
      </header>

      <main className="p-6 space-y-6">
        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Régimes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{totalRegimes}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Régimes Actifs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{activeRegimes}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Taxes Moyennes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{avgTaxes}</div>
            </CardContent>
          </Card>
        </div>

        {/* Search and Actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Rechercher un régime..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10"
            />
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Ajouter un régime
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nouveau Régime Douanier</DialogTitle>
              </DialogHeader>
              <AddRegimeForm
                onSave={(data) => createMutation.mutate(data)}
                isLoading={createMutation.isPending}
              />
            </DialogContent>
          </Dialog>
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="font-semibold min-w-[100px]">Code</TableHead>
                    {TAX_COLUMNS.map((tax) => (
                      <TableHead key={tax} className="text-center font-semibold w-16">
                        {TAX_LABELS[tax]}
                      </TableHead>
                    ))}
                    <TableHead className="text-center font-semibold">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center py-8">
                        Chargement...
                      </TableCell>
                    </TableRow>
                  ) : filteredRegimes?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">
                        Aucun régime trouvé
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRegimes?.map((regime) => (
                      <TableRow
                        key={regime.id}
                        className={editingId === regime.id ? "bg-primary/5" : ""}
                      >
                        <TableCell className="font-medium text-primary">
                          {regime.code}
                        </TableCell>
                        {TAX_COLUMNS.map((tax) => (
                          <TableCell key={tax} className="text-center">
                            {editingId === regime.id ? (
                              <Checkbox
                                checked={editedRegime?.[tax] ?? false}
                                onCheckedChange={() => toggleTax(tax)}
                              />
                            ) : (
                              <Checkbox checked={regime[tax]} disabled />
                            )}
                          </TableCell>
                        ))}
                        <TableCell className="text-center">
                          {editingId === regime.id ? (
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={saveEdit}
                                disabled={updateMutation.isPending}
                              >
                                <Save className="h-4 w-4" />
                              </Button>
                              <Button size="sm" variant="ghost" onClick={cancelEdit}>
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startEdit(regime)}
                            >
                              Modifier
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

// Add Regime Form Component
function AddRegimeForm({
  onSave,
  isLoading,
}: {
  onSave: (data: Partial<CustomsRegime> & { code: string }) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState<Partial<CustomsRegime>>({
    code: "",
    name: "",
    dd: false,
    stx: false,
    rs: false,
    tin: false,
    tva: false,
    cosec: false,
    pcs: false,
    pcc: false,
    tpast: false,
    ta: false,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.code) {
      toast({ title: "Le code est requis", variant: "destructive" });
      return;
    }
    onSave({ ...formData, code: formData.code });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="code">Code *</Label>
          <Input
            id="code"
            value={formData.code || ""}
            onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
            placeholder="C100"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Nom</Label>
          <Input
            id="name"
            value={formData.name || ""}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Mise à la consommation"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Taxes applicables</Label>
        <div className="grid grid-cols-5 gap-3">
          {TAX_COLUMNS.map((tax) => (
            <div key={tax} className="flex items-center space-x-2">
              <Checkbox
                id={tax}
                checked={formData[tax] ?? false}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, [tax]: checked === true })
                }
              />
              <Label htmlFor={tax} className="text-sm font-medium">
                {TAX_LABELS[tax]}
              </Label>
            </div>
          ))}
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Création..." : "Créer le régime"}
      </Button>
    </form>
  );
}
