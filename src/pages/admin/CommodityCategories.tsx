import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Package, Filter, X } from "lucide-react";
import CorrespondancesTab from "@/components/admin/CorrespondancesTab";
import PadAliasTab from "@/components/admin/PadAliasTab";
const EVIDENCE_LEVELS = ['official', 'observed', 'to_confirm'] as const;
const CARGO_TYPES = ['DRY', 'DG', 'REEFER', 'OOG', 'BREAKBULK', 'RORO', 'VEHICULE'];
const TERMINAL_PROVIDERS = ['DP_WORLD', 'DAKAR_TERMINAL', 'TAL', 'PAD'];
const UNIT_BASES = ['PER_BL', 'PER_CNT', 'PER_TEU', 'PER_TONNE', 'PER_DAY', 'PER_M3', 'PER_UNIT', 'FORFAIT'];

type EvidenceLevel = typeof EVIDENCE_LEVELS[number];

interface CommodityCategory {
  id: string;
  designation_raw: string;
  designation_normalized: string | null;
  hs_chapter: number | null;
  pad_category: string | null;
  pad_category_label: string | null;
  terminal_provider: string | null;
  terminal_category: string | null;
  terminal_handling_code: string | null;
  terminal_storage_code_p1: string | null;
  terminal_storage_code_p2: string | null;
  terminal_storage_code_p3: string | null;
  unit_basis: string | null;
  cargo_type: string | null;
  confidence: number | null;
  evidence_level: string;
  source_documents: string[] | null;
  notes_operator: string | null;
  is_validated: boolean;
  created_at: string;
  updated_at: string;
}

const defaultForm = {
  designation_raw: '',
  designation_normalized: '',
  hs_chapter: null as number | null,
  pad_category: '',
  pad_category_label: '',
  terminal_provider: '',
  terminal_category: '',
  terminal_handling_code: '',
  terminal_storage_code_p1: '',
  terminal_storage_code_p2: '',
  terminal_storage_code_p3: '',
  unit_basis: '',
  cargo_type: '',
  confidence: 0.8,
  evidence_level: 'to_confirm' as string,
  source_documents_input: '',
  source_documents: [] as string[],
  notes_operator: '',
  is_validated: false,
};

const getEvidenceBadge = (level: string) => {
  switch (level) {
    case 'official': return <Badge className="bg-green-600 text-white">Officiel</Badge>;
    case 'observed': return <Badge className="bg-amber-500 text-white">Observé</Badge>;
    default: return <Badge variant="secondary">À confirmer</Badge>;
  }
};

