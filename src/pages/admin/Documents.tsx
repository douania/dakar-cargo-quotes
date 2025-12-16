import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  ArrowLeft,
  Upload,
  FileText,
  FileSpreadsheet,
  File,
  Search,
  Trash2,
  Eye,
  Sparkles,
  RefreshCw,
  Download,
} from "lucide-react";
import { Link } from "react-router-dom";

interface Document {
  id: string;
  filename: string;
  file_type: string;
  file_size: number;
  content_text: string | null;
  extracted_data: any;
  source: string;
  tags: string[] | null;
  created_at: string;
}

export default function DocumentsAdmin() {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTag, setFilterTag] = useState<string>("all");
  const [isUploading, setIsUploading] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState<Document | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Fetch documents
  const { data: documents, isLoading } = useQuery({
    queryKey: ["documents", searchQuery, filterTag],
    queryFn: async () => {
      let query = supabase
        .from("documents")
        .select("*")
        .order("created_at", { ascending: false });

      if (searchQuery) {
        query = query.or(`filename.ilike.%${searchQuery}%,content_text.ilike.%${searchQuery}%`);
      }
      
      if (filterTag !== "all") {
        query = query.contains("tags", [filterTag]);
      }

      const { data, error } = await query.limit(100);
      if (error) throw error;
      return data as Document[];
    },
  });

  // Get unique tags
  const allTags = documents?.reduce((acc: string[], doc) => {
    doc.tags?.forEach(tag => {
      if (!acc.includes(tag)) acc.push(tag);
    });
    return acc;
  }, []) || [];

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("documents").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document supprimé");
    },
  });

  // Handle file upload
  const handleFileUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    setIsUploading(true);
    const results: { success: boolean; filename: string; error?: string }[] = [];

    for (const file of Array.from(files)) {
      try {
        const formData = new FormData();
        formData.append("file", file);

        const { data, error } = await supabase.functions.invoke("parse-document", {
          body: formData,
        });

        if (error) throw error;
        results.push({ success: true, filename: file.name });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Erreur inconnue";
        results.push({ success: false, filename: file.name, error: message });
      }
    }

    setIsUploading(false);
    queryClient.invalidateQueries({ queryKey: ["documents"] });

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    if (successCount > 0) {
      toast.success(`${successCount} fichier(s) uploadé(s) avec succès`);
    }
    if (failCount > 0) {
      toast.error(`${failCount} fichier(s) en erreur`);
    }
  }, [queryClient]);

  // Handle AI analysis
  const handleAnalyze = async (doc: Document, analysisType: string) => {
    setIsAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("analyze-document", {
        body: { documentId: doc.id, analysisType },
      });

      if (error) throw error;

      toast.success("Analyse terminée");
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      
      // Update selected doc with analysis
      if (selectedDoc?.id === doc.id) {
        setSelectedDoc({
          ...selectedDoc,
          extracted_data: {
            ...selectedDoc.extracted_data,
            ai_analysis: data.analysis,
          },
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erreur d'analyse";
      toast.error(message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Drop zone handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleFileUpload(e.dataTransfer.files);
  };

  const getFileIcon = (type: string) => {
    switch (type) {
      case "pdf":
        return <FileText className="h-5 w-5 text-red-500" />;
      case "xlsx":
      case "xls":
      case "csv":
        return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
      default:
        return <File className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

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
              <h1 className="text-2xl font-bold">Gestion des Documents</h1>
              <p className="text-muted-foreground">
                Upload et analyse de documents PDF, Excel, CSV
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["documents"] })}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Actualiser
            </Button>
          </div>
        </div>

        {/* Upload Zone */}
        <Card
          className="border-2 border-dashed transition-colors hover:border-primary/50"
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <CardContent className="p-8">
            <div className="flex flex-col items-center justify-center text-center">
              <Upload className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">
                Glissez-déposez vos fichiers ici
              </h3>
              <p className="text-muted-foreground mb-4">
                Formats supportés : PDF, Excel (XLS, XLSX), CSV, TXT
              </p>
              <Label htmlFor="file-upload">
                <Button asChild disabled={isUploading}>
                  <span>
                    {isUploading ? "Upload en cours..." : "Sélectionner des fichiers"}
                  </span>
                </Button>
              </Label>
              <Input
                id="file-upload"
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.xls,.xlsx,.csv,.txt,.md"
                onChange={(e) => handleFileUpload(e.target.files)}
                disabled={isUploading}
              />
            </div>
          </CardContent>
        </Card>

        {/* Filters */}
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[250px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher par nom ou contenu..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <Badge
              variant={filterTag === "all" ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setFilterTag("all")}
            >
              Tous
            </Badge>
            {allTags.map((tag) => (
              <Badge
                key={tag}
                variant={filterTag === tag ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setFilterTag(tag)}
              >
                {tag}
              </Badge>
            ))}
          </div>
        </div>

        {/* Documents Table */}
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">Type</TableHead>
                <TableHead>Fichier</TableHead>
                <TableHead>Tags</TableHead>
                <TableHead>Taille</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-[120px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    Chargement...
                  </TableCell>
                </TableRow>
              ) : documents?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-2" />
                    <p className="text-muted-foreground">Aucun document</p>
                    <p className="text-sm text-muted-foreground">
                      Uploadez des fichiers pour commencer
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                documents?.map((doc) => (
                  <TableRow key={doc.id}>
                    <TableCell>{getFileIcon(doc.file_type)}</TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium truncate max-w-[300px]" title={doc.filename}>
                          {doc.filename}
                        </p>
                        {doc.extracted_data?.ai_analysis && (
                          <Badge variant="secondary" className="mt-1">
                            <Sparkles className="h-3 w-3 mr-1" />
                            Analysé
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 flex-wrap">
                        {doc.tags?.map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>{formatFileSize(doc.file_size)}</TableCell>
                    <TableCell>
                      {new Date(doc.created_at).toLocaleDateString("fr-FR")}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setSelectedDoc(doc)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleAnalyze(doc, "auto")}
                          disabled={isAnalyzing}
                        >
                          <Sparkles className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            if (confirm("Supprimer ce document ?")) {
                              deleteMutation.mutate(doc.id);
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
        </Card>

        {/* Document Detail Dialog */}
        <Dialog open={!!selectedDoc} onOpenChange={() => setSelectedDoc(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh]">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                {selectedDoc && getFileIcon(selectedDoc.file_type)}
                {selectedDoc?.filename}
              </DialogTitle>
            </DialogHeader>
            {selectedDoc && (
              <Tabs defaultValue="content" className="mt-4">
                <TabsList>
                  <TabsTrigger value="content">Contenu</TabsTrigger>
                  <TabsTrigger value="data">Données extraites</TabsTrigger>
                  <TabsTrigger value="analysis">Analyse IA</TabsTrigger>
                </TabsList>
                <TabsContent value="content">
                  <ScrollArea className="h-[400px] border rounded-lg p-4">
                    <pre className="whitespace-pre-wrap text-sm">
                      {selectedDoc.content_text || "Aucun contenu texte extrait"}
                    </pre>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="data">
                  <ScrollArea className="h-[400px] border rounded-lg p-4">
                    <pre className="text-sm">
                      {JSON.stringify(selectedDoc.extracted_data, null, 2)}
                    </pre>
                  </ScrollArea>
                </TabsContent>
                <TabsContent value="analysis">
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleAnalyze(selectedDoc, "cotation")}
                        disabled={isAnalyzing}
                      >
                        <Sparkles className="h-4 w-4 mr-2" />
                        Analyser comme cotation
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAnalyze(selectedDoc, "douane")}
                        disabled={isAnalyzing}
                      >
                        Analyser comme douane
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleAnalyze(selectedDoc, "bl")}
                        disabled={isAnalyzing}
                      >
                        Analyser comme BL
                      </Button>
                    </div>
                    <ScrollArea className="h-[350px] border rounded-lg p-4">
                      {selectedDoc.extracted_data?.ai_analysis ? (
                        <pre className="text-sm">
                          {JSON.stringify(selectedDoc.extracted_data.ai_analysis, null, 2)}
                        </pre>
                      ) : (
                        <p className="text-muted-foreground text-center py-8">
                          Cliquez sur un bouton d'analyse pour extraire les données
                        </p>
                      )}
                    </ScrollArea>
                  </div>
                </TabsContent>
              </Tabs>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
