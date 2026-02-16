import React, { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useNavigate } from "react-router-dom";
import { 
  FileText, 
  Send, 
  AlertCircle, 
  CheckCircle2, 
  Loader2,
  ArrowRight,
  Building2,
  Mail,
  Hash,
  Upload,
  FileUp,
  X
} from "lucide-react";
import { createIntake, type IntakeResponse } from "@/services/railwayApi";
import { WORKFLOW_LABELS } from "@/features/quotation/constants";
import { MainLayout } from "@/components/layout/MainLayout";
import { supabase } from "@/integrations/supabase/client";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".jpg", ".jpeg", ".png", ".csv"];

export default function Intake() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [text, setText] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [customerRef, setCustomerRef] = useState("");

  // Upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [extractedDocId, setExtractedDocId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [extractionSource, setExtractionSource] = useState<string | null>(null);

  // Submit state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<IntakeResponse | null>(null);

  function handleFileSelect(file: File) {
    setError("");
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setError(`Format non supporté. Formats acceptés : ${ACCEPTED_EXTENSIONS.join(", ")}`);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError("Fichier trop volumineux (max 10 MB)");
      return;
    }
    setUploadedFile(file);
    setExtractionSource(null);
    setExtractedDocId(null);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
  }

  function clearFile() {
    setUploadedFile(null);
    setExtractionSource(null);
    setExtractedDocId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleAnalyzeDocument() {
    if (!uploadedFile) return;
    setAnalyzing(true);
    setError("");

    try {
      // Step 1: parse-document (extraction texte)
      const formData = new FormData();
      formData.append("file", uploadedFile);

      const { data: parseData, error: parseError } = await supabase.functions.invoke(
        "parse-document",
        { body: formData }
      );

      if (parseError || !parseData?.success) {
        throw new Error(parseError?.message || parseData?.error || "Erreur lors de l'extraction du texte");
      }

      const documentId = parseData.document.id;
      setExtractedDocId(documentId);

      // Step 2: analyze-document with analysisType = transit_order
      const { data: analyzeData, error: analyzeError } = await supabase.functions.invoke(
        "analyze-document",
        { body: { documentId, analysisType: "transit_order" } }
      );

      if (analyzeError || !analyzeData?.success) {
        // Even if analysis fails, we have the raw text
        setText(parseData.document.text_preview || "");
        setExtractionSource(uploadedFile.name);
        throw new Error(analyzeError?.message || analyzeData?.error || "Erreur lors de l'analyse IA");
      }

      // Step 3: Pre-fill form with extracted data
      const extracted = analyzeData.analysis;
      if (extracted) {
        if (extracted.client_name) setClientName(extracted.client_name);
        if (extracted.client_email) setClientEmail(extracted.client_email);
        if (extracted.customer_ref) setCustomerRef(extracted.customer_ref);

        // Build rich text summary for the main text field
        const parts: string[] = [];
        if (extracted.cargo_description) parts.push(`Marchandise : ${extracted.cargo_description}`);
        if (extracted.origin) parts.push(`Origine : ${extracted.origin}`);
        if (extracted.destination) parts.push(`Destination : ${extracted.destination}`);
        if (extracted.weight_kg) parts.push(`Poids : ${extracted.weight_kg} kg`);
        if (extracted.volume_cbm) parts.push(`Volume : ${extracted.volume_cbm} m³`);
        if (extracted.nb_pieces) parts.push(`Colis : ${extracted.nb_pieces}`);
        if (extracted.container_type) parts.push(`Conteneur : ${extracted.container_type}`);
        if (extracted.container_count) parts.push(`Nb conteneurs : ${extracted.container_count}`);
        if (extracted.incoterm) parts.push(`Incoterm : ${extracted.incoterm}`);
        if (extracted.transport_mode && extracted.transport_mode !== "unknown") parts.push(`Mode : ${extracted.transport_mode}`);
        if (extracted.special_instructions) parts.push(`Instructions : ${extracted.special_instructions}`);

        const structuredText = parts.length > 0
          ? parts.join("\n") + "\n\n--- Texte brut ---\n" + (parseData.document.text_preview || "")
          : parseData.document.text_preview || "";

        setText(structuredText);
      } else {
        setText(parseData.document.text_preview || "");
      }

      setExtractionSource(uploadedFile.name);
    } catch (err: any) {
      setError(err.message || "Erreur lors de l'analyse du document");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const data = await createIntake({
        source: { type: "email_text", text },
        client_name: clientName || undefined,
        client_email: clientEmail || undefined,
        customer_ref: customerRef || undefined,
      });

      setResult(data);

      // Post-creation: store uploaded document in case-documents (Lovable Cloud)
      // Note: This might fail if the case created in Railway isn't yet synced in Lovable Cloud quote_cases table
      if (uploadedFile && data.case_id) {
        try {
          const { data: userData } = await supabase.auth.getUser();
          const userId = userData?.user?.id;
          if (!userId) return; // Silent skip if not authenticated

          // Check if case exists in Lovable Cloud to avoid FK violations
          const { data: existingCase } = await supabase
            .from("quote_cases")
            .select("id")
            .eq("id", data.case_id)
            .maybeSingle();

          if (!existingCase) {
            console.warn("Case sync pending: skipped document attachment to Supabase");
            return;
          }

          const docId = crypto.randomUUID();
          const safeName = uploadedFile.name.replace(/[^\w.-]/g, "_");
          const storagePath = `${data.case_id}/${docId}-${safeName}`;

          // 1. Upload to storage
          await supabase.storage.from("case-documents").upload(storagePath, uploadedFile);

          // 2. Insert case_documents record
          await supabase.from("case_documents").insert({
            id: docId,
            case_id: data.case_id,
            document_type: "Ordre de transit",
            file_name: uploadedFile.name,
            storage_path: storagePath,
            mime_type: uploadedFile.type,
            file_size: uploadedFile.size,
            uploaded_by: userId,
          });

          // 3. Timeline event (Note: Check RLS policies if 403 occurs)
          await supabase.from("case_timeline_events").insert({
            case_id: data.case_id,
            event_type: "document_uploaded",
            actor_type: "user",
            actor_user_id: userId,
            event_data: { document_type: "Ordre de transit", file_name: uploadedFile.name },
          });
        } catch (docErr) {
          // Robust guard to prevent breaking the main flow
          console.warn("Post-creation tasks skipped (non-blocking):", docErr);
        }
      }
    } catch (err: any) {
      setError(err.message || "Erreur de connexion au serveur");
    } finally {
      setLoading(false);
    }
  }

  function handleViewCase() {
    if (result?.case_id) {
      navigate(`/case/${result.case_id}`);
    }
  }

  function handleReset() {
    setResult(null);
    clearFile();
    setText("");
    setClientName("");
    setClientEmail("");
    setCustomerRef("");
  }

  return (
    <MainLayout>
      <div className="container mx-auto py-8 px-4 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-3">
            <FileText className="h-8 w-8 text-primary" />
            Nouvelle Demande de Cotation
          </h1>
          <p className="text-muted-foreground mt-2">
            Uploadez un ordre de transit ou collez le texte de la demande pour analyse automatique.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Upload Document */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload d'un Ordre de Transit
              </CardTitle>
              <CardDescription>
                PDF, Excel, Image ou CSV — max 10 MB. L'IA analysera le document pour pré-remplir la demande.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!uploadedFile ? (
                <div
                  className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">
                    Glissez un fichier ici ou <span className="text-primary font-medium">cliquez pour sélectionner</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {ACCEPTED_EXTENSIONS.join(", ")}
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept={ACCEPTED_EXTENSIONS.join(",")}
                    onChange={handleFileInputChange}
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <FileText className="h-6 w-6 text-primary" />
                    <div>
                      <p className="font-medium text-sm">{uploadedFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(uploadedFile.size / 1024).toFixed(0)} KB
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!extractionSource && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAnalyzeDocument}
                        disabled={analyzing}
                      >
                        {analyzing ? (
                          <>
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                            Analyse...
                          </>
                        ) : (
                          "Analyser le document"
                        )}
                      </Button>
                    )}
                    {extractionSource && (
                      <Badge variant="secondary" className="text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Extrait
                      </Badge>
                    )}
                    <Button type="button" size="icon" variant="ghost" onClick={clearFile}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Informations client */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Informations Client (optionnel)</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="clientName" className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Nom du client
                </Label>
                <Input
                  id="clientName"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="SODATRA"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="clientEmail" className="flex items-center gap-2">
                  <Mail className="h-4 w-4" /> Email
                </Label>
                <Input
                  id="clientEmail"
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="contact@client.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="customerRef" className="flex items-center gap-2">
                  <Hash className="h-4 w-4" /> Référence client
                </Label>
                <Input
                  id="customerRef"
                  value={customerRef}
                  onChange={(e) => setCustomerRef(e.target.value)}
                  placeholder="REF-2025-001"
                />
              </div>
            </CardContent>
          </Card>

          {/* Texte de la demande */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Texte de la Demande</CardTitle>
                  <CardDescription>
                    Collez ici l'email, les notes ou toute description de la demande de transport
                  </CardDescription>
                </div>
                {extractionSource && (
                  <Badge variant="outline" className="text-xs">
                    Extrait de : {extractionSource}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                placeholder="Exemple: 
Bonjour,

Nous avons besoin d'un transport de Dakar vers Bamako.
Cargo: 10 colis, dont un de 2500kg (dimensions 3m x 2m x 1.5m).
Date souhaitée: 15 janvier 2026.

Merci de nous faire une cotation."
                className="font-mono text-sm"
              />
            </CardContent>
          </Card>

          {/* Bouton soumettre */}
          <div className="flex justify-end">
            <Button type="submit" disabled={loading || !text.trim()} size="lg">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Analyse en cours...
                </>
              ) : (
                <>
                  <Send className="mr-2 h-5 w-5" />
                  Analyser la demande
                </>
              )}
            </Button>
          </div>
        </form>

        {/* Erreur */}
        {error && (
          <Alert variant="destructive" className="mt-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Résultat */}
        {result && (
          <Card className="mt-6 border-2 border-primary/20">
            <CardHeader className="bg-primary/5">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  Analyse terminée
                </CardTitle>
                <Badge className={WORKFLOW_LABELS[result.workflow_key]?.color || "bg-muted"}>
                  {WORKFLOW_LABELS[result.workflow_key]?.label || result.workflow_key}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">
              {/* KPIs */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary">{result.complexity_level}</div>
                  <div className="text-sm text-muted-foreground">Niveau de complexité</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary">{Math.round(result.confidence * 100)}%</div>
                  <div className="text-sm text-muted-foreground">Confiance</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary">{result.missing_fields.length}</div>
                  <div className="text-sm text-muted-foreground">Champs manquants</div>
                </div>
                <div className="text-center p-4 bg-muted/50 rounded-lg">
                  <div className="text-2xl font-bold text-primary">{result.status}</div>
                  <div className="text-sm text-muted-foreground">Statut</div>
                </div>
              </div>

              {/* Champs manquants */}
              {result.missing_fields.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2 text-orange-700">Informations manquantes</h4>
                  <ul className="space-y-2">
                    {result.missing_fields.map((field, i) => (
                      <li key={i} className="flex items-start gap-2 p-3 bg-orange-50 rounded-lg">
                        <AlertCircle className="h-5 w-5 text-orange-500 mt-0.5" />
                        <div>
                          <div className="font-medium">{field.question}</div>
                          <div className="text-sm text-muted-foreground">Champ: {field.field}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Hypothèses */}
              {result.assumptions && result.assumptions.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Hypothèses détectées</h4>
                  <ul className="list-disc list-inside text-muted-foreground">
                    {result.assumptions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Route détectée */}
              {result.normalized_request?.route && (
                <div>
                  <h4 className="font-semibold mb-2">Route détectée</h4>
                  <div className="flex items-center gap-4 text-muted-foreground">
                    <span className="font-medium">
                      {result.normalized_request.route.origins?.[0]?.name || "?"}
                    </span>
                    <ArrowRight className="h-4 w-4" />
                    <span className="font-medium">
                      {result.normalized_request.route.destinations?.[0]?.name || "?"}
                    </span>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex justify-end gap-4 pt-4 border-t">
                <Button variant="outline" onClick={handleReset}>
                  Nouvelle analyse
                </Button>
                <Button onClick={handleViewCase}>
                  Ouvrir le dossier
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </MainLayout>
  );
}
