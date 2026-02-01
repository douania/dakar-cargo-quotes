/**
 * QuotationPreview — Phase 6D.1
 * Affichage lecture seule du snapshot généré
 */
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { CheckCircle, Package, FileText, Anchor, MapPin, Building2 } from 'lucide-react';
import type { GeneratedSnapshot } from '@/features/quotation/domain/types';

interface QuotationPreviewProps {
  snapshot: GeneratedSnapshot;
}

export function QuotationPreview({ snapshot }: QuotationPreviewProps) {
  const refNumber = snapshot.meta.quotation_id.substring(0, 8).toUpperCase();
  const generatedDate = format(new Date(snapshot.meta.generated_at), 'dd MMMM yyyy à HH:mm', { locale: fr });

  return (
    <Card className="border-success/30 bg-success/5">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5" />
              Devis N° {refNumber}
            </CardTitle>
            <CardDescription>
              Version {snapshot.meta.version} — Généré le {generatedDate}
            </CardDescription>
          </div>
          <Badge className="bg-success/20 text-success border-success/30">
            <CheckCircle className="h-3 w-3 mr-1" />
            Généré
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* En-tête SODATRA */}
        <div className="text-center border-b border-border pb-4">
          <h2 className="text-xl font-bold text-foreground">SODATRA</h2>
          <p className="text-sm text-muted-foreground">Transit & Logistique</p>
        </div>

        {/* Infos client */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div className="space-y-1">
            <p className="font-medium flex items-center gap-1">
              <Building2 className="h-3 w-3" /> Client
            </p>
            <p className="text-foreground">{snapshot.client.name || 'N/A'}</p>
            <p className="text-muted-foreground">{snapshot.client.company || ''}</p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Projet</p>
            <p className="text-foreground">{snapshot.client.project_name || 'N/A'}</p>
            <p className="text-muted-foreground">Incoterm: {snapshot.client.incoterm || 'N/A'}</p>
          </div>
          <div className="space-y-1">
            <p className="font-medium flex items-center gap-1">
              <Anchor className="h-3 w-3" /> Origine
            </p>
            <p className="text-foreground">{snapshot.client.route_origin || 'N/A'}</p>
          </div>
          <div className="space-y-1">
            <p className="font-medium flex items-center gap-1">
              <MapPin className="h-3 w-3" /> Destination
            </p>
            <p className="text-foreground">{snapshot.client.route_destination || 'N/A'}</p>
          </div>
        </div>

        <Separator />

        {/* Marchandises */}
        {snapshot.cargo_lines.length > 0 && (
          <div>
            <h3 className="font-medium mb-3 flex items-center gap-2">
              <Package className="h-4 w-4" /> Marchandises
            </h3>
            <div className="text-sm space-y-2 bg-muted/30 rounded-lg p-3">
              {snapshot.cargo_lines.map((cargo) => (
                <div key={cargo.id} className="flex justify-between items-center">
                  <span className="text-foreground">{cargo.description || cargo.cargo_type}</span>
                  <span className="text-muted-foreground">
                    {cargo.container_type && `${cargo.container_count || 1}x ${cargo.container_type}`}
                    {cargo.weight_kg && ` — ${cargo.weight_kg.toLocaleString()} kg`}
                    {cargo.volume_cbm && ` — ${cargo.volume_cbm} m³`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <Separator />

        {/* Services */}
        <div>
          <h3 className="font-medium mb-3">Prestations</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Service</TableHead>
                <TableHead className="text-right">Qté</TableHead>
                <TableHead className="text-right">P.U.</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshot.service_lines.map((line) => (
                <TableRow key={line.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{line.service}</p>
                      {line.description && (
                        <p className="text-xs text-muted-foreground">{line.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{line.quantity}</TableCell>
                  <TableCell className="text-right">
                    {line.rate.toLocaleString()} {line.currency}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {(line.quantity * line.rate).toLocaleString()} {line.currency}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <Separator />

        {/* Totaux */}
        <div className="flex justify-end">
          <div className="w-64 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Sous-total</span>
              <span>{snapshot.totals.subtotal.toLocaleString()} {snapshot.totals.currency}</span>
            </div>
            <Separator />
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span className="text-primary">{snapshot.totals.total.toLocaleString()} {snapshot.totals.currency}</span>
            </div>
          </div>
        </div>

        {/* Mentions légales */}
        <div className="text-xs text-muted-foreground border-t border-border pt-4 mt-4 space-y-1">
          <p>Ce devis est valable 30 jours à compter de sa date d'émission.</p>
          <p>Conditions de paiement : selon accord commercial.</p>
        </div>
      </CardContent>
    </Card>
  );
}
