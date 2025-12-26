import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { 
  Calculator, 
  Info, 
  Edit2, 
  Check, 
  RotateCcw, 
  AlertTriangle,
  TrendingUp,
  FileText,
  Briefcase,
  Search,
  Percent,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SodatraFeeSuggestion, SuggestedFee } from '@/hooks/useSodatraFees';

interface Props {
  suggestion: SodatraFeeSuggestion;
  onFeesConfirmed: (fees: { key: string; amount: number }[]) => void;
  isCompact?: boolean;
}

export function SodatraFeesEditor({ suggestion, onFeesConfirmed, isCompact = false }: Props) {
  const [editedFees, setEditedFees] = useState<Record<string, number>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [tempValue, setTempValue] = useState<string>('');

  // Initialize edited fees from suggestion
  useEffect(() => {
    const initialFees: Record<string, number> = {};
    suggestion.fees.forEach(fee => {
      initialFees[fee.key] = fee.suggested_amount;
    });
    setEditedFees(initialFees);
  }, [suggestion]);

  const handleStartEdit = (key: string, currentAmount: number) => {
    setEditingKey(key);
    setTempValue(currentAmount.toString());
  };

  const handleConfirmEdit = (key: string) => {
    const newAmount = parseInt(tempValue.replace(/\s/g, ''), 10);
    if (!isNaN(newAmount) && newAmount >= 0) {
      setEditedFees(prev => ({ ...prev, [key]: newAmount }));
    }
    setEditingKey(null);
    setTempValue('');
  };

  const handleCancelEdit = () => {
    setEditingKey(null);
    setTempValue('');
  };

  const handleResetFee = (key: string, originalAmount: number) => {
    setEditedFees(prev => ({ ...prev, [key]: originalAmount }));
  };

  const handleConfirmAll = () => {
    const confirmedFees = Object.entries(editedFees).map(([key, amount]) => ({
      key,
      amount,
    }));
    onFeesConfirmed(confirmedFees);
  };

  const totalEdited = Object.values(editedFees).reduce((sum, amount) => sum + amount, 0);
  const totalDelta = totalEdited - suggestion.total_suggested;
  const deltaPercent = suggestion.total_suggested > 0 
    ? ((totalDelta / suggestion.total_suggested) * 100).toFixed(1)
    : '0';

  const getFeeIcon = (key: string) => {
    switch (key) {
      case 'dedouanement':
        return <Briefcase className="h-4 w-4" />;
      case 'suivi_operationnel':
        return <Search className="h-4 w-4" />;
      case 'ouverture_dossier':
        return <FileText className="h-4 w-4" />;
      case 'frais_documentaires':
        return <FileText className="h-4 w-4" />;
      case 'commission_debours':
        return <Percent className="h-4 w-4" />;
      default:
        return <Calculator className="h-4 w-4" />;
    }
  };

  const isModified = (key: string, originalAmount: number) => {
    return editedFees[key] !== originalAmount;
  };

  if (isCompact) {
    return (
      <div className="space-y-2 p-3 rounded-lg border border-primary/20 bg-primary/5">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            Honoraires SODATRA (suggérés)
          </span>
          <span className="font-bold text-primary">
            {totalEdited.toLocaleString('fr-FR')} FCFA
          </span>
        </div>
        {suggestion.complexity_reasons.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {suggestion.complexity_reasons.slice(0, 2).map((reason, idx) => (
              <Badge key={idx} variant="outline" className="text-xs">
                {reason}
              </Badge>
            ))}
            {suggestion.complexity_reasons.length > 2 && (
              <Badge variant="outline" className="text-xs">
                +{suggestion.complexity_reasons.length - 2}
              </Badge>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/5 to-transparent">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calculator className="h-5 w-5 text-emerald-600" />
            Honoraires SODATRA (suggérés)
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            ×{suggestion.complexity_factor.toFixed(2)} complexité
          </Badge>
        </div>
        
        {suggestion.complexity_reasons.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {suggestion.complexity_reasons.map((reason, idx) => (
              <Badge key={idx} variant="secondary" className="text-xs">
                <TrendingUp className="h-3 w-3 mr-1" />
                {reason}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>
      
      <CardContent className="pt-0 space-y-3">
        <TooltipProvider>
          {suggestion.fees.map((fee) => (
            <div
              key={fee.key}
              className={cn(
                "flex items-center gap-3 p-2 rounded-lg border transition-colors",
                isModified(fee.key, fee.suggested_amount)
                  ? "border-amber-500/30 bg-amber-500/10"
                  : "border-emerald-500/20 bg-background"
              )}
            >
              {/* Icon */}
              <div className="text-muted-foreground shrink-0">
                {getFeeIcon(fee.key)}
              </div>
              
              {/* Label & Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-sm font-medium">{fee.label}</span>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="h-3 w-3 text-muted-foreground cursor-help" />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs">
                      <p className="text-xs font-medium mb-1">Formule:</p>
                      <p className="text-xs text-muted-foreground">{fee.formula}</p>
                      <p className="text-xs mt-1 text-muted-foreground">
                        Min: {fee.min_amount.toLocaleString('fr-FR')} - Max: {fee.max_amount.toLocaleString('fr-FR')} FCFA
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <p className="text-xs text-muted-foreground">
                  {fee.unit} • {fee.factors_applied[0]}
                </p>
              </div>
              
              {/* Amount editing */}
              <div className="flex items-center gap-2 shrink-0">
                {editingKey === fee.key ? (
                  <>
                    <Input
                      type="text"
                      value={tempValue}
                      onChange={(e) => setTempValue(e.target.value)}
                      className="w-28 h-8 text-right text-sm"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleConfirmEdit(fee.key);
                        if (e.key === 'Escape') handleCancelEdit();
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 w-8 p-0"
                      onClick={() => handleConfirmEdit(fee.key)}
                    >
                      <Check className="h-4 w-4 text-green-600" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className={cn(
                      "font-mono text-sm font-medium",
                      isModified(fee.key, fee.suggested_amount) && "text-amber-600"
                    )}>
                      {(editedFees[fee.key] || fee.suggested_amount).toLocaleString('fr-FR')}
                    </span>
                    <span className="text-xs text-muted-foreground">FCFA</span>
                    
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 p-0"
                      onClick={() => handleStartEdit(fee.key, editedFees[fee.key] || fee.suggested_amount)}
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    
                    {isModified(fee.key, fee.suggested_amount) && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => handleResetFee(fee.key, fee.suggested_amount)}
                      >
                        <RotateCcw className="h-3 w-3 text-muted-foreground" />
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </TooltipProvider>
        
        {/* Commission note if applicable */}
        {suggestion.commission_note && (
          <div className="flex items-center gap-2 p-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/50">
            <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
            <p className="text-xs text-muted-foreground">{suggestion.commission_note}</p>
          </div>
        )}
        
        <Separator />
        
        {/* Total */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-500/10">
          <span className="font-medium">Total honoraires</span>
          <div className="text-right">
            <span className="font-bold text-lg text-emerald-700">
              {totalEdited.toLocaleString('fr-FR')} FCFA
            </span>
            {totalDelta !== 0 && (
              <p className={cn(
                "text-xs",
                totalDelta > 0 ? "text-amber-600" : "text-green-600"
              )}>
                {totalDelta > 0 ? '+' : ''}{totalDelta.toLocaleString('fr-FR')} ({deltaPercent}%)
              </p>
            )}
          </div>
        </div>
        
        {/* Confirm button */}
        <Button 
          onClick={handleConfirmAll}
          className="w-full gap-2"
          variant="default"
        >
          <Check className="h-4 w-4" />
          Confirmer les honoraires
        </Button>
        
        <p className="text-xs text-muted-foreground text-center">
          💡 Ces montants sont des suggestions basées sur les patterns appris. Modifiez selon votre appréciation.
        </p>
      </CardContent>
    </Card>
  );
}
