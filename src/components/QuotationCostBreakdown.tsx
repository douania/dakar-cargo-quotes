import { useState } from 'react';
import { 
  Package, 
  Building2, 
  Receipt, 
  Calculator,
  Check,
  HelpCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Info,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { SodatraFeesEditor } from './SodatraFeesEditor';
import type { SodatraFeeSuggestion } from '@/hooks/useSodatraFees';

// Types
export interface CostItem {
  description: string;
  montant: number | null;
  devise: string;
  source: 'PORT_TARIFFS' | 'CARRIER_BILLING' | 'SODATRA_FEES' | 'ESTIMATE' | 'LEARNED';
  bloc: 'operationnel' | 'honoraires' | 'debours';
  note?: string;
  is_editable?: boolean;
}

export interface CostStructure {
  bloc_operationnel: { 
    total: number; 
    items: CostItem[];
  };
  bloc_honoraires: { 
    total: number; 
    items: CostItem[];
    complexity_factor?: number;
  };
  bloc_debours: { 
    total: number | null; 
    items: CostItem[];
    note?: string;
  };
}

export interface QuotationCostBreakdownProps {
  costStructure: CostStructure | null;
  totalDap: number;
  totalDdp: number | 'TBC' | null;
  offerType: 'full_quotation' | 'indicative_dap' | 'rate_only' | 'info_response';
  sodatraFees?: SodatraFeeSuggestion | null;
  onFeesConfirmed?: (fees: { key: string; amount: number }[]) => void;
  currency?: string;
  isCompact?: boolean;
}

const sourceLabels: Record<string, { label: string; color: string }> = {
  PORT_TARIFFS: { label: 'Tarif Port', color: 'bg-blue-100 text-blue-700' },
  CARRIER_BILLING: { label: 'Armateur', color: 'bg-purple-100 text-purple-700' },
  SODATRA_FEES: { label: 'Honoraires', color: 'bg-emerald-100 text-emerald-700' },
  ESTIMATE: { label: 'Estimé', color: 'bg-amber-100 text-amber-700' },
  LEARNED: { label: 'Appris', color: 'bg-indigo-100 text-indigo-700' },
};

const statusIcons = {
  fixed: <Check className="h-3 w-3 text-green-600" />,
  estimated: <TrendingUp className="h-3 w-3 text-amber-600" />,
  tbc: <HelpCircle className="h-3 w-3 text-muted-foreground" />,
};

export function QuotationCostBreakdown({
  costStructure,
  totalDap,
  totalDdp,
  offerType,
  sodatraFees,
  onFeesConfirmed,
  currency = 'FCFA',
  isCompact = false,
}: QuotationCostBreakdownProps) {
  const [expandedBlocs, setExpandedBlocs] = useState<Record<string, boolean>>({
    operationnel: true,
    honoraires: true,
    debours: true,
  });

  const toggleBloc = (bloc: string) => {
    setExpandedBlocs(prev => ({ ...prev, [bloc]: !prev[bloc] }));
  };

  const formatAmount = (amount: number | null) => {
    if (amount === null) return 'TBC';
    return amount.toLocaleString('fr-FR');
  };

  const getStatusIcon = (item: CostItem) => {
    if (item.source === 'ESTIMATE' || item.montant === null) return statusIcons.tbc;
    if (item.source === 'SODATRA_FEES') return statusIcons.estimated;
    return statusIcons.fixed;
  };

  // Compact summary view
  if (isCompact) {
    return (
      <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium flex items-center gap-2">
              <Calculator className="h-4 w-4 text-primary" />
              Aperçu des coûts
            </span>
            <Badge variant="outline" className="text-xs">
              {offerType === 'full_quotation' ? 'Cotation complète' : 
               offerType === 'indicative_dap' ? 'DAP indicatif' :
               offerType === 'rate_only' ? 'Tarifs seuls' : 'Info'}
            </Badge>
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="flex justify-between items-center p-2 rounded bg-blue-500/10">
              <span className="text-muted-foreground">Opérationnel</span>
              <span className="font-medium text-blue-700">
                {formatAmount(costStructure?.bloc_operationnel.total || 0)}
              </span>
            </div>
            <div className="flex justify-between items-center p-2 rounded bg-emerald-500/10">
              <span className="text-muted-foreground">Honoraires</span>
              <span className="font-medium text-emerald-700">
                {formatAmount(costStructure?.bloc_honoraires.total || 0)}
              </span>
            </div>
          </div>

          <Separator />

          <div className="flex justify-between items-center">
            <span className="font-medium">Total DAP</span>
            <span className="font-bold text-lg text-primary">
              {formatAmount(totalDap)} {currency}
            </span>
          </div>

          {totalDdp !== null && (
            <div className="flex justify-between items-center text-sm text-muted-foreground">
              <span className="flex items-center gap-1">
                Total DDP
                {totalDdp === 'TBC' && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <AlertCircle className="h-3 w-3 text-amber-500" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="text-xs">À calculer sur factures commerciales</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </span>
              <span className={cn("font-medium", totalDdp === 'TBC' && "text-amber-600")}>
                {totalDdp === 'TBC' ? 'À confirmer' : `${formatAmount(totalDdp as number)} ${currency}`}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Full detailed view
  return (
    <div className="space-y-4">
      {/* BLOC 1 - COÛTS OPÉRATIONNELS */}
      <Collapsible open={expandedBlocs.operationnel} onOpenChange={() => toggleBloc('operationnel')}>
        <Card className="border-blue-500/30 overflow-hidden">
          <CollapsibleTrigger className="w-full">
            <CardHeader className="bg-blue-500/10 hover:bg-blue-500/15 transition-colors cursor-pointer py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-blue-800">
                  <Package className="h-4 w-4" />
                  BLOC 1 - COÛTS OPÉRATIONNELS
                </CardTitle>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-blue-700">
                    {formatAmount(costStructure?.bloc_operationnel.total || 0)} {currency}
                  </span>
                  {expandedBlocs.operationnel ? (
                    <ChevronUp className="h-4 w-4 text-blue-600" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-blue-600" />
                  )}
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          
          <CollapsibleContent>
            <CardContent className="pt-3 space-y-2">
              {costStructure?.bloc_operationnel.items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-blue-100 last:border-0">
                  <div className="flex items-center gap-2 flex-1">
                    {getStatusIcon(item)}
                    <span className="text-sm">{item.description}</span>
                    <Badge className={cn("text-xs h-5", sourceLabels[item.source]?.color)}>
                      {sourceLabels[item.source]?.label}
                    </Badge>
                  </div>
                  <span className="font-mono text-sm font-medium">
                    {formatAmount(item.montant)} {item.devise}
                  </span>
                </div>
              )) || (
                <p className="text-sm text-muted-foreground italic">Aucun coût opérationnel détecté</p>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* BLOC 2 - HONORAIRES SODATRA */}
      <Collapsible open={expandedBlocs.honoraires} onOpenChange={() => toggleBloc('honoraires')}>
        <Card className="border-emerald-500/30 overflow-hidden">
          <CollapsibleTrigger className="w-full">
            <CardHeader className="bg-emerald-500/10 hover:bg-emerald-500/15 transition-colors cursor-pointer py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
                  <Building2 className="h-4 w-4" />
                  BLOC 2 - HONORAIRES SODATRA
                  {costStructure?.bloc_honoraires.complexity_factor && 
                   costStructure.bloc_honoraires.complexity_factor > 1 && (
                    <Badge variant="outline" className="text-xs ml-2">
                      ×{costStructure.bloc_honoraires.complexity_factor.toFixed(2)}
                    </Badge>
                  )}
                </CardTitle>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-emerald-700">
                    {formatAmount(costStructure?.bloc_honoraires.total || sodatraFees?.total_suggested || 0)} {currency}
                  </span>
                  {expandedBlocs.honoraires ? (
                    <ChevronUp className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-emerald-600" />
                  )}
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          
          <CollapsibleContent>
            <CardContent className="pt-3">
              {sodatraFees ? (
                <SodatraFeesEditor 
                  suggestion={sodatraFees} 
                  onFeesConfirmed={onFeesConfirmed || (() => {})} 
                />
              ) : costStructure?.bloc_honoraires.items.length ? (
                <div className="space-y-2">
                  {costStructure.bloc_honoraires.items.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between py-2 border-b border-emerald-100 last:border-0">
                      <div className="flex items-center gap-2 flex-1">
                        {getStatusIcon(item)}
                        <span className="text-sm">{item.description}</span>
                      </div>
                      <span className="font-mono text-sm font-medium">
                        {formatAmount(item.montant)} {item.devise}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Honoraires à calculer selon la complexité de l'opération
                </p>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* BLOC 3 - DÉBOURS DOUANIERS */}
      <Collapsible open={expandedBlocs.debours} onOpenChange={() => toggleBloc('debours')}>
        <Card className="border-amber-500/30 overflow-hidden">
          <CollapsibleTrigger className="w-full">
            <CardHeader className="bg-amber-500/10 hover:bg-amber-500/15 transition-colors cursor-pointer py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-amber-800">
                  <Receipt className="h-4 w-4" />
                  BLOC 3 - DÉBOURS DOUANIERS
                </CardTitle>
                <div className="flex items-center gap-3">
                  <span className={cn(
                    "font-bold",
                    costStructure?.bloc_debours.total === null ? "text-amber-600" : "text-amber-700"
                  )}>
                    {costStructure?.bloc_debours.total === null 
                      ? 'TBC' 
                      : `${formatAmount(costStructure?.bloc_debours.total)} ${currency}`}
                  </span>
                  {expandedBlocs.debours ? (
                    <ChevronUp className="h-4 w-4 text-amber-600" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-amber-600" />
                  )}
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          
          <CollapsibleContent>
            <CardContent className="pt-3 space-y-3">
              {costStructure?.bloc_debours.items.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between py-2 border-b border-amber-100 last:border-0">
                  <div className="flex items-center gap-2 flex-1">
                    {getStatusIcon(item)}
                    <span className="text-sm">{item.description}</span>
                    {item.note && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <Info className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">{item.note}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                  <span className={cn(
                    "font-mono text-sm font-medium",
                    item.montant === null && "text-amber-600"
                  )}>
                    {formatAmount(item.montant)} {item.devise}
                  </span>
                </div>
              )) || null}
              
              {costStructure?.bloc_debours.note && (
                <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-amber-300 bg-amber-50">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-700">{costStructure.bloc_debours.note}</p>
                </div>
              )}
              
              {(!costStructure?.bloc_debours.items || costStructure.bloc_debours.items.length === 0) && (
                <div className="flex items-center gap-2 p-3 rounded-lg border border-dashed border-amber-300 bg-amber-50">
                  <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-xs text-amber-700">
                    Pour calcul définitif des D&T, merci de nous transmettre les factures commerciales.
                  </p>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* RÉCAPITULATIF */}
      <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <Calculator className="h-4 w-4" />
            RÉCAPITULATIF
          </div>
          
          <Separator />
          
          <div className="space-y-2">
            <div className="flex justify-between items-center p-2 rounded bg-primary/10">
              <span className="font-medium">TOTAL DAP</span>
              <div className="text-right">
                <span className="font-bold text-lg text-primary">
                  {formatAmount(totalDap)} {currency}
                </span>
                <p className="text-xs text-muted-foreground">
                  Blocs 1 + 2 (coûts fixes)
                </p>
              </div>
            </div>
            
            <div className="flex justify-between items-center p-2 rounded border border-dashed">
              <div className="flex items-center gap-2">
                <span className="font-medium text-muted-foreground">Débours estimés</span>
                {totalDdp === 'TBC' && (
                  <Badge variant="outline" className="text-xs text-amber-600 border-amber-300">
                    En attente
                  </Badge>
                )}
              </div>
              <span className={cn(
                "font-medium",
                costStructure?.bloc_debours.total === null ? "text-amber-600" : "text-foreground"
              )}>
                {costStructure?.bloc_debours.total === null 
                  ? 'Sur valeur CAF' 
                  : `${formatAmount(costStructure?.bloc_debours.total)} ${currency}`}
              </span>
            </div>
            
            <Separator />
            
            <div className="flex justify-between items-center p-2 rounded bg-muted">
              <span className="font-semibold">TOTAL DDP</span>
              <div className="text-right">
                <span className={cn(
                  "font-bold text-lg",
                  totalDdp === 'TBC' ? "text-amber-600" : "text-foreground"
                )}>
                  {totalDdp === 'TBC' 
                    ? 'À confirmer' 
                    : totalDdp === null 
                      ? 'N/A' 
                      : `${formatAmount(totalDdp)} ${currency}`}
                </span>
                {totalDdp === 'TBC' && (
                  <p className="text-xs text-muted-foreground">
                    En attente des factures
                  </p>
                )}
              </div>
            </div>
          </div>
          
          <p className="text-xs text-muted-foreground text-center pt-2">
            💡 Cotation {offerType === 'full_quotation' ? 'complète' : 
                        offerType === 'indicative_dap' ? 'DAP indicative' :
                        offerType === 'rate_only' ? 'tarifs seuls' : 'informative'}
            {costStructure?.bloc_honoraires.complexity_factor && 
             costStructure.bloc_honoraires.complexity_factor > 1 && 
              ` • Facteur complexité: ×${costStructure.bloc_honoraires.complexity_factor.toFixed(2)}`}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
