import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Search, Upload, Download, Edit2, Trash2, RefreshCw, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import * as pdfjsLib from "pdfjs-dist";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.js`;

interface HsCode {
  id: string;
  code: string;
  code_normalized: string;
  dd: number;
  rs: number;
  pcs: number;
  pcc: number;
  cosec: number;
  tin: number;
  tva: number;
  t_conj: number;
  bic: boolean;
  mercurialis: boolean;
  description: string | null;
  chapter: number;
}

export default function HsCodesAdmin() {
  const queryClient = useQueryClient();
  const [searchCode, setSearchCode] = useState("");
  const [searchDesc, setSearchDesc] = useState("");
  const [filterDD, setFilterDD] = useState<string>("all");
  const [filterChapter, setFilterChapter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [isExtractingPdf, setIsExtractingPdf] = useState(false);
  const [showPdfDialog, setShowPdfDialog] = useState(false);
  const [pdfText, setPdfText] = useState("");
  const [pdfProgress, setPdfProgress] = useState(0);
  const [pdfStatus, setPdfStatus] = useState("");
  const [editingCode, setEditingCode] = useState<HsCode | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const limit = 50;

  // Fetch HS codes
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["hs-codes", searchCode, searchDesc, filterDD, filterChapter, page],
    queryFn: async () => {
      let query = supabase
        .from("hs_codes")
        .select("*", { count: "exact" })
        .order("code")
        .range(page * limit, (page + 1) * limit - 1);

      if (searchCode) {
        query = query.or(`code.ilike.%${searchCode}%,code_normalized.ilike.%${searchCode}%`);
      }
      if (searchDesc) {
        query = query.ilike("description", `%${searchDesc}%`);
      }
      if (filterDD !== "all") {
        query = query.eq("dd", parseFloat(filterDD));
      }
      if (filterChapter !== "all") {
        query = query.eq("chapter", parseInt(filterChapter));
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: data as HsCode[], count };
    },
  });

  // Count by DD rate
  const { data: stats } = useQuery({
    queryKey: ["hs-codes-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hs_codes")
        .select("dd");
      if (error) throw error;
      
      const counts = { 0: 0, 5: 0, 10: 0, 20: 0, 35: 0, other: 0 };
      data?.forEach((item: { dd: number }) => {
        const dd = Number(item.dd);
        if (dd === 0) counts[0]++;
        else if (dd === 5) counts[5]++;
        else if (dd === 10) counts[10]++;
        else if (dd === 20) counts[20]++;
        else if (dd === 35) counts[35]++;
        else counts.other++;
      });
      return { total: data?.length || 0, byRate: counts };
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (hsCode: Partial<HsCode> & { id: string }) => {
      const { error } = await supabase
        .from("hs_codes")
        .update(hsCode)
        .eq("id", hsCode.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hs-codes"] });
      queryClient.invalidateQueries({ queryKey: ["hs-codes-stats"] });
      toast.success("Code SH mis à jour");
      setEditingCode(null);
    },
    onError: (error) => {
      toast.error("Erreur: " + error.message);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("hs_codes")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hs-codes"] });
      queryClient.invalidateQueries({ queryKey: ["hs-codes-stats"] });
      toast.success("Code SH supprimé");
    },
    onError: (error) => {
      toast.error("Erreur: " + error.message);
    },
  });

  // Import CSV
  const handleImportCSV = async () => {
    setIsImporting(true);
    try {
      // Fetch CSV content directly from the client side
      const csvResponse = await fetch("/data/nomenclature_douaniere.csv");
      if (!csvResponse.ok) {
        throw new Error("Impossible de charger le fichier CSV");
      }
      const csvContent = await csvResponse.text();
      
      // Send the CSV content directly to the edge function
      const response = await supabase.functions.invoke("import-hs-codes", {
        body: { csvContent },
      });
      
      if (response.error) throw new Error(response.error.message);
      
      const result = response.data;
      toast.success(`Import réussi: ${result.stats.inserted} codes importés`);
      queryClient.invalidateQueries({ queryKey: ["hs-codes"] });
      queryClient.invalidateQueries({ queryKey: ["hs-codes-stats"] });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      toast.error("Erreur d'import: " + message);
    } finally {
      setIsImporting(false);
    }
  };

  // Export CSV
  const handleExportCSV = async () => {
    try {
      const { data, error } = await supabase
        .from("hs_codes")
        .select("*")
        .order("code");
      
      if (error) throw error;

      const headers = ["code", "description", "dd", "rs", "pcs", "pcc", "cosec", "tin", "tva", "t_conj", "bic", "mercurialis", "chapter"];
      const csvContent = [
        headers.join(";"),
        ...data.map(row => headers.map(h => row[h as keyof typeof row] ?? "").join(";"))
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `hs_codes_export_${new Date().toISOString().split("T")[0]}.csv`;
      link.click();
      toast.success("Export CSV téléchargé");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      toast.error("Erreur d'export: " + message);
    }
  };

  // Extract text from PDF file
  const extractTextFromPdf = async (file: File): Promise<string> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    let fullText = "";
    
    for (let i = 1; i <= numPages; i++) {
      setPdfProgress(Math.round((i / numPages) * 50));
      setPdfStatus(`Lecture page ${i}/${numPages}...`);
      
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => item.str)
        .join(" ");
      fullText += pageText + "\n";
    }
    
    return fullText;
  };

  // Handle PDF file upload
  const handlePdfFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error("Veuillez sélectionner un fichier PDF");
      return;
    }
    
    setIsExtractingPdf(true);
    setPdfProgress(0);
    setPdfStatus("Chargement du PDF...");
    
    try {
      const extractedText = await extractTextFromPdf(file);
      setPdfText(extractedText);
      setPdfProgress(50);
      setPdfStatus("Texte extrait. Prêt pour l'extraction des descriptions.");
      toast.success(`PDF chargé: ${extractedText.length.toLocaleString()} caractères extraits`);
    } catch (error) {
      console.error("PDF extraction error:", error);
      toast.error("Erreur lors de la lecture du PDF");
      setPdfStatus("");
    } finally {
      setIsExtractingPdf(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  // Load pre-configured PDF
  const handleLoadDefaultPdf = async () => {
    setIsExtractingPdf(true);
    setPdfProgress(0);
    setPdfStatus("Chargement du PDF TEC UEMOA...");
    
    try {
      const response = await fetch("/data/TEC_UEMOA.pdf");
      if (!response.ok) throw new Error("PDF non trouvé");
      
      const blob = await response.blob();
      const file = new File([blob], "TEC_UEMOA.pdf", { type: "application/pdf" });
      const extractedText = await extractTextFromPdf(file);
      
      setPdfText(extractedText);
      setPdfProgress(50);
      setPdfStatus("Texte extrait. Prêt pour l'extraction des descriptions.");
      toast.success(`PDF chargé: ${extractedText.length.toLocaleString()} caractères extraits`);
    } catch (error) {
      console.error("Default PDF load error:", error);
      toast.error("Erreur lors du chargement du PDF par défaut");
      setPdfStatus("");
    } finally {
      setIsExtractingPdf(false);
    }
  };

  // Extract descriptions from PDF
  const handleExtractPdfDescriptions = async () => {
    if (!pdfText.trim()) {
      toast.error("Veuillez d'abord charger un PDF");
      return;
    }
    
    setIsExtractingPdf(true);
    setPdfProgress(60);
    setPdfStatus("Extraction des descriptions en cours...");
    
    try {
      const response = await supabase.functions.invoke("extract-pdf-descriptions", {
        body: { pdfText, useAI: true },
      });
      
      if (response.error) throw new Error(response.error.message);
      
      setPdfProgress(100);
      const result = response.data;
      toast.success(result.message);
      queryClient.invalidateQueries({ queryKey: ["hs-codes"] });
      setShowPdfDialog(false);
      setPdfText("");
      setPdfProgress(0);
      setPdfStatus("");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      toast.error("Erreur d'extraction: " + message);
      setPdfStatus("");
    } finally {
      setIsExtractingPdf(false);
    }
  };

  const totalPages = Math.ceil((data?.count || 0) / limit);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-5 w-5" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold">Codes SH - Administration</h1>
              <p className="text-muted-foreground">
                Gestion de la nomenclature douanière TEC UEMOA/CEDEAO
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Actualiser
            </Button>
            <Button variant="outline" onClick={handleExportCSV}>
              <Download className="h-4 w-4 mr-2" />
              Exporter CSV
            </Button>
            <Dialog open={showPdfDialog} onOpenChange={(open) => {
              setShowPdfDialog(open);
              if (!open) {
                setPdfText("");
                setPdfProgress(0);
                setPdfStatus("");
              }
            }}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <FileText className="h-4 w-4 mr-2" />
                  Extraire descriptions PDF
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Extraire les descriptions du PDF TEC UEMOA</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Chargez le PDF TEC UEMOA pour extraire automatiquement les descriptions des codes SH.
                  </p>
                  
                  {/* File upload options */}
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      onClick={handleLoadDefaultPdf}
                      disabled={isExtractingPdf}
                      className="flex-1"
                    >
                      <FileText className="h-4 w-4 mr-2" />
                      Charger PDF TEC UEMOA
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf"
                      onChange={handlePdfFileUpload}
                      className="hidden"
                    />
                    <Button 
                      variant="outline" 
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isExtractingPdf}
                      className="flex-1"
                    >
                      <Upload className="h-4 w-4 mr-2" />
                      Importer autre PDF
                    </Button>
                  </div>
                  
                  {/* Progress */}
                  {(pdfProgress > 0 || pdfStatus) && (
                    <div className="space-y-2">
                      <Progress value={pdfProgress} className="h-2" />
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        {isExtractingPdf && <Loader2 className="h-3 w-3 animate-spin" />}
                        {pdfStatus}
                      </p>
                    </div>
                  )}
                  
                  {/* Text preview */}
                  {pdfText && (
                    <Textarea
                      placeholder="Texte extrait du PDF..."
                      value={pdfText}
                      onChange={(e) => setPdfText(e.target.value)}
                      rows={12}
                      className="font-mono text-xs"
                      readOnly={isExtractingPdf}
                    />
                  )}
                  
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-muted-foreground">
                      {pdfText.length > 0 && `${pdfText.length.toLocaleString()} caractères`}
                    </p>
                    <Button 
                      onClick={handleExtractPdfDescriptions} 
                      disabled={isExtractingPdf || !pdfText.trim()}
                    >
                      {isExtractingPdf ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Extraction...
                        </>
                      ) : (
                        "Extraire les descriptions"
                      )}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
            <Button onClick={handleImportCSV} disabled={isImporting}>
              <Upload className="h-4 w-4 mr-2" />
              {isImporting ? "Import en cours..." : "Importer CSV"}
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-7 gap-4">
          <div className="bg-card rounded-lg p-4 border">
            <div className="text-2xl font-bold">{stats?.total || 0}</div>
            <div className="text-sm text-muted-foreground">Total codes</div>
          </div>
          <div className="bg-green-500/10 rounded-lg p-4 border border-green-500/20">
            <div className="text-2xl font-bold text-green-600">{stats?.byRate[0] || 0}</div>
            <div className="text-sm text-muted-foreground">DD 0%</div>
          </div>
          <div className="bg-blue-500/10 rounded-lg p-4 border border-blue-500/20">
            <div className="text-2xl font-bold text-blue-600">{stats?.byRate[5] || 0}</div>
            <div className="text-sm text-muted-foreground">DD 5%</div>
          </div>
          <div className="bg-yellow-500/10 rounded-lg p-4 border border-yellow-500/20">
            <div className="text-2xl font-bold text-yellow-600">{stats?.byRate[10] || 0}</div>
            <div className="text-sm text-muted-foreground">DD 10%</div>
          </div>
          <div className="bg-orange-500/10 rounded-lg p-4 border border-orange-500/20">
            <div className="text-2xl font-bold text-orange-600">{stats?.byRate[20] || 0}</div>
            <div className="text-sm text-muted-foreground">DD 20%</div>
          </div>
          <div className="bg-red-500/10 rounded-lg p-4 border border-red-500/20">
            <div className="text-2xl font-bold text-red-600">{stats?.byRate[35] || 0}</div>
            <div className="text-sm text-muted-foreground">DD 35%</div>
          </div>
          <div className="bg-purple-500/10 rounded-lg p-4 border border-purple-500/20">
            <div className="text-2xl font-bold text-purple-600">{stats?.byRate.other || 0}</div>
            <div className="text-sm text-muted-foreground">Autres</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 bg-card p-4 rounded-lg border">
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="searchCode">Code SH</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="searchCode"
                placeholder="Ex: 0201, 1516..."
                value={searchCode}
                onChange={(e) => { setSearchCode(e.target.value); setPage(0); }}
                className="pl-9"
              />
            </div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="searchDesc">Description</Label>
            <Input
              id="searchDesc"
              placeholder="Ex: viande, huile..."
              value={searchDesc}
              onChange={(e) => { setSearchDesc(e.target.value); setPage(0); }}
            />
          </div>
          <div className="w-[150px]">
            <Label>Droit de Douane</Label>
            <Select value={filterDD} onValueChange={(v) => { setFilterDD(v); setPage(0); }}>
              <SelectTrigger>
                <SelectValue placeholder="Tous" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                <SelectItem value="0">0%</SelectItem>
                <SelectItem value="5">5%</SelectItem>
                <SelectItem value="10">10%</SelectItem>
                <SelectItem value="20">20%</SelectItem>
                <SelectItem value="35">35%</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-[150px]">
            <Label>Chapitre</Label>
            <Select value={filterChapter} onValueChange={(v) => { setFilterChapter(v); setPage(0); }}>
              <SelectTrigger>
                <SelectValue placeholder="Tous" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tous</SelectItem>
                {Array.from({ length: 97 }, (_, i) => i + 1).map((ch) => (
                  <SelectItem key={ch} value={ch.toString()}>Chapitre {ch}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        <div className="bg-card rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Code SH</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[60px]">DD</TableHead>
                <TableHead className="w-[60px]">RS</TableHead>
                <TableHead className="w-[60px]">PCS</TableHead>
                <TableHead className="w-[60px]">TIN</TableHead>
                <TableHead className="w-[60px]">TVA</TableHead>
                <TableHead className="w-[60px]">TCI</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    Chargement...
                  </TableCell>
                </TableRow>
              ) : data?.data?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8">
                    <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">Aucun code SH trouvé</p>
                    <p className="text-sm text-muted-foreground">
                      Cliquez sur "Importer CSV" pour charger les codes
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                data?.data?.map((code) => (
                  <TableRow key={code.id}>
                    <TableCell className="font-mono font-medium">{code.code}</TableCell>
                    <TableCell className="max-w-[300px] truncate" title={code.description || ""}>
                      {code.description || "-"}
                    </TableCell>
                    <TableCell className={getDDColorClass(code.dd)}>{code.dd}%</TableCell>
                    <TableCell>{code.rs}%</TableCell>
                    <TableCell>{code.pcs}%</TableCell>
                    <TableCell>{code.tin > 0 ? `${code.tin}%` : "-"}</TableCell>
                    <TableCell>{code.tva}%</TableCell>
                    <TableCell>{code.t_conj > 0 ? `${code.t_conj}%` : "-"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditingCode(code)}
                            >
                              <Edit2 className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="max-w-2xl">
                            <DialogHeader>
                              <DialogTitle>Modifier {code.code}</DialogTitle>
                            </DialogHeader>
                            {editingCode && (
                              <EditCodeForm
                                code={editingCode}
                                onSave={(updated) => updateMutation.mutate(updated)}
                                isLoading={updateMutation.isPending}
                              />
                            )}
                          </DialogContent>
                        </Dialog>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("Supprimer ce code SH ?")) {
                              deleteMutation.mutate(code.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page + 1} sur {totalPages} ({data?.count} résultats)
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
              >
                Précédent
              </Button>
              <Button
                variant="outline"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
              >
                Suivant
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function getDDColorClass(dd: number): string {
  switch (dd) {
    case 0: return "text-green-600 font-medium";
    case 5: return "text-blue-600 font-medium";
    case 10: return "text-yellow-600 font-medium";
    case 20: return "text-orange-600 font-medium";
    case 35: return "text-red-600 font-medium";
    default: return "text-purple-600 font-medium";
  }
}

interface EditCodeFormProps {
  code: HsCode;
  onSave: (code: Partial<HsCode> & { id: string }) => void;
  isLoading: boolean;
}

function EditCodeForm({ code, onSave, isLoading }: EditCodeFormProps) {
  const [formData, setFormData] = useState(code);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      id: code.id,
      dd: formData.dd,
      rs: formData.rs,
      pcs: formData.pcs,
      pcc: formData.pcc,
      cosec: formData.cosec,
      tin: formData.tin,
      tva: formData.tva,
      t_conj: formData.t_conj,
      bic: formData.bic,
      mercurialis: formData.mercurialis,
      description: formData.description,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Description</Label>
        <Input
          value={formData.description || ""}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-4 gap-4">
        <div>
          <Label>DD (%)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.dd}
            onChange={(e) => setFormData({ ...formData, dd: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label>RS (%)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.rs}
            onChange={(e) => setFormData({ ...formData, rs: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label>PCS (%)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.pcs}
            onChange={(e) => setFormData({ ...formData, pcs: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label>PCC (%)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.pcc}
            onChange={(e) => setFormData({ ...formData, pcc: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label>COSEC (%)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.cosec}
            onChange={(e) => setFormData({ ...formData, cosec: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label>TIN (%)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.tin}
            onChange={(e) => setFormData({ ...formData, tin: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label>TVA (%)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.tva}
            onChange={(e) => setFormData({ ...formData, tva: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <Label>TCI (%)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.t_conj}
            onChange={(e) => setFormData({ ...formData, t_conj: parseFloat(e.target.value) || 0 })}
          />
        </div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.bic}
            onChange={(e) => setFormData({ ...formData, bic: e.target.checked })}
          />
          <span>BIC applicable</span>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={formData.mercurialis}
            onChange={(e) => setFormData({ ...formData, mercurialis: e.target.checked })}
          />
          <span>Mercurialis</span>
        </label>
      </div>
      <Button type="submit" disabled={isLoading}>
        {isLoading ? "Enregistrement..." : "Enregistrer"}
      </Button>
    </form>
  );
}
