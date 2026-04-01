import React, { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Save } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import DesignationSuggestionBlock from "./DesignationSuggestionBlock";

const REFINED_TYPES = [
  "BL", "HBL", "AWB", "Facture compagnie", "Facture terminal", "Facture port",
  "Magasinage", "Surestaries", "Detention", "Demurrage", "Transport local",
  "Proforma", "Avoir", "Note de débit", "Avis d'arrivée", "Liste de colisage",
  "Déclaration douane", "DPI", "Ordre de transit", "Delivery order", "CSTT", "Autre",
] as const;

const EVIDENCE_LEVELS = [
  { value: "official", label: "Officiel", color: "bg-green-100 text-green-800 border-green-300" },
  { value: "observed", label: "Observé", color: "bg-orange-100 text-orange-800 border-orange-300" },
  { value: "to_confirm", label: "À confirmer", color: "bg-muted text-muted-foreground" },
] as const;

const FINANCIAL_PROFILES = [
  { value: "official", label: "Tarif officiel" },
  { value: "surcharge_exceptional", label: "Surcharge exceptionnelle" },
  { value: "tax_accessory", label: "Taxe/accessoire" },
  { value: "mixed", label: "Mixte" },
  { value: "not_applicable", label: "Non applicable" },
] as const;

const EVIDENCE_BASIS_OPTIONS = [
  "same_bl", "same_container", "same_vessel_voyage", "manual_review",
  "facture_observee", "document_officiel", "cross_reference", "operator_confirmed",
] as const;

interface DocumentMetadataEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  caseDocumentId: string;
  caseId: string;
  fileName: string;
}

interface MetadataForm {
  document_type_refined: string;
  document_reference: string;
  invoice_number: string;
  document_date: string;
  bl_number: string;
  hbl_number: string;
  awb_number: string;
  container_numbers: string;
  carrier: string;
  vessel: string;
  voyage: string;
  port_loading: string;
  port_discharge: string;
  emitter: string;
  client: string;
  consignee: string;
  goods_description: string;
  weight_kg: string;
  volume_cbm: string;
  packages: string;
  amount_ht: string;
  amount_ttc: string;
  vat: string;
  currency: string;
  document_financial_profile: string;
  evidence_level: string;
  matching_confidence: number;
  evidence_basis: string[];
  notes_operator: string;
}

const EMPTY_FORM: MetadataForm = {
  document_type_refined: "",
  document_reference: "",
  invoice_number: "",
  document_date: "",
  bl_number: "",
  hbl_number: "",
  awb_number: "",
  container_numbers: "",
  carrier: "",
  vessel: "",
  voyage: "",
  port_loading: "",
  port_discharge: "",
  emitter: "",
  client: "",
  consignee: "",
  goods_description: "",
  weight_kg: "",
  volume_cbm: "",
  packages: "",
  amount_ht: "",
  amount_ttc: "",
  vat: "",
  currency: "XOF",
  document_financial_profile: "not_applicable",
  evidence_level: "to_confirm",
  matching_confidence: 0,
  evidence_basis: [],
  notes_operator: "",
};

function cleanEvidenceBasis(basis: string[]): string[] {
  return [...new Set(basis.map(b => b.trim()).filter(Boolean))];
}

