import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { 
  FileText, 
  Download, 
  Loader2,
  CheckCircle2,
  AlertCircle,
  Ship,
  Truck,
  Package
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface TenderSegment {
  id: string;
  segment_order: number;
  segment_type: string;
  origin_location: string;
  destination_location: string;
  partner_company: string | null;
  rate_per_unit: number | null;
  rate_unit: string | null;
  currency: string;
  status: string;
}

interface TenderContingent {
  id: string;
  contingent_name: string;
  origin_location: string | null;
  destination_port: string | null;
  destination_site: string | null;
  cargo_teus: number | null;
  cargo_vehicles: number | null;
  cargo_tonnes: number | null;
  cargo_cbm: number | null;
  deadline_ddd: string | null;
  status: string | null;
  total_cost_estimate: number | null;
  selling_price: number | null;
  margin_percent?: number | null;
}

interface TenderOfferGeneratorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tender: {
    id: string;
    reference: string;
    client: string | null;
    origin_country: string | null;
    deadline: string | null;
  } | null;
  segments: TenderSegment[];
  contingents: TenderContingent[];
}

export function TenderOfferGenerator({
  open,
  onOpenChange,
  tender,
  segments,
  contingents,
}: TenderOfferGeneratorProps) {
  const [marginPercent, setMarginPercent] = useState(15);
  const [validityDays, setValidityDays] = useState(30);
  const [additionalTerms, setAdditionalTerms] = useState('');

  // Calculate totals
  const confirmedSegments = segments.filter(s => s.status === 'confirmed' && s.rate_per_unit);
  const pendingSegments = segments.filter(s => s.status !== 'confirmed' || !s.rate_per_unit);
  
  const totalSegmentsCost = confirmedSegments.reduce((sum, s) => sum + (s.rate_per_unit || 0), 0);
  
  const calculateContingentCost = (contingent: TenderContingent) => {
    // Simplified: multiply segment rates by cargo volume
    const baseMultiplier = contingent.cargo_teus || (contingent.cargo_cbm ? contingent.cargo_cbm / 30 : 1) || 1;
    return totalSegmentsCost * baseMultiplier;
  };

  const totalCost = contingents.reduce((sum, c) => sum + calculateContingentCost(c), 0);
  const totalWithMargin = totalCost * (1 + marginPercent / 100);

  const generateOffer = () => {
    if (pendingSegments.length > 0) {
      toast.error(`${pendingSegments.length} segments n'ont pas de tarifs confirmés`);
      return;
    }

    // Generate offer document (simplified - would typically call an edge function)
    const offerContent = generateOfferContent();
    downloadAsText(offerContent, `Offre_${tender?.reference || 'tender'}.txt`);
    toast.success('Offre générée avec succès');
    onOpenChange(false);
  };

  const generateOfferContent = () => {
    const lines = [
      `═══════════════════════════════════════════════════════════════`,
      `                    OFFRE COMMERCIALE`,
      `═══════════════════════════════════════════════════════════════`,
      ``,
      `Référence: ${tender?.reference}`,
      `Client: ${tender?.client || 'N/A'}`,
      `Date: ${format(new Date(), 'PPP', { locale: fr })}`,
      `Validité: ${validityDays} jours`,
      ``,
      `───────────────────────────────────────────────────────────────`,
      `                    SEGMENTS DE TRANSPORT`,
      `───────────────────────────────────────────────────────────────`,
      ``,
    ];

    segments.forEach((segment, idx) => {
      lines.push(`${idx + 1}. ${segment.origin_location} → ${segment.destination_location}`);
      lines.push(`   Type: ${segment.segment_type}`);
      lines.push(`   Tarif: ${segment.rate_per_unit ? `${segment.rate_per_unit.toLocaleString()} ${segment.currency}/${segment.rate_unit}` : 'À confirmer'}`);
      lines.push(`   Partenaire: ${segment.partner_company || 'N/A'}`);
      lines.push(``);
    });

    lines.push(`───────────────────────────────────────────────────────────────`);
    lines.push(`                    CONTINGENTS`);
    lines.push(`───────────────────────────────────────────────────────────────`);
    lines.push(``);

    contingents.forEach((contingent) => {
      const cost = calculateContingentCost(contingent);
      const price = cost * (1 + marginPercent / 100);
      
      lines.push(`▸ ${contingent.contingent_name}`);
      lines.push(`  Destination: ${contingent.destination_site || contingent.destination_port || 'N/A'}`);
      if (contingent.cargo_teus) lines.push(`  Cargo: ${contingent.cargo_teus} TEUs`);
      if (contingent.cargo_vehicles) lines.push(`  Véhicules: ${contingent.cargo_vehicles}`);
      if (contingent.cargo_tonnes) lines.push(`  Tonnage: ${contingent.cargo_tonnes} T`);
      lines.push(`  Prix: ${price.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`);
      lines.push(``);
    });

    lines.push(`───────────────────────────────────────────────────────────────`);
    lines.push(`                    RÉCAPITULATIF`);
    lines.push(`───────────────────────────────────────────────────────────────`);
    lines.push(``);
    lines.push(`Coût total estimé: ${totalCost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`);
    lines.push(`Marge appliquée: ${marginPercent}%`);
    lines.push(`PRIX TOTAL: ${totalWithMargin.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}`);
    lines.push(``);

    if (additionalTerms) {
      lines.push(`───────────────────────────────────────────────────────────────`);
      lines.push(`                    TERMES ET CONDITIONS`);
      lines.push(`───────────────────────────────────────────────────────────────`);
      lines.push(``);
      lines.push(additionalTerms);
      lines.push(``);
    }

    lines.push(`═══════════════════════════════════════════════════════════════`);
    lines.push(`                    SODATRA SHIPPING & LOGISTICS`);
    lines.push(`═══════════════════════════════════════════════════════════════`);

    return lines.join('\n');
  };

  const downloadAsText = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!tender) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Générer l'offre commerciale
          </DialogTitle>
          <DialogDescription>
            Tender: {tender.reference} - {tender.client}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Validation Status */}
          <Card className={pendingSegments.length > 0 ? 'border-amber-200 bg-amber-50' : 'border-green-200 bg-green-50'}>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                {pendingSegments.length > 0 ? (
                  <>
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                    <div>
                      <p className="font-medium text-amber-800">
                        {pendingSegments.length} segment(s) sans tarif confirmé
                      </p>
                      <p className="text-sm text-amber-600">
                        Associez des tarifs à tous les segments avant de générer l'offre
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="font-medium text-green-800">
                        Tous les segments ont des tarifs confirmés
                      </p>
                      <p className="text-sm text-green-600">
                        Prêt pour la génération de l'offre
                      </p>
                    </div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Segments Summary */}
          <div>
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Truck className="h-4 w-4" />
              Segments ({segments.length})
            </h4>
            <div className="space-y-2">
              {segments.map((segment, idx) => (
                <div key={segment.id} className="flex items-center justify-between text-sm p-2 rounded bg-muted/50">
                  <span>{idx + 1}. {segment.origin_location} → {segment.destination_location}</span>
                  <div className="flex items-center gap-2">
                    {segment.rate_per_unit ? (
                      <Badge variant="outline" className="bg-green-50 text-green-700">
                        {segment.rate_per_unit.toLocaleString()} {segment.currency}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700">
                        À confirmer
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Contingents Summary */}
          <div>
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <Package className="h-4 w-4" />
              Contingents ({contingents.length})
            </h4>
            <div className="space-y-2">
              {contingents.map((contingent) => {
                const cost = calculateContingentCost(contingent);
                const price = cost * (1 + marginPercent / 100);
                return (
                  <div key={contingent.id} className="flex items-center justify-between text-sm p-2 rounded bg-muted/50">
                    <div>
                      <span className="font-medium">{contingent.contingent_name}</span>
                      <span className="text-muted-foreground ml-2">
                        {contingent.cargo_teus ? `${contingent.cargo_teus} TEUs` : ''}
                        {contingent.cargo_vehicles ? `${contingent.cargo_vehicles} véh.` : ''}
                      </span>
                    </div>
                    <span className="font-medium">
                      {price.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <Separator />

          {/* Pricing Options */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="margin">Marge (%)</Label>
              <Input
                id="margin"
                type="number"
                value={marginPercent}
                onChange={(e) => setMarginPercent(Number(e.target.value))}
                min={0}
                max={100}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="validity">Validité (jours)</Label>
              <Input
                id="validity"
                type="number"
                value={validityDays}
                onChange={(e) => setValidityDays(Number(e.target.value))}
                min={1}
              />
            </div>
          </div>

          {/* Additional Terms */}
          <div className="grid gap-2">
            <Label htmlFor="terms">Termes et conditions additionnels</Label>
            <Textarea
              id="terms"
              value={additionalTerms}
              onChange={(e) => setAdditionalTerms(e.target.value)}
              placeholder="Conditions de paiement, exclusions, remarques..."
              rows={3}
            />
          </div>

          {/* Totals */}
          <Card>
            <CardContent className="pt-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Coût total segments</span>
                  <span>{totalCost.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Marge ({marginPercent}%)</span>
                  <span>{(totalWithMargin - totalCost).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>
                </div>
                <Separator />
                <div className="flex justify-between font-medium text-lg">
                  <span>Prix total</span>
                  <span className="text-primary">{totalWithMargin.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={generateOffer} className="gap-2">
            <Download className="h-4 w-4" />
            Télécharger l'offre
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
