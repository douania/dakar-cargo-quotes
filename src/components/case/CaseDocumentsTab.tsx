import React, { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Download, Trash2, Loader2, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";

const DOCUMENT_TYPES = [
  "BL",
  "Facture commerciale",
  "Déclaration douane",
  "DPI",
  "Ordre de transit",
  "Liste de colisage",
  "Autre",
] as const;

interface CaseDocumentsTabProps {
  caseId: string;
}

function formatFileSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function CaseDocumentsTab({ caseId }: CaseDocumentsTabProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [docType, setDocType] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  const { data: documents = [], isLoading } = useQuery({
    queryKey: ["case-documents", caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_documents")
        .select("*")
        .eq("case_id", caseId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, documentType }: { file: File; documentType: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");

      const docId = crypto.randomUUID();
      const safeName = file.name.replace(/[^\w.-]/g, "_");
      const storagePath = `${caseId}/${docId}-${safeName}`;

      // 1. Upload to storage
      const { error: uploadError } = await supabase.storage
        .from("case-documents")
        .upload(storagePath, file);
      if (uploadError) throw uploadError;

      // 2. Insert DB record
      const { error: dbError } = await supabase.from("case_documents").insert({
        id: docId,
        case_id: caseId,
        document_type: documentType,
        file_name: file.name,
        storage_path: storagePath,
        mime_type: file.type || null,
        file_size: file.size,
        uploaded_by: user.id,
      });
      if (dbError) {
        // Rollback storage
        await supabase.storage.from("case-documents").remove([storagePath]);
        throw dbError;
      }

      // 3. Timeline event
      await supabase.from("case_timeline_events").insert({
        case_id: caseId,
        event_type: "document_uploaded",
        actor_type: "user",
        actor_user_id: user.id,
        event_data: { document_type: documentType, file_name: file.name },
      });

      // 4. Extract text via parse-document and store in extracted_text
      try {
        const parseFormData = new FormData();
        parseFormData.append('file', file);
        parseFormData.append('case_document_id', docId);

        const { data: { session } } = await supabase.auth.getSession();
        await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-document`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${session?.access_token}` },
            body: parseFormData,
          }
        );
      } catch (parseErr) {
        console.warn('Text extraction failed (non-blocking):', parseErr);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["case-documents", caseId] });
      toast({ title: "Document ajouté", description: "Le document a été uploadé avec succès." });
      setDialogOpen(false);
      setDocType("");
      setSelectedFile(null);
    },
    onError: (err: any) => {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (doc: { id: string; storage_path: string }) => {
      // DB first (canonical source), then storage
      const { error } = await supabase.from("case_documents").delete().eq("id", doc.id);
      if (error) throw error;
      await supabase.storage.from("case-documents").remove([doc.storage_path]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["case-documents", caseId] });
      toast({ title: "Document supprimé" });
    },
    onError: (err: any) => {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    },
  });

  async function handleDownload(storagePath: string, fileName: string) {
    const { data, error } = await supabase.storage
      .from("case-documents")
      .createSignedUrl(storagePath, 3600);
    if (error || !data?.signedUrl) {
      toast({ title: "Erreur", description: "Impossible de générer le lien.", variant: "destructive" });
      return;
    }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = fileName;
    a.click();
  }

  function handleSubmit() {
    if (!selectedFile || !docType) return;
    uploadMutation.mutate({ file: selectedFile, documentType: docType });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Documents du dossier
        </CardTitle>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Ajouter un document
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Ajouter un document</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <label className="text-sm font-medium mb-1 block">Type de document</label>
                <Select value={docType} onValueChange={setDocType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sélectionner un type" />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">Fichier</label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="block w-full text-sm file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                />
              </div>
              <Button
                onClick={handleSubmit}
                disabled={!selectedFile || !docType || uploadMutation.isPending}
                className="w-full"
              >
                {uploadMutation.isPending ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Upload en cours...</>
                ) : (
                  "Uploader"
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : documents.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            Aucun document attaché à ce dossier.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Nom du fichier</TableHead>
                <TableHead>Taille</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {documents.map((doc: any) => (
                <TableRow key={doc.id}>
                  <TableCell>
                    <Badge variant="outline">{doc.document_type}</Badge>
                  </TableCell>
                  <TableCell className="font-medium max-w-[200px] truncate">
                    {doc.file_name}
                  </TableCell>
                  <TableCell>{formatFileSize(doc.file_size)}</TableCell>
                  <TableCell>
                    {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownload(doc.storage_path, doc.file_name)}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMutation.mutate({ id: doc.id, storage_path: doc.storage_path })}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