export default function CommodityCategories() {
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [filterProvider, setFilterProvider] = useState('all');
  const [filterEvidence, setFilterEvidence] = useState('all');
  const [form, setForm] = useState(defaultForm);

  const { data: categories, isLoading } = useQuery({
    queryKey: ['commodity-categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commodity_categories')
        .select('*')
        .order('designation_normalized', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as CommodityCategory[];
    },
  });

  const cleanSourceDocuments = (docs: string[]): string[] => {
    return [...new Set(docs.map(d => d.trim()).filter(Boolean))];
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        designation_raw: form.designation_raw,
        designation_normalized: form.designation_normalized || null,
        hs_chapter: form.hs_chapter,
        pad_category: form.pad_category || null,
        pad_category_label: form.pad_category_label || null,
        terminal_provider: form.terminal_provider || null,
        terminal_category: form.terminal_category || null,
        terminal_handling_code: form.terminal_handling_code || null,
        terminal_storage_code_p1: form.terminal_storage_code_p1 || null,
        terminal_storage_code_p2: form.terminal_storage_code_p2 || null,
        terminal_storage_code_p3: form.terminal_storage_code_p3 || null,
        unit_basis: form.unit_basis || null,
        cargo_type: form.cargo_type || null,
        confidence: form.confidence,
        evidence_level: form.evidence_level,
        source_documents: cleanSourceDocuments(form.source_documents),
        notes_operator: form.notes_operator || null,
        is_validated: form.is_validated,
      };
      if (editingId) {
        const { error } = await supabase.from('commodity_categories').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('commodity_categories').insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commodity-categories'] });
      toast.success(editingId ? 'Catégorie mise à jour' : 'Catégorie créée');
      closeDialog();
    },
    onError: (e) => toast.error('Erreur: ' + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('commodity_categories').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commodity-categories'] });
      toast.success('Catégorie supprimée');
    },
    onError: (e) => toast.error('Erreur: ' + e.message),
  });

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingId(null);
    setForm(defaultForm);
  };

  const handleEdit = (c: CommodityCategory) => {
    setEditingId(c.id);
    setForm({
      designation_raw: c.designation_raw,
      designation_normalized: c.designation_normalized || '',
      hs_chapter: c.hs_chapter,
      pad_category: c.pad_category || '',
      pad_category_label: c.pad_category_label || '',
      terminal_provider: c.terminal_provider || '',
      terminal_category: c.terminal_category || '',
      terminal_handling_code: c.terminal_handling_code || '',
      terminal_storage_code_p1: c.terminal_storage_code_p1 || '',
      terminal_storage_code_p2: c.terminal_storage_code_p2 || '',
      terminal_storage_code_p3: c.terminal_storage_code_p3 || '',
      unit_basis: c.unit_basis || '',
      cargo_type: c.cargo_type || '',
      confidence: c.confidence ?? 0.8,
      evidence_level: c.evidence_level || 'to_confirm',
      source_documents_input: '',
      source_documents: c.source_documents || [],
      notes_operator: c.notes_operator || '',
      is_validated: c.is_validated,
    });
    setIsDialogOpen(true);
  };

  const addSourceDoc = () => {
    const trimmed = form.source_documents_input.trim();
    if (trimmed && !form.source_documents.includes(trimmed)) {
      setForm({ ...form, source_documents: [...form.source_documents, trimmed], source_documents_input: '' });
    }
  };

  const removeSourceDoc = (idx: number) => {
    setForm({ ...form, source_documents: form.source_documents.filter((_, i) => i !== idx) });
  };

  const filtered = categories?.filter(c => {
    if (filterProvider !== 'all' && c.terminal_provider !== filterProvider) return false;
    if (filterEvidence !== 'all' && c.evidence_level !== filterEvidence) return false;
    return true;
  });

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Package className="h-8 w-8 text-primary" />
            <div>
              <h1 className="text-2xl font-bold">Catégories Marchandises</h1>
              <p className="text-muted-foreground">Mapping marchandise → catégorie PAD / terminal</p>
            </div>
          </div>
          <Dialog open={isDialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); else setIsDialogOpen(true); }}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" />Nouvelle catégorie</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingId ? 'Modifier' : 'Ajouter'} une catégorie</DialogTitle>
              </DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }} className="space-y-5">
                {/* Designation */}
                <fieldset className="border rounded-md p-3 space-y-3">
                  <legend className="text-sm font-semibold px-1">Désignation</legend>
                  <div>
                    <Label>Désignation brute *</Label>
                    <Input value={form.designation_raw} onChange={e => setForm({ ...form, designation_raw: e.target.value })} required />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Désignation normalisée</Label>
                      <Input value={form.designation_normalized} onChange={e => setForm({ ...form, designation_normalized: e.target.value })} />
                    </div>
                    <div>
                      <Label>Chapitre HS</Label>
                      <Input type="number" value={form.hs_chapter ?? ''} onChange={e => setForm({ ...form, hs_chapter: e.target.value ? parseInt(e.target.value) : null })} placeholder="ex: 73" />
                    </div>
                  </div>
                </fieldset>

                {/* PAD */}
                <fieldset className="border rounded-md p-3 space-y-3">
                  <legend className="text-sm font-semibold px-1">Catégorie PAD</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Code PAD</Label>
                      <Input value={form.pad_category} onChange={e => setForm({ ...form, pad_category: e.target.value })} placeholder="T01, T02..." />
                    </div>
                    <div>
                      <Label>Libellé PAD</Label>
                      <Input value={form.pad_category_label} onChange={e => setForm({ ...form, pad_category_label: e.target.value })} placeholder="Matériaux de construction" />
                    </div>
                  </div>
                </fieldset>

                {/* Terminal */}
                <fieldset className="border rounded-md p-3 space-y-3">
                  <legend className="text-sm font-semibold px-1">Terminal</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Provider</Label>
                      <Select value={form.terminal_provider} onValueChange={v => setForm({ ...form, terminal_provider: v })}>
                        <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                        <SelectContent>
                          {TERMINAL_PROVIDERS.map(p => <SelectItem key={p} value={p}>{p.replace(/_/g, ' ')}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Catégorie terminal</Label>
                      <Input value={form.terminal_category} onChange={e => setForm({ ...form, terminal_category: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Code manutention</Label>
                      <Input value={form.terminal_handling_code} onChange={e => setForm({ ...form, terminal_handling_code: e.target.value })} placeholder="412, 512..." />
                    </div>
                    <div>
                      <Label>Base de calcul</Label>
                      <Select value={form.unit_basis} onValueChange={v => setForm({ ...form, unit_basis: v })}>
                        <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                        <SelectContent>
                          {UNIT_BASES.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Stockage P1</Label>
                      <Input value={form.terminal_storage_code_p1} onChange={e => setForm({ ...form, terminal_storage_code_p1: e.target.value })} />
                    </div>
                    <div>
                      <Label>Stockage P2</Label>
                      <Input value={form.terminal_storage_code_p2} onChange={e => setForm({ ...form, terminal_storage_code_p2: e.target.value })} />
                    </div>
                    <div>
                      <Label>Stockage P3</Label>
                      <Input value={form.terminal_storage_code_p3} onChange={e => setForm({ ...form, terminal_storage_code_p3: e.target.value })} />
                    </div>
                  </div>
                </fieldset>

                {/* Cargo */}
                <div>
                  <Label>Type cargo</Label>
                  <Select value={form.cargo_type} onValueChange={v => setForm({ ...form, cargo_type: v })}>
                    <SelectTrigger><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                    <SelectContent>
                      {CARGO_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                {/* Traçabilité */}
                <fieldset className="border rounded-md p-3 space-y-3">
                  <legend className="text-sm font-semibold px-1">Traçabilité</legend>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label>Niveau de preuve</Label>
                      <Select value={form.evidence_level} onValueChange={v => setForm({ ...form, evidence_level: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="official">Officiel</SelectItem>
                          <SelectItem value="observed">Observé</SelectItem>
                          <SelectItem value="to_confirm">À confirmer</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Confiance : {Math.round(form.confidence * 100)}%</Label>
                      <Slider
                        value={[form.confidence * 100]}
                        onValueChange={([v]) => setForm({ ...form, confidence: v / 100 })}
                        max={100} step={5} className="mt-2"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Documents source</Label>
                    <div className="flex gap-2">
                      <Input
                        value={form.source_documents_input}
                        onChange={e => setForm({ ...form, source_documents_input: e.target.value })}
                        placeholder="Nom du document..."
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSourceDoc(); } }}
                      />
                      <Button type="button" variant="outline" size="sm" onClick={addSourceDoc}>+</Button>
                    </div>
                    {form.source_documents.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {form.source_documents.map((doc, i) => (
                          <Badge key={i} variant="secondary" className="gap-1">
                            {doc}
                            <X className="h-3 w-3 cursor-pointer" onClick={() => removeSourceDoc(i)} />
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <Label>Notes opérateur</Label>
                    <Input value={form.notes_operator} onChange={e => setForm({ ...form, notes_operator: e.target.value })} />
                  </div>
                  <div className="flex items-center gap-2">
                    <input type="checkbox" id="is_validated" checked={form.is_validated} onChange={e => setForm({ ...form, is_validated: e.target.checked })} className="rounded" />
                    <Label htmlFor="is_validated">Validé par opérateur</Label>
                  </div>
                </fieldset>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={closeDialog}>Annuler</Button>
                  <Button type="submit">{editingId ? 'Mettre à jour' : 'Créer'}</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        <Tabs defaultValue="categories" className="mt-2">
          <TabsList>
            <TabsTrigger value="categories">Catégories</TabsTrigger>
            <TabsTrigger value="correspondances">Correspondances</TabsTrigger>
          </TabsList>

          <TabsContent value="categories">
            {/* Filters */}
            <div className="flex gap-4 mb-6">
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={filterProvider} onValueChange={setFilterProvider}>
                  <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Tous providers</SelectItem>
                    {TERMINAL_PROVIDERS.map(p => <SelectItem key={p} value={p}>{p.replace(/_/g, ' ')}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Select value={filterEvidence} onValueChange={setFilterEvidence}>
                <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Tous niveaux</SelectItem>
                  <SelectItem value="official">Officiel</SelectItem>
                  <SelectItem value="observed">Observé</SelectItem>
                  <SelectItem value="to_confirm">À confirmer</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <div className="bg-card rounded-lg p-4 border">
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{categories?.length || 0}</p>
              </div>
              <div className="bg-card rounded-lg p-4 border">
                <p className="text-sm text-muted-foreground">Officiels</p>
                <p className="text-2xl font-bold text-green-600">{categories?.filter(c => c.evidence_level === 'official').length || 0}</p>
              </div>
              <div className="bg-card rounded-lg p-4 border">
                <p className="text-sm text-muted-foreground">Observés</p>
                <p className="text-2xl font-bold text-amber-500">{categories?.filter(c => c.evidence_level === 'observed').length || 0}</p>
              </div>
              <div className="bg-card rounded-lg p-4 border">
                <p className="text-sm text-muted-foreground">À confirmer</p>
                <p className="text-2xl font-bold text-muted-foreground">{categories?.filter(c => c.evidence_level === 'to_confirm').length || 0}</p>
              </div>
            </div>

            {/* Table */}
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Désignation</TableHead>
                    <TableHead>PAD</TableHead>
                    <TableHead>Terminal</TableHead>
                    <TableHead>Cargo</TableHead>
                    <TableHead>Preuve</TableHead>
                    <TableHead>Confiance</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8">Chargement...</TableCell></TableRow>
                  ) : filtered?.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Aucune catégorie trouvée</TableCell></TableRow>
                  ) : filtered?.map(c => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium">{c.designation_normalized || c.designation_raw}</span>
                          {c.designation_normalized && c.designation_normalized !== c.designation_raw && (
                            <span className="block text-xs text-muted-foreground">{c.designation_raw}</span>
                          )}
                          {c.hs_chapter && <Badge variant="outline" className="ml-1 text-xs">HS {c.hs_chapter}</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {c.pad_category ? (
                          <div>
                            <Badge variant="outline">{c.pad_category}</Badge>
                            {c.pad_category_label && <span className="block text-xs text-muted-foreground mt-0.5">{c.pad_category_label}</span>}
                          </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {c.terminal_provider ? (
                          <div className="text-sm">
                            <span className="font-medium">{c.terminal_provider.replace(/_/g, ' ')}</span>
                            {c.terminal_handling_code && <span className="block text-xs text-muted-foreground">Manut: {c.terminal_handling_code}</span>}
                          </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell className="text-sm">{c.cargo_type || '-'}</TableCell>
                      <TableCell>{getEvidenceBadge(c.evidence_level)}</TableCell>
                      <TableCell>
                        <span className="text-sm font-mono">{c.confidence != null ? `${Math.round(c.confidence * 100)}%` : '-'}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => handleEdit(c)}><Pencil className="h-4 w-4" /></Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { if (confirm('Supprimer ?')) deleteMutation.mutate(c.id); }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="correspondances">
            <CorrespondancesTab
              categories={(categories || []).map(c => ({
                id: c.id,
                designation_raw: c.designation_raw,
                designation_normalized: c.designation_normalized,
                pad_category: c.pad_category,
              }))}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
