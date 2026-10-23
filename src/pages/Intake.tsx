import React, { useState, useRef, useEffect } from "react";
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
import {
  describeContainerPlan,
  parseTextOverrides,
  resolveContainerPlan,
} from "@/lib/intakeTextOverrides";
import { buildIntakeFactBatch } from "@/lib/intakeFactBatch";
import { extractionPayload } from '@/lib/documentExtraction';

import type { ManualIntakeForm } from "@/services/railwayReplacement/manualIntakeCommand";
import type { ManualFormSession } from "@/services/railwayReplacement/manualIntakeClient";

import {describeIntakeFile} from '@/services/railwayReplacement/intakeDocument';
import {canonicalJson,RecoveryError} from '@/services/railwayReplacement/recoveryContract';
import type {IntakeFileDescriptor,RecoveryOperation} from '@/services/railwayReplacement/recoveryContract';
export interface IntakeDocumentCandidate {
 file:IntakeFileDescriptor|null;busy:boolean;locked:boolean;linked:boolean;warning:string;
 analyze(file:File|null,form:ManualIntakeForm,prefill:(analysis:Record<string,unknown>,preview:string)=>ManualIntakeForm):Promise<{form:ManualIntakeForm;operation:RecoveryOperation}>;
 interrupt():void;
}
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_EXTENSIONS = [".pdf", ".xlsx", ".xls", ".jpg", ".jpeg", ".png", ".csv"];

