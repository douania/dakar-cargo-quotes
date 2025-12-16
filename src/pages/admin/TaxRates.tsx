import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { ArrowLeft, Edit2, Plus, RefreshCw, AlertCircle } from "lucide-react";
import { Link } from "react-router-dom";

interface TaxRate {
  id: string;
  code: string;
  name: string;
  rate: number;
  base_calculation: string;
  applies_to: string | null;
  exemptions: string | null;
  effective_date: string;
  is_active: boolean;
}

export default function TaxRatesAdmin() {
  const queryClient = useQueryClient();
  const [editingRate, setEditingRate] = useState<TaxRate | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  // Fetch tax rates
  const { data: taxRates, isLoading, refetch } = useQuery({
    queryKey: ["tax-rates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tax_rates")
        .select("*")
        .order("code");
      if (error) throw error;
      return data as TaxRate[];
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (rate: Partial<TaxRate> & { id: string }) => {
      const { error } = await supabase
        .from("tax_rates")
        .update({
          ...rate,
          updated_at: new Date().toISOString(),
        })
        .eq("id", rate.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-rates"] });
      toast.success("Taux mis à jour");
      setEditingRate(null);
    },
    onError: (error) => {
      toast.error("Erreur: " + error.message);
    },
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (rate: Omit<TaxRate, "id">) => {
      const { error } = await supabase.from("tax_rates").insert(rate);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-rates"] });
      toast.success("Nouveau taux créé");
      setIsAddDialogOpen(false);
    },
    onError: (error) => {
      toast.error("Erreur: " + error.message);
    },
  });

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Taux de Taxes</h1>
              <p className="text-muted-foreground">
                Gestion des taux de taxes applicables aux importations
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Actualiser
            </Button>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Ajouter un taux
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Nouveau taux de taxe</DialogTitle>
                </DialogHeader>
                <TaxRateForm
                  onSave={(data) => createMutation.mutate(data)}
                  isLoading={createMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Info box */}
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex gap-3">
          <AlertCircle className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-blue-600 dark:text-blue-400">
              Taux en vigueur pour le Sénégal (2024/2025)
            </p>
            <p className="text-muted-foreground mt-1">
              Ces taux sont utilisés pour le calcul automatique des débours douaniers. 
              Modifiez-les uniquement en cas de mise à jour officielle des taux.
            </p>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Code</TableHead>
                <TableHead>Nom</TableHead>
                <TableHead className="w-[100px]">Taux</TableHead>
                <TableHead>Base de calcul</TableHead>
                <TableHead>Date d'effet</TableHead>
                <TableHead className="w-[80px]">Actif</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    Chargement...
                  </TableCell>
                </TableRow>
              ) : taxRates?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    Aucun taux configuré
                  </TableCell>
                </TableRow>
              ) : (
                taxRates?.map((rate) => (
                  <TableRow key={rate.id}>
                    <TableCell className="font-mono font-bold">{rate.code}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{rate.name}</p>
                        {rate.exemptions && (
                          <p className="text-xs text-muted-foreground">
                            Exonérations: {rate.exemptions}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-bold text-lg">{rate.rate}%</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {rate.base_calculation}
                    </TableCell>
                    <TableCell>
                      {new Date(rate.effective_date).toLocaleDateString("fr-FR")}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={rate.is_active}
                        onCheckedChange={(checked) =>
                          updateMutation.mutate({ id: rate.id, is_active: checked })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingRate(rate)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-lg">
                          <DialogHeader>
                            <DialogTitle>Modifier {rate.code}</DialogTitle>
                          </DialogHeader>
                          {editingRate && (
                            <TaxRateForm
                              initialData={editingRate}
                              onSave={(data) =>
                                updateMutation.mutate({ id: editingRate.id, ...data })
                              }
                              isLoading={updateMutation.isPending}
                            />
                          )}
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Summary */}
        <div className="bg-card rounded-lg border p-6">
          <h3 className="font-semibold mb-4">Récapitulatif des taux actifs</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {taxRates
              ?.filter((r) => r.is_active)
              .map((rate) => (
                <div
                  key={rate.id}
                  className="bg-muted/50 rounded-lg p-3 text-center"
                >
                  <div className="text-2xl font-bold">{rate.rate}%</div>
                  <div className="text-sm text-muted-foreground">{rate.code}</div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface TaxRateFormProps {
  initialData?: TaxRate;
  onSave: (data: Omit<TaxRate, "id">) => void;
  isLoading: boolean;
}

function TaxRateForm({ initialData, onSave, isLoading }: TaxRateFormProps) {
  const [formData, setFormData] = useState({
    code: initialData?.code || "",
    name: initialData?.name || "",
    rate: initialData?.rate || 0,
    base_calculation: initialData?.base_calculation || "Valeur CAF",
    applies_to: initialData?.applies_to || "",
    exemptions: initialData?.exemptions || "",
    effective_date: initialData?.effective_date?.split("T")[0] || new Date().toISOString().split("T")[0],
    is_active: initialData?.is_active ?? true,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      applies_to: formData.applies_to || null,
      exemptions: formData.exemptions || null,
    } as Omit<TaxRate, "id">);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="code">Code</Label>
          <Input
            id="code"
            value={formData.code}
            onChange={(e) => setFormData({ ...formData, code: e.target.value })}
            placeholder="Ex: RS, PCS, TVA..."
            required
            disabled={!!initialData}
          />
        </div>
        <div>
          <Label htmlFor="rate">Taux (%)</Label>
          <Input
            id="rate"
            type="number"
            step="0.01"
            value={formData.rate}
            onChange={(e) => setFormData({ ...formData, rate: parseFloat(e.target.value) || 0 })}
            required
          />
        </div>
      </div>
      <div>
        <Label htmlFor="name">Nom complet</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Ex: Redevance Statistique"
          required
        />
      </div>
      <div>
        <Label htmlFor="base">Base de calcul</Label>
        <Input
          id="base"
          value={formData.base_calculation}
          onChange={(e) => setFormData({ ...formData, base_calculation: e.target.value })}
          placeholder="Ex: Valeur CAF"
          required
        />
      </div>
      <div>
        <Label htmlFor="applies">S'applique à</Label>
        <Input
          id="applies"
          value={formData.applies_to}
          onChange={(e) => setFormData({ ...formData, applies_to: e.target.value })}
          placeholder="Ex: Toutes importations"
        />
      </div>
      <div>
        <Label htmlFor="exemptions">Exonérations</Label>
        <Textarea
          id="exemptions"
          value={formData.exemptions}
          onChange={(e) => setFormData({ ...formData, exemptions: e.target.value })}
          placeholder="Ex: Riz, blé, médicaments..."
          rows={2}
        />
      </div>
      <div>
        <Label htmlFor="date">Date d'entrée en vigueur</Label>
        <Input
          id="date"
          type="date"
          value={formData.effective_date}
          onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
          required
        />
      </div>
      <div className="flex items-center gap-2">
        <Switch
          id="active"
          checked={formData.is_active}
          onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
        />
        <Label htmlFor="active">Taux actif</Label>
      </div>
      <Button type="submit" className="w-full" disabled={isLoading}>
        {isLoading ? "Enregistrement..." : "Enregistrer"}
      </Button>
    </form>
  );
}