export default function DocumentMetadataEditor({
  open, onOpenChange, caseDocumentId, caseId, fileName,
}: DocumentMetadataEditorProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<MetadataForm>(EMPTY_FORM);

  const { data: existing, isLoading } = useQuery({
    queryKey: ["case-doc-metadata", caseDocumentId],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("case_document_metadata")
        .select("*")
        .eq("case_document_id", caseDocumentId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setForm({
        document_type_refined: existing.document_type_refined ?? "",
        document_reference: existing.document_reference ?? "",
        invoice_number: existing.invoice_number ?? "",
        document_date: existing.document_date ?? "",
        bl_number: existing.bl_number ?? "",
        hbl_number: existing.hbl_number ?? "",
        awb_number: existing.awb_number ?? "",
        container_numbers: (existing.container_numbers ?? []).join(", "),
        carrier: existing.carrier ?? "",
        vessel: existing.vessel ?? "",
        voyage: existing.voyage ?? "",
        port_loading: existing.port_loading ?? "",
        port_discharge: existing.port_discharge ?? "",
        emitter: existing.emitter ?? "",
        client: existing.client ?? "",
        consignee: existing.consignee ?? "",
        goods_description: existing.goods_description ?? "",
        weight_kg: existing.weight_kg?.toString() ?? "",
        volume_cbm: existing.volume_cbm?.toString() ?? "",
        packages: existing.packages?.toString() ?? "",
        amount_ht: existing.amount_ht?.toString() ?? "",
        amount_ttc: existing.amount_ttc?.toString() ?? "",
        vat: existing.vat?.toString() ?? "",
        currency: existing.currency ?? "XOF",
        document_financial_profile: existing.document_financial_profile ?? "not_applicable",
        evidence_level: existing.evidence_level ?? "to_confirm",
        matching_confidence: (existing.matching_confidence ?? 0) * 100,
        evidence_basis: existing.evidence_basis ?? [],
        notes_operator: existing.notes_operator ?? "",
      });
    } else {
      setForm(EMPTY_FORM);
    }
  }, [existing, open]);

  const upsertMutation = useMutation({
    mutationFn: async () => {
      const containerArr = form.container_numbers
        .split(",").map(c => c.trim()).filter(Boolean);
      const cleanedBasis = cleanEvidenceBasis(form.evidence_basis);
      const confidenceStored = form.matching_confidence / 100;

      const payload = {
        case_document_id: caseDocumentId,
        document_type_refined: form.document_type_refined || null,
        document_reference: form.document_reference || null,
        invoice_number: form.invoice_number || null,
        document_date: form.document_date || null,
        bl_number: form.bl_number || null,
        hbl_number: form.hbl_number || null,
        awb_number: form.awb_number || null,
        container_numbers: containerArr.length > 0 ? containerArr : null,
        carrier: form.carrier || null,
        vessel: form.vessel || null,
        voyage: form.voyage || null,
        port_loading: form.port_loading || null,
        port_discharge: form.port_discharge || null,
        emitter: form.emitter || null,
        client: form.client || null,
        consignee: form.consignee || null,
        goods_description: form.goods_description || null,
        weight_kg: form.weight_kg ? parseFloat(form.weight_kg) : null,
        volume_cbm: form.volume_cbm ? parseFloat(form.volume_cbm) : null,
        packages: form.packages ? parseInt(form.packages) : null,
        amount_ht: form.amount_ht ? parseFloat(form.amount_ht) : null,
        amount_ttc: form.amount_ttc ? parseFloat(form.amount_ttc) : null,
        vat: form.vat ? parseFloat(form.vat) : null,
        currency: form.currency || "XOF",
        document_financial_profile: form.document_financial_profile,
        evidence_level: form.evidence_level,
        matching_confidence: confidenceStored > 0 ? confidenceStored : null,
        evidence_basis: cleanedBasis.length > 0 ? cleanedBasis : null,
        notes_operator: form.notes_operator || null,
      };

      if (existing?.id) {
        const { error } = await supabase
          .from("case_document_metadata")
          .update(payload)
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("case_document_metadata")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["case-doc-metadata", caseDocumentId] });
      queryClient.invalidateQueries({ queryKey: ["case-documents", caseId] });
      toast({ title: "Métadonnées enregistrées" });
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Erreur", description: err.message, variant: "destructive" });
    },
  });

  const updateField = (field: keyof MetadataForm, value: any) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const toggleBasis = (val: string) => {
    setForm(prev => ({
      ...prev,
      evidence_basis: prev.evidence_basis.includes(val)
        ? prev.evidence_basis.filter(b => b !== val)
        : [...prev.evidence_basis, val],
    }));
  };

  if (isLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-base">
            Métadonnées — {fileName}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 pt-2">
          {/* Section: Références */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Références</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Type raffiné</Label>
                <Select value={form.document_type_refined} onValueChange={v => updateField("document_type_refined", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {REFINED_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Réf. document</Label>
                <Input className="h-8 text-xs" value={form.document_reference} onChange={e => updateField("document_reference", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">N° facture</Label>
                <Input className="h-8 text-xs" value={form.invoice_number} onChange={e => updateField("invoice_number", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Date document</Label>
                <Input type="date" className="h-8 text-xs" value={form.document_date} onChange={e => updateField("document_date", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">N° BL</Label>
                <Input className="h-8 text-xs" value={form.bl_number} onChange={e => updateField("bl_number", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">N° HBL</Label>
                <Input className="h-8 text-xs" value={form.hbl_number} onChange={e => updateField("hbl_number", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">N° AWB</Label>
                <Input className="h-8 text-xs" value={form.awb_number} onChange={e => updateField("awb_number", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Conteneurs (séparés par virgule)</Label>
                <Input className="h-8 text-xs" value={form.container_numbers} onChange={e => updateField("container_numbers", e.target.value)} placeholder="MSKU1234567, TCLU7654321" />
              </div>
            </div>
          </section>

          {/* Section: Transport */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Transport</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Compagnie</Label>
                <Input className="h-8 text-xs" value={form.carrier} onChange={e => updateField("carrier", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Navire</Label>
                <Input className="h-8 text-xs" value={form.vessel} onChange={e => updateField("vessel", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Voyage</Label>
                <Input className="h-8 text-xs" value={form.voyage} onChange={e => updateField("voyage", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Port chargement</Label>
                <Input className="h-8 text-xs" value={form.port_loading} onChange={e => updateField("port_loading", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Port déchargement</Label>
                <Input className="h-8 text-xs" value={form.port_discharge} onChange={e => updateField("port_discharge", e.target.value)} />
              </div>
            </div>
          </section>

          {/* Section: Parties */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Parties</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Émetteur</Label>
                <Input className="h-8 text-xs" value={form.emitter} onChange={e => updateField("emitter", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Client</Label>
                <Input className="h-8 text-xs" value={form.client} onChange={e => updateField("client", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Consignataire</Label>
                <Input className="h-8 text-xs" value={form.consignee} onChange={e => updateField("consignee", e.target.value)} />
              </div>
            </div>
          </section>

          {/* Section: Marchandise */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Marchandise</h3>
            <div className="space-y-2">
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea className="text-xs min-h-[50px]" value={form.goods_description} onChange={e => updateField("goods_description", e.target.value)} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Poids (kg)</Label>
                  <Input type="number" className="h-8 text-xs" value={form.weight_kg} onChange={e => updateField("weight_kg", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Volume (m³)</Label>
                  <Input type="number" className="h-8 text-xs" value={form.volume_cbm} onChange={e => updateField("volume_cbm", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Colis</Label>
                  <Input type="number" className="h-8 text-xs" value={form.packages} onChange={e => updateField("packages", e.target.value)} />
                </div>
              </div>
            </div>
          </section>

          {/* Section: Montants */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Montants</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Montant HT</Label>
                <Input type="number" className="h-8 text-xs" value={form.amount_ht} onChange={e => updateField("amount_ht", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Montant TTC</Label>
                <Input type="number" className="h-8 text-xs" value={form.amount_ttc} onChange={e => updateField("amount_ttc", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">TVA</Label>
                <Input type="number" className="h-8 text-xs" value={form.vat} onChange={e => updateField("vat", e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Devise</Label>
                <Input className="h-8 text-xs" value={form.currency} onChange={e => updateField("currency", e.target.value)} />
              </div>
            </div>
          </section>

          {/* Section: Traçabilité */}
          <section>
            <h3 className="text-sm font-semibold text-muted-foreground mb-3">Traçabilité</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Profil financier</Label>
                  <Select value={form.document_financial_profile} onValueChange={v => updateField("document_financial_profile", v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FINANCIAL_PROFILES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Niveau de preuve</Label>
                  <Select value={form.evidence_level} onValueChange={v => updateField("evidence_level", v)}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {EVIDENCE_LEVELS.map(e => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-xs">Confiance matching : {form.matching_confidence}%</Label>
                <Slider
                  value={[form.matching_confidence]}
                  onValueChange={([v]) => updateField("matching_confidence", v)}
                  max={100}
                  step={5}
                  className="mt-1"
                />
              </div>

              <div>
                <Label className="text-xs">Bases de preuve</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {EVIDENCE_BASIS_OPTIONS.map(opt => (
                    <Badge
                      key={opt}
                      variant={form.evidence_basis.includes(opt) ? "default" : "outline"}
                      className="cursor-pointer text-xs"
                      onClick={() => toggleBasis(opt)}
                    >
                      {opt}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs">Notes opérateur</Label>
                <Textarea className="text-xs min-h-[50px]" value={form.notes_operator} onChange={e => updateField("notes_operator", e.target.value)} />
              </div>
            </div>
          </section>

          <Button onClick={() => upsertMutation.mutate()} disabled={upsertMutation.isPending} className="w-full">
            {upsertMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            Enregistrer
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