// Explicit local seam only. App routes never supply this candidate.
export default function Intake({ manualCandidate, restoredForm, restoredResult, documentCandidate }: { manualCandidate?: ManualFormSession; restoredForm?: ManualIntakeForm; restoredResult?: IntakeResponse; documentCandidate?:IntakeDocumentCandidate } = {}) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const candidateSubmission = useRef(false);
  const candidateLocked=Boolean(manualCandidate&&(documentCandidate?documentCandidate.locked:manualCandidate.hasUnresolved()));

  useEffect(() => {
    if (!manualCandidate) return;
    const warnOnUnload = (event: BeforeUnloadEvent) => {
      if (manualCandidate.hasUnresolved()) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warnOnUnload);
    return () => window.removeEventListener("beforeunload", warnOnUnload);
  }, [manualCandidate]);

  // Form state
  const [text, setText] = useState((restoredForm?.request.source as {text?:string})?.text ?? "");
  const [clientName, setClientName] = useState(String(restoredForm?.request.client_name ?? ""));
  const [clientEmail, setClientEmail] = useState(String(restoredForm?.request.client_email ?? ""));
  const [customerRef, setCustomerRef] = useState(String(restoredForm?.request.customer_ref ?? ""));

  // Upload state
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [extractedDocId, setExtractedDocId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [extractionSource, setExtractionSource] = useState<string | null>(restoredForm?.has_extracted_document?documentCandidate?.file?.name??null:null);
  const [extractedAnalysis, setExtractedAnalysis] = useState<Record<string, any> | null>(restoredForm?.analysis??null);

  const selectedFile=uploadedFile??documentCandidate?.file??null;

  // Submit state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [storedResult, setResult] = useState<IntakeResponse | null>(restoredResult ?? null);
  // v5 — gate "Ouvrir le dossier" until critical facts are persisted
  const [criticalInjectionOk, setCriticalInjectionOk] = useState(Boolean(manualCandidate && restoredResult));

  function handleFileSelect(file: File) {
    if (candidateLocked || Boolean(documentCandidate?.file&&extractionSource)) return;
    setError("");
    const ext = "." + file.name.split(".").pop()?.toLowerCase();
    if (!ACCEPTED_EXTENSIONS.includes(ext)) {
      setError(`Format non supporté. Formats acceptés : ${ACCEPTED_EXTENSIONS.join(", ")}`);
      return;
    }
    if (file.size < 1 || file.size > MAX_FILE_SIZE) {
      setError("Fichier vide ou trop volumineux (max 10 MB)");
      return;
    }
    setUploadedFile(file);
    setExtractionSource(null);
    setExtractedDocId(null);
    if(manualCandidate)setExtractedAnalysis(null);
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
    if (candidateLocked || documentCandidate?.file) return;
    setUploadedFile(null);
    setExtractionSource(null);
    setExtractedDocId(null);
    setExtractedAnalysis(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function currentForm():ManualIntakeForm{return {request:{source:{type:'email_text',text},...(clientName?{client_name:clientName}:{}),...(clientEmail?{client_email:clientEmail}:{}),...(customerRef?{customer_ref:customerRef}:{})},analysis:extractedAnalysis,has_extracted_document:Boolean(extractedAnalysis||extractionSource)};}
  function applyForm(form:ManualIntakeForm){setText(String((form.request.source as {text:string}).text));setClientName(String(form.request.client_name??''));setClientEmail(String(form.request.client_email??''));setCustomerRef(String(form.request.customer_ref??''));setExtractedAnalysis(form.analysis);}
  function prefilledForm(extracted:Record<string,unknown>,preview:string):ManualIntakeForm{
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
      ? parts.join("\n") + "\n\n--- Texte brut ---\n" + (preview)
      : preview;

    const form=currentForm();return {...form,request:{...form.request,source:{type:'email_text',text:structuredText},...(extracted.client_name?{client_name:extracted.client_name}:{}),...(extracted.client_email?{client_email:extracted.client_email}:{}),...(extracted.customer_ref?{customer_ref:extracted.customer_ref}:{})},analysis:extracted,has_extracted_document:true};
  }

  async function handleAnalyzeDocument() {
    if (manualCandidate) {
      if(!documentCandidate){setError("Le raccord documentaire n'est pas fourni pour cet écran.");return;}
      if(candidateSubmission.current||documentCandidate.busy)return;
      candidateSubmission.current=true;setAnalyzing(true);setError('');
      try{const value=await documentCandidate.analyze(uploadedFile,currentForm(),(analysis,preview)=>prefilledForm(analysis,preview));applyForm(value.form);setExtractionSource(value.operation.draft.file?.name??null);}
      catch{setError("Traitement du document non confirmé. Vérifiez cette même demande ; aucune relance automatique ni nouveau dossier.");}
      finally{candidateSubmission.current=false;setAnalyzing(false);}
      return;
    }
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

      await extractionPayload(parseData,parseError);

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
        setExtractedAnalysis(extracted);
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

  // Mapping: Railway missing_field name -> resolver checking if data is available
  const FIELD_RESOLVERS: Record<string, (a: Record<string, any>, o: Record<string, any>) => boolean> = {
    "route.origins": (a, o) =>
      !!(o.origin || o.origin_port || a.origin || a.origin_port),
    "route.destinations": (a, o) => {
      // Locally-extracted final destination = absolute priority
      if (o.destination) return true;
      // Inland cue present → require a real local final destination.
      // Do NOT let a.destination (Railway/IA) nor o.pod mask the gap.
      // Dakar must NEVER mask Kaolack.
      if (o.requires_final_destination) return false;
      // Otherwise: Railway/IA destination or POD acceptable as fallback
      return !!(a.destination || o.pod);
    },
    // Fail-closed: an ambiguous container declaration resolves nothing —
    // the question must stay open rather than risk a wrong count.
    "cargo.container_count": (a, o) => resolveContainerPlan(o, a).totalCount >= 1,
    "cargo.weight": (a, o) => !!(a.weight_kg),
    "cargo.commodity": (a, o) => !!(a.commodity || a.cargo_description),
    "cargo.incoterm": (a, o) => !!(a.incoterm || o.incoterm),
  };

  /** Filter missing_fields against already-resolved data */
  function filterMissingFields(
    data: IntakeResponse,
    analysis: Record<string, any>,
    overrides: Record<string, any>
  ): IntakeResponse {
    if (!data.missing_fields || data.missing_fields.length === 0) return data;
    const filteredMissing = data.missing_fields.filter((field: any) => {
      const resolver = FIELD_RESOLVERS[field.field];
      if (resolver && resolver(analysis, overrides)) {
        return false; // resolved, remove
      }
      return true;
    });
    if (filteredMissing.length === data.missing_fields.length) return data;
    return { ...data, missing_fields: filteredMissing };
  }

  /** Correct Railway assumptions using extracted data + operator overrides */
  function correctAssumptions(
    data: IntakeResponse,
    analysis: Record<string, any> | null,
    textOverrides: Record<string, any> = {}
  ): IntakeResponse {
    if (!analysis && Object.keys(textOverrides).length === 0) return data;

    const mergedAnalysis = analysis || {};
    const containerPlan = resolveContainerPlan(textOverrides, mergedAnalysis);
    const weightKg = Number(mergedAnalysis.weight_kg) || 0;
    const requiresFinal = !!textOverrides.requires_final_destination;
    // Safe destination for display: never show Dakar/IA when inland is expected but not extracted
    const destination = textOverrides.destination
      ?? (requiresFinal ? null : (mergedAnalysis.destination ?? null));
    const origin = textOverrides.origin ?? mergedAnalysis.origin ?? null;
    const originPort = textOverrides.origin_port ?? mergedAnalysis.origin_port ?? null;
    const pod = textOverrides.pod ?? null;

    // Always filter missing_fields against available data
    const result = filterMissingFields(data, mergedAnalysis, textOverrides);

    if (containerPlan.totalCount >= 1 && containerPlan.isFcl) {
      // Filter out incorrect "colis lourd" assumptions
      const filtered = (result.assumptions || []).filter(
        (a) => !/colis\s*lourd/i.test(a) && !/heavy.*cargo/i.test(a)
      );

      // Build smart FCL assumptions
      const weightPerContainer = weightKg > 0 ? Math.round(weightKg / containerPlan.totalCount) : null;
      const weightInfo = weightPerContainer
        ? ` (poids total : ${weightKg.toLocaleString("fr-FR")} kg, soit ~${weightPerContainer.toLocaleString("fr-FR")} kg/conteneur)`
        : "";

      // Detail every group: a mixed 20'/40' file must never be summarised
      // by a single type.
      filtered.unshift(
        `${containerPlan.totalCount} conteneur(s) détecté(s) : ${describeContainerPlan(containerPlan)}${weightInfo}`,
        `Mode de transport : Maritime FCL`
      );

      // Show operator correction if override differs from document
      if (
        textOverrides.container_count != null &&
        mergedAnalysis.container_count != null &&
        Number(textOverrides.container_count) !== Number(mergedAnalysis.container_count)
      ) {
        filtered.push(
          `⚠️ Correction opérateur : ${textOverrides.container_count} conteneur(s) (OT originale : ${mergedAnalysis.container_count})`
        );
      }

      // Detect "importation partielle" from the text
      if (/importation\s+partielle/i.test(text)) {
        filtered.push("Importation partielle détectée");
      }

      if (origin) filtered.push(`📦 Origine : ${origin}`);
      if (originPort) filtered.push(`🚢 Port d'embarquement (probable) : ${originPort}`);
      if (pod) filtered.push(`⚓ Port de déchargement : ${pod}`);
      if (destination) {
        filtered.push(`📍 Destination finale : ${destination}`);
      } else if (requiresFinal) {
        filtered.push(`⚠️ Destination finale inland mentionnée mais non extraite — préciser`);
      }

      return { ...result, assumptions: filtered };
    }

    // No container info path — still surface route hints
    const assumptions = [...(result.assumptions || [])];
    if (containerPlan.ambiguous) {
      assumptions.push(
        `⚠️ Conteneurs : déclarations multiples ambiguës dans le texte — aucun conteneur publié, préciser le détail`
      );
    }
    if (origin) assumptions.push(`📦 Origine : ${origin}`);
    if (originPort) assumptions.push(`🚢 Port d'embarquement (probable) : ${originPort}`);
    if (pod) assumptions.push(`⚓ Port de déchargement : ${pod}`);
    if (destination) {
      assumptions.push(`📍 Destination finale : ${destination}`);
    } else if (requiresFinal) {
      assumptions.push(`⚠️ Destination finale inland mentionnée mais non extraite — préciser`);
    }
    if (assumptions.length !== (result.assumptions || []).length) {
      return { ...result, assumptions };
    }

    return result;
  }

  // Apply the same existing display corrections to a recovered immutable receipt.
  // This does not reclassify, change the saved snapshot or write another batch.
  const result = storedResult && storedResult === restoredResult && restoredForm
    ? correctAssumptions(storedResult, restoredForm.analysis, parseTextOverrides((restoredForm.request.source as {text:string}).text))
    : storedResult;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (manualCandidate && (candidateSubmission.current||documentCandidate?.busy)) return;
    candidateSubmission.current = true;
    setError("");
    setLoading(true);
    setCriticalInjectionOk(false);

    try {
      // Raw file recovery is not qualified by this text-only candidate.
      if (manualCandidate && uploadedFile && !documentCandidate?.file) throw new Error("Le raccord local couvre la saisie texte. La reprise du fichier doit encore être validée ; conservez votre document.");
      if(manualCandidate&&uploadedFile&&documentCandidate?.file){const descriptor=documentCandidate.file;const selected=await describeIntakeFile(uploadedFile,descriptor.path.split('/')[0],descriptor.document_id);if(canonicalJson(selected)!==canonicalJson(descriptor))throw new RecoveryError('FILE_CHANGED');}
      const request = {
        source: { type: "email_text" as const, text },
        ...(clientName ? { client_name: clientName } : {}),
        ...(clientEmail ? { client_email: clientEmail } : {}),
        ...(customerRef ? { customer_ref: customerRef } : {}),
      };
      const data: IntakeResponse = manualCandidate
        ? await manualCandidate.submit({ request, analysis: extractedAnalysis, has_extracted_document: Boolean(extractedAnalysis || extractionSource) }) as unknown as IntakeResponse
        : await createIntake(request);

      // Parse text overrides from operator's edits
      const textOverrides = parseTextOverrides(text);

      // Correct assumptions using extracted analysis data + operator overrides
      const correctedData = correctAssumptions(data, extractedAnalysis, textOverrides);

      if (data.case_id) {
        // Step A: create/retrieve the canonical case AND persist every intake
        // fact in one PostgreSQL transaction. The Edge Function calls its RPC
        // under the user's JWT; it never uses set-case-fact or service-role for
        // canonical writes. Railway analysis and document storage remain outside
        // this transaction by design.
        if (!manualCandidate) {
        const factBatch = buildIntakeFactBatch({
          caseId: data.case_id,
          text,
          analysis: extractedAnalysis,
          textOverrides,
          hasExtractedDocument: Boolean(extractedAnalysis || extractionSource),
          workflowKey: data.workflow_key || null,
        });
        const { data: batchData, error: batchError } = await supabase.functions.invoke(
          "set-intake-facts-batch",
          { body: factBatch },
        );
        const batchResult = batchData?.data;
        if (
          batchError ||
          batchData?.ok !== true ||
          batchResult?.case_id !== data.case_id ||
          !Array.isArray(batchResult?.facts) ||
          batchResult.facts.length !== factBatch.facts.length
        ) {
          throw new Error(
            "Création atomique du dossier impossible: " +
            (batchData?.error?.message || batchError?.message || "réponse invalide")
          );
        }

        }

        // The whole canonical batch succeeded (or was replayed identically).
        setResult(correctedData);
        setCriticalInjectionOk(true);

        // Step B: Store uploaded document in case-documents (best-effort, non-blocking)
        if (uploadedFile && !manualCandidate) {
          try {
            const { data: userData } = await supabase.auth.getUser();
            const userId = userData?.user?.id;
            if (!userId) throw new Error('Session non disponible pour conserver le document');
            if (userId) {
              const docId = crypto.randomUUID();
              const safeName = uploadedFile.name.replace(/[^\w.-]/g, "_");
              const storagePath = `${data.case_id}/${docId}-${safeName}`;

              // 1. Upload to storage
              const uploaded = await supabase.storage.from("case-documents").upload(storagePath, uploadedFile);
              if (uploaded.error) throw uploaded.error;

              // 2. Insert case_documents record
              const documentRow = await supabase.from("case_documents").insert({
                id: docId,
                case_id: data.case_id,
                document_type: "Ordre de transit",
                file_name: uploadedFile.name,
                storage_path: storagePath,
                mime_type: uploadedFile.type,
                file_size: uploadedFile.size,
                uploaded_by: userId,
              });
              if (documentRow.error) throw documentRow.error;

              // 3. Timeline event
              await supabase.from("case_timeline_events").insert({
                case_id: data.case_id,
                event_type: "document_uploaded",
                actor_type: "user",
                actor_user_id: userId,
                event_data: { document_type: "Ordre de transit", file_name: uploadedFile.name },
              });

              // 4. DCQ-P0-CASE-DOCUMENT-BACKFILL-BEFORE-PUZZLE v2
              // Populate case_documents.extracted_text via parse-document in
              // case_document_id mode. text_preview is NOT a complete text
              // and must not be reused as such. Best-effort: failure logged,
              // backfill-case-documents will repair on next analysis.
              try {
                const parseFormData = new FormData();
                parseFormData.append("file", uploadedFile);
                parseFormData.append("case_document_id", docId);
                const { data: sessionData } = await supabase.auth.getSession();
                const token = sessionData?.session?.access_token;
                const parseRes = await fetch(
                  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse-document`,
                  {
                    method: "POST",
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                    body: parseFormData,
                  }
                );
                await extractionPayload(await parseRes.json().catch(()=>null),parseRes.ok ? null : new Error('Extraction non confirmée'));
              } catch (parseErr) {
                setError("Dossier créé et document conservé, mais extraction à reprendre depuis les documents du dossier. "+(parseErr as Error).message);
                console.warn(
                  "[Intake] parse-document call threw (non-blocking):",
                  parseErr
                );
              }
            }
          } catch (docErr) {
            setError("Dossier créé, mais ajout du document non confirmé. Conservez votre fichier et reprenez depuis les documents du dossier, sans recréer le dossier.");
            console.warn("[Intake] Post-creation tasks skipped (non-blocking):", docErr);
          }
        }
      } else {
        // No case_id (shouldn't happen), still surface analysis
        setResult(correctedData);
      }
    } catch (err: any) {
      setError(err instanceof RecoveryError&&err.code==='FILE_CHANGED'?"Le fichier sélectionné diffère de l’original enregistré. Choisissez le fichier d’origine.":manualCandidate?.hasUnresolved()
        ? "Enregistrement non confirmé. Gardez cette page et les mêmes informations, puis relancez pour vérifier la même demande. Ne recréez pas un dossier ; une modification doit attendre la résolution."
        : err.message || "Erreur de connexion au serveur");
      setCriticalInjectionOk(false);
    } finally {
      candidateSubmission.current = false;
      setLoading(false);
    }
  }

  function handleViewCase() {
    if (result?.case_id) {
      navigate(`/case/${result.case_id}`);
    }
  }

  function handleReset() {
    if (manualCandidate?.hasUnresolved()) {
      setError("Enregistrement non confirmé. Vérifiez la même demande avant d'en commencer une nouvelle.");
      return;
    }
    manualCandidate?.startNew();
    setResult(null);
    setCriticalInjectionOk(false);
    // startNew has fenced the previous operation. Reset local document state
    // explicitly: clearFile's user-removal guard still sees the previous props.
    if (documentCandidate) {
      setUploadedFile(null);setExtractionSource(null);setExtractedDocId(null);setExtractedAnalysis(null);
      if(fileInputRef.current)fileInputRef.current.value='';
    } else clearFile();
    setError('');
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

        <form noValidate={Boolean(manualCandidate)} onSubmit={handleSubmit} className="space-y-6">
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
              <input ref={fileInputRef} type="file" aria-label="Pièce jointe" className="hidden" accept={ACCEPTED_EXTENSIONS.join(',')} onChange={handleFileInputChange}/>
              {!selectedFile ? (
                <div
                  className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onDrop={handleDrop}
                  onDragOver={(e) => e.preventDefault()}
                  role="button" tabIndex={0} aria-label="Choisir une pièce jointe"
                  onKeyDown={(e)=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();fileInputRef.current?.click();}}}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">
                    Glissez un fichier ici ou <span className="text-primary font-medium">cliquez pour sélectionner</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {ACCEPTED_EXTENSIONS.join(", ")}
                  </p>

                </div>
              ) : (
                <div className={documentCandidate?"flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between p-4 bg-muted/50 rounded-lg":"flex items-center justify-between p-4 bg-muted/50 rounded-lg"}>
                  <div className="flex items-center gap-3">
                    <FileText className="h-6 w-6 text-primary" />
                    <div>
                      <p className="font-medium text-sm break-all">{selectedFile.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(selectedFile.size / 1024).toFixed(0)} KB
                      </p>
                    </div>
                  </div>
                  <div className={documentCandidate?"flex flex-wrap items-center gap-2":"flex items-center gap-2"}>
                    {!extractionSource && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAnalyzeDocument}
                        disabled={analyzing || Boolean(manualCandidate && !documentCandidate) || Boolean(documentCandidate?.busy)}
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
                    {manualCandidate&&!documentCandidate&&<p role="status" className="text-sm text-muted-foreground">Raccord local limité au texte : lecture et reprise des fichiers à valider.</p>}
                    {documentCandidate && <p role="status" className="text-sm text-muted-foreground">{documentCandidate.busy?'Préparation du document en cours…':documentCandidate.linked?'Document rattaché au dossier.':documentCandidate.file?'Document enregistré avec cette demande.':'Fichier sélectionné ; aucun transfert avant votre action.'}</p>}
                    {extractionSource && (
                      <Badge variant="secondary" className="text-xs">
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                        Extrait
                      </Badge>
                    )}
                    <Button type="button" size="icon" variant="ghost" aria-label="Retirer la pièce jointe" disabled={Boolean(documentCandidate?.file)||candidateLocked||analyzing} onClick={clearFile}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
              {documentCandidate?.file&&!extractionSource&&!documentCandidate.linked&&!candidateLocked&&<Button type="button" variant="outline" onClick={()=>fileInputRef.current?.click()}>Choisir le fichier d'origine</Button>}
              {documentCandidate?.file&&!uploadedFile&&!documentCandidate.linked&&<p className="text-sm text-muted-foreground">Le fichier est conservé côté serveur. La reprise vérifie ses octets ; aucun nouveau transfert implicite.</p>}
              {documentCandidate?.busy&&<Button type="button" variant="outline" onClick={documentCandidate.interrupt}>Interrompre et vérifier</Button>}
              {documentCandidate?.warning&&<Alert><AlertDescription>{documentCandidate.warning}</AlertDescription></Alert>}
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
                  readOnly={Boolean(manualCandidate && (loading || analyzing || candidateLocked))}
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
                  readOnly={Boolean(manualCandidate && (loading || analyzing || candidateLocked))}
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
                  readOnly={Boolean(manualCandidate && (loading || analyzing || candidateLocked))}
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
                  readOnly={Boolean(manualCandidate && (loading || analyzing || candidateLocked))}
                onChange={(e) => setText(e.target.value)}
                rows={10}
                placeholder="Exemple: 
Bonjour,

Nous avons besoin d'un transport de Dakar vers Bamako.
Cargo: 10 colis, dont un de 2500kg (dimensions 3m x 2m x 1.5m).
Date souhaitée: 15 janvier 2026.

Merci de nous faire une cotation."
                aria-label="Texte de la demande"
                className="font-mono text-sm resize-none"
              />
            </CardContent>
          </Card>

          {/* Bouton soumettre */}
          <div className="flex justify-end">
            <Button type="submit" disabled={loading || analyzing || Boolean(documentCandidate?.busy) || !text.trim()} size="lg">
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
                  <CheckCircle2 className="h-5 w-5 text-success" />
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
                  <h4 className="font-semibold mb-2 text-warning">Informations manquantes</h4>
                  <ul className="space-y-2">
                    {result.missing_fields.map((field, i) => (
                      <li key={i} className="flex items-start gap-2 p-3 bg-warning/10 rounded-lg">
                        <AlertCircle className="h-5 w-5 text-warning mt-0.5" />
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
                <Button
                  onClick={handleViewCase}
                  disabled={!criticalInjectionOk}
                  title={!criticalInjectionOk ? "Faits critiques non persistés — vérifier les erreurs ci-dessus" : undefined}
                >
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
