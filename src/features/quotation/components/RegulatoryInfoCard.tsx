/**
 * UI COMPONENT — FROZEN (Phase 3B)
 * - Ne pas modifier sans ouvrir une nouvelle phase
 * - Logique métier volontairement absente
 * - Toute évolution = nouvelle phase (3B.x)
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Ship, Info, CheckCircle, ShieldCheck } from 'lucide-react';
import type { RegulatoryInfo } from '@/features/quotation/types';

interface RegulatoryInfoCardProps {
  regulatoryInfo: RegulatoryInfo | null;
}

export function RegulatoryInfoCard({ regulatoryInfo }: RegulatoryInfoCardProps) {
  if (!regulatoryInfo || (!regulatoryInfo.projectTaxation && !regulatoryInfo.dpiRequired && regulatoryInfo.customsNotes.length === 0)) {
    return null;
  }

  return (
    <Card className="border-blue-500/30 bg-blue-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2 text-blue-600">
          <ShieldCheck className="h-4 w-4" />
          Informations réglementaires extraites
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {regulatoryInfo.projectTaxation && (
          <div className="p-3 rounded-lg bg-background border">
            <p className="text-sm font-medium mb-1">Taxation projet exempté:</p>
            <div className="flex gap-4 text-sm">
              {regulatoryInfo.projectTaxation.sea && (
                <span>
                  <Ship className="h-3 w-3 inline mr-1" />
                  Maritime: <strong>{regulatoryInfo.projectTaxation.sea}</strong> CIF
                </span>
              )}
              {regulatoryInfo.projectTaxation.air && (
                <span>
                  ✈️ Aérien: <strong>{regulatoryInfo.projectTaxation.air}</strong> CIF
                </span>
              )}
            </div>
          </div>
        )}
        
        {regulatoryInfo.dpiRequired && (
          <div className="p-3 rounded-lg bg-background border">
            <div className="flex items-center gap-2 mb-1">
              <Info className="h-4 w-4 text-amber-500" />
              <p className="text-sm font-medium">DPI Obligatoire</p>
            </div>
            <div className="text-sm text-muted-foreground space-y-1">
              {regulatoryInfo.dpiThreshold && (
                <p>Seuil: CIF &gt; {regulatoryInfo.dpiThreshold}</p>
              )}
              {regulatoryInfo.dpiDeadline && (
                <p>Délai: {regulatoryInfo.dpiDeadline}</p>
              )}
            </div>
          </div>
        )}
        
        {regulatoryInfo.apeAvailable && (
          <div className="p-3 rounded-lg bg-background border">
            <div className="flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-500" />
              <p className="text-sm">APE possible si exemption manquante (renouv. 10j)</p>
            </div>
          </div>
        )}
        
        {regulatoryInfo.customsNotes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {regulatoryInfo.customsNotes.map((note, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {note}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
