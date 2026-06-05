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
import { Plus, Download, Trash2, Loader2, FileText, Pencil, Mail, RefreshCw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import DocumentMetadataEditor from "./DocumentMetadataEditor";

const DOCUMENT_TYPES = [
  "BL", "HBL", "AWB",
  "Facture compagnie", "Facture terminal", "Facture port",
  "Magasinage", "Surestaries", "Detention", "Demurrage",
  "Transport local", "Proforma", "Avoir", "Note de débit",
  "Avis d'arrivée", "Liste de colisage", "Déclaration douane",
  "DPI", "Ordre de transit", "Delivery order", "CSTT", "Autre",
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

function EvidenceBadge({ level }: { level?: string | null }) {
  if (!level) return null;
  const config: Record<string, { label: string; className: string }> = {
    official: { label: "Officiel", className: "bg-green-100 text-green-800 border-green-300" },
    observed: { label: "Observé", className: "bg-orange-100 text-orange-800 border-orange-300" },
    to_confirm: { label: "À confirmer", className: "bg-muted text-muted-foreground" },
  };
  const c = config[level] ?? config.to_confirm;
  return <Badge variant="outline" className={`text-[10px] ${c.className}`}>{c.label}</Badge>;
}

function PivotRef({ meta }: { meta: any }) {
  if (!meta) return <span className="text-muted-foreground text-xs">—</span>;
  const parts: string[] = [];
  if (meta.bl_number) parts.push(`BL: ${meta.bl_number}`);
  else if (meta.hbl_number) parts.push(`HBL: ${meta.hbl_number}`);
  else if (meta.awb_number) parts.push(`AWB: ${meta.awb_number}`);
  if (meta.carrier) parts.push(meta.carrier);
  if (parts.length === 0 && meta.document_reference) parts.push(meta.document_reference);
  if (parts.length === 0) return <span className="text-muted-foreground text-xs">—</span>;
  return <span className="text-xs">{parts.join(" · ")}</span>;
}

interface EmailAttachmentRow {
  id: string;
  filename: string;
  content_type: string | null;
  size: number | null;
  storage_path: string | null;
  from_address: string;
  sent_at: string | null;
  subject: string | null;
  is_analyzed: boolean | null;
  extracted_data: any | null;
}

function AnalysisBadge({ att }: { att: EmailAttachmentRow }) {
  if (!att.storage_path) {
    return <Badge variant="outline" className="text-[10px] bg-orange-100 text-orange-800 border-orange-300">Non téléchargée</Badge>;
  }
  const extractedType = typeof att.extracted_data?.type === "string"
    ? att.extracted_data.type.toLowerCase()
    : "";
  if (extractedType === "skipped") {
    return <Badge variant="outline" className="text-[10px] bg-slate-100 text-slate-800 border-slate-300">Ignorée</Badge>;
  }
  if (extractedType.includes("error")) {
    return <Badge variant="destructive" className="text-[10px]">Erreur</Badge>;
  }
  if (extractedType === "unsupported") {
    return <Badge variant="secondary" className="text-[10px]">Non supporté</Badge>;
  }
  if (att.is_analyzed === false) {
    return <Badge variant="outline" className="text-[10px] bg-yellow-100 text-yellow-800 border-yellow-300">À analyser</Badge>;
  }
  if (att.is_analyzed === true) {
    return <Badge variant="outline" className="text-[10px] bg-green-100 text-green-800 border-green-300">Analysée</Badge>;
  }
  return <Badge variant="secondary" className="text-[10px]">Inconnu</Badge>;
}

function useEmailAttachmentsForCase(caseId: string) {
  return useQuery({
    queryKey: ["case-email-attachments", caseId],
    queryFn: async (): Promise<EmailAttachmentRow[]> => {
      // Step 1: get thread_id from quote_cases
      const { data: caseData, error: caseErr } = await supabase
        .from("quote_cases")
        .select("thread_id")
        .eq("id", caseId)
        .single();
      if (caseErr || !caseData?.thread_id) return [];

      // Step 2: get emails in thread
      const { data: emails, error: emailErr } = await supabase
        .from("emails")
        .select("id, from_address, sent_at, subject")
        .eq("thread_ref", caseData.thread_id)
        .order("sent_at", { ascending: true });
      if (emailErr || !emails?.length) return [];

      const emailIds = emails.map(e => e.id);
      const emailMap = Object.fromEntries(emails.map(e => [e.id, e]));

      // Step 3: get all attachments (including those not yet downloaded to storage)
      const { data: attachments, error: attErr } = await supabase
        .from("email_attachments")
        .select("id, email_id, filename, content_type, size, storage_path, is_analyzed, extracted_data")
        .in("email_id", emailIds);
      if (attErr || !attachments?.length) return [];

      // Filter out inline/signatures (small images, common signature patterns)
      return attachments
        .filter(att => {
          const name = att.filename?.toLowerCase() ?? "";
          const isImage = att.content_type?.toLowerCase().startsWith("image/") ?? false;
          const hasSignatureName = /(^|[-_.\s])(logo|signature|banner|footer|spacer)([-_.\s]|\d|$)/i.test(name);
          if (isImage && hasSignatureName) return false;
          if (isImage && att.size != null && att.size < 8000) return false;
          return true;
        })
        .map(att => {
          const email = emailMap[att.email_id!];
          return {
            id: att.id,
            filename: att.filename,
            content_type: att.content_type,
            size: att.size,
            storage_path: att.storage_path,
            from_address: email?.from_address ?? "—",
            sent_at: email?.sent_at ?? null,
            subject: email?.subject ?? null,
            is_analyzed: att.is_analyzed ?? null,
            extracted_data: att.extracted_data ?? null,
          };
        });
    },
  });
}

export default function CaseDocumentsTab({ caseId }: CaseDocumentsTabProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [docType, setDocType] = useState<string>("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editingFileName, setEditingFileName] = useState("");
  const [retryingAttachmentId, setRetryingAttachmentId] = useState<string | null>(null);

  // Manual documents
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

  const docIds = documents.map((d: any) => d.id);
  const { data: metadataMap = {} } = useQuery({
    queryKey: ["case-documents-metadata", caseId, docIds],
    enabled: docIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_document_metadata")
        .select("*")
        .in("case_document_id", docIds);
      if (error) throw error;
      const map: Record<string, any> = {};
      (data ?? []).forEach((m: any) => { map[m.case_document_id] = m; });
      return map;
    },
  });

  // Email attachments (light bridge)
  const { data: emailAttachments = [], isLoading: isLoadingEmailAtt } = useEmailAttachmentsForCase(caseId);

  const uploadMutation = useMutation({
    mutationFn: async ({ file, documentType }: { file: File; documentType: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Non authentifié");

      const docId = crypto.randomUUID();
      const safeName = file.name.replace(/[^\w.-]/g, "_");
      const storagePath = `${caseId}/${docId}-${safeName}`;

      const { error: uploadError } = await supabase.storage
        .from("case-documents")
        .upload(storagePath, file);
      if (uploadError) throw uploadError;

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
        await supabase.storage.from("case-documents").remove([storagePath]);
        throw dbError;
      }

      await supabase.from("case_timeline_events").insert({
        case_id: caseId,
        event_type: "document_uploaded",
        actor_type: "user",
        actor_user_id: user.id,
        event_data: { document_type: documentType, file_name: file.name },
      });

      try {
        const parseFormData = new FormData();
        parseFormData.append('file', file);
        parseFormData.append('case_document_id', docId);

        const { data: { session } } = await supabase.auth.getSession();
        const parseRes = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-document`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${session?.access_token}` },
            body: parseFormData,
          }
        );
        if (!parseRes.ok) {
          const errBody = await parseRes.text().catch(() => '');
          console.error('parse-document failed:', parseRes.status, errBody);
          throw new Error(`parse-document HTTP ${parseRes.status}: ${errBody || 'no body'}`);
        }
        console.log('parse-document ok for', docId);
      } catch (parseErr) {
        console.warn('Text extraction failed (non-blocking):', parseErr);
        toast({ title: "Extraction texte échouée", description: "Vous pouvez relancer via backfill.", variant: "destructive" });
      }
    },
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["case-documents", caseId] });
      queryClient.invalidateQueries({ queryKey: ["case-documents-count", caseId] });
      toast({ title: "Document ajouté", description: "Le document a été uploadé avec succès." });

      try {
        const { error } = await supabase.functions.invoke("build-case-puzzle", {
          body: { case_id: caseId },
        });
        if (error) throw error;

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["case-view", caseId] }),
          queryClient.invalidateQueries({ queryKey: ["case-facts", caseId] }),
          queryClient.invalidateQueries({ queryKey: ["case-gaps", caseId] }),
          queryClient.invalidateQueries({ queryKey: ["case-timeline", caseId] }),
          queryClient.invalidateQueries({ queryKey: ["quote-request-lines", caseId] }),
          queryClient.invalidateQueries({ queryKey: ["cockpit-state", caseId] }),
        ]);
        toast({ title: "Analyse terminée", description: "Le dossier a été réanalysé. Vérifiez l'onglet Faits." });
      } catch (e) {
        console.warn("Auto build-case-puzzle after upload failed:", e);
        toast({ title: "Analyse automatique échouée", description: "Utilisez le bouton 'Relancer l'analyse'.", variant: "destructive" });
      }

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
      const { error } = await supabase.from("case_documents").delete().eq("id", doc.id);
      if (error) throw error;
      await supabase.storage.from("case-documents").remove([doc.storage_path]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["case-documents", caseId] });
      queryClient.invalidateQueries({ queryKey: ["case-documents-metadata", caseId] });
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

  async function handleDownloadEmailAttachment(storagePath: string, fileName: string) {
    const { data, error } = await supabase.storage
      .from("documents")
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

  async function handleRetryEmailAttachment(att: EmailAttachmentRow) {
    setRetryingAttachmentId(att.id);
    try {
      const { data: resetId, error: resetError } = await supabase.rpc("reset_attachment_for_retry", {
        p_attachment_id: att.id,
      });

      if (resetError || !resetId) {
        toast({
          title: "Erreur",
          description: resetError?.message ?? "Pièce jointe non réinitialisée.",
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Pièce jointe réinitialisée, analyse relancée…", description: att.filename });

      const { data: analyzeData, error: analyzeError } = await supabase.functions.invoke("analyze-attachments", {
        body: { attachmentId: att.id, background: false, mode: "sync" },
      });

      if (analyzeError || analyzeData?.success === false) {
        toast({
          title: "Erreur",
          description: analyzeError?.message ?? analyzeData?.error ?? "Analyse échouée.",
          variant: "destructive",
        });
        return;
      }

      const { error: puzzleError } = await supabase.functions.invoke("build-case-puzzle", {
        body: { case_id: caseId, force_refresh: true },
      });

      if (puzzleError) {
        toast({
          title: "Attention",
          description: `Analyse terminée, mais puzzle non relancé: ${puzzleError.message}`,
        });
        return;
      }

      toast({ title: "Analyse terminée, puzzle relancé" });
    } catch (e: any) {
      toast({
        title: "Erreur",
        description: e?.message ?? "Re-analyse échouée.",
        variant: "destructive",
      });
    } finally {
      setRetryingAttachmentId(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["case-email-attachments", caseId] }),
        queryClient.invalidateQueries({ queryKey: ["case-view", caseId] }),
        queryClient.invalidateQueries({ queryKey: ["case-facts", caseId] }),
        queryClient.invalidateQueries({ queryKey: ["case-gaps", caseId] }),
        queryClient.invalidateQueries({ queryKey: ["case-timeline", caseId] }),
        queryClient.invalidateQueries({ queryKey: ["quote-request-lines", caseId] }),
        queryClient.invalidateQueries({ queryKey: ["cockpit-state", caseId] }),
      ]);
    }
  }

  function handleSubmit() {
    if (!selectedFile || !docType) return;
    uploadMutation.mutate({ file: selectedFile, documentType: docType });
  }

  const allLoading = isLoading || isLoadingEmailAtt;
  const hasNoDocs = documents.length === 0 && emailAttachments.length === 0;

  return (
    <>
      {/* Manual documents section */}
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
          {allLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : documents.length === 0 && emailAttachments.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              Aucun document attaché à ce dossier.
            </p>
          ) : documents.length === 0 ? (
            <p className="text-muted-foreground text-center py-4 text-sm">
              Aucun document manuel. Voir les pièces jointes email ci-dessous.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Nom du fichier</TableHead>
                  <TableHead>Réf. pivot</TableHead>
                  <TableHead>Evidence</TableHead>
                  <TableHead>Taille</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-28">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc: any) => {
                  const meta = (metadataMap as Record<string, any>)[doc.id];
                  return (
                    <TableRow key={doc.id}>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px]">
                          {meta?.document_type_refined || doc.document_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium max-w-[180px] truncate text-xs">
                        {doc.file_name}
                      </TableCell>
                      <TableCell><PivotRef meta={meta} /></TableCell>
                      <TableCell><EvidenceBadge level={meta?.evidence_level} /></TableCell>
                      <TableCell className="text-xs">{formatFileSize(doc.file_size)}</TableCell>
                      <TableCell className="text-xs">
                        {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setEditingDocId(doc.id);
                              setEditingFileName(doc.file_name);
                            }}
                            title="Éditer métadonnées"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
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
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Email attachments section (light bridge — read-only) */}
      {!allLoading && emailAttachments.length > 0 && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Mail className="h-5 w-5" />
              Pièces jointes email
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {emailAttachments.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Nom du fichier</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Taille</TableHead>
                  <TableHead>Analyse</TableHead>
                  <TableHead>Expéditeur</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-36">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emailAttachments.map((att) => {
                  const extractedType = typeof att.extracted_data?.type === "string"
                    ? att.extracted_data.type.toLowerCase()
                    : "";
                  const canRetry =
                    Boolean(att.storage_path) &&
                    (
                      att.is_analyzed === false ||
                      extractedType.includes("error") ||
                      extractedType === "skipped" ||
                      att.is_analyzed === null
                    );
                  const isRetrying = retryingAttachmentId === att.id;
                  return (
                    <TableRow key={att.id}>
                      <TableCell>
                        <Badge className="bg-blue-100 text-blue-800 border-blue-300 text-[10px]" variant="outline">
                          Email
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium max-w-[180px] truncate text-xs">
                        {att.filename}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {att.content_type?.split("/").pop() ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs">{formatFileSize(att.size)}</TableCell>
                      <TableCell><AnalysisBadge att={att} /></TableCell>
                      <TableCell className="text-xs max-w-[140px] truncate" title={att.from_address}>
                        {att.from_address.split("@")[0]}
                      </TableCell>
                      <TableCell className="text-xs">
                        {att.sent_at ? new Date(att.sent_at).toLocaleDateString() : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {att.storage_path && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleDownloadEmailAttachment(att.storage_path!, att.filename)}
                              title="Télécharger"
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          )}
                          {canRetry && (
                            <Button
                              variant="outline"
                              size="sm"
                              title="Re-analyser"
                              disabled={isRetrying}
                              onClick={() => handleRetryEmailAttachment(att)}
                              className="h-8 px-2 text-xs"
                            >
                              {isRetrying ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <RefreshCw className="mr-1 h-3 w-3" />
                              )}
                              Re-analyser
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {editingDocId && (
        <DocumentMetadataEditor
          open={!!editingDocId}
          onOpenChange={(open) => { if (!open) setEditingDocId(null); }}
          caseDocumentId={editingDocId}
          caseId={caseId}
          fileName={editingFileName}
        />
      )}
    </>
  );
}
