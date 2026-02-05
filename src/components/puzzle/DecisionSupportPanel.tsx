/**
 * Phase 9.4 — Panneau d'aide à la décision
 * 
 * CTO RULES ABSOLUES:
 * ❌ Écriture DB directe depuis le frontend
 * ❌ Auto-sélection d'une option
 * ❌ Bouton "suivant" automatique
 * ❌ Cacher des options
 * ❌ UI qui suggère implicitement "la bonne réponse"
 * ❌ Appel commit-decision sans clic explicite + confirmation
 * 
 * ✅ Lecture de suggest-decisions
 * ✅ Affichage comparatif neutre
 * ✅ Badge "Recommandé" discret
 * ✅ Sélection humaine explicite
 * ✅ Justification obligatoire si override
 * ✅ Confirmation avant commit
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  FileText, 
  MapPin, 
  Settings, 
  FileSignature, 
  Container,
  Loader2,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Star,
  Info,
  Unlock
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { DecisionProgressIndicator } from './DecisionProgressIndicator';
import { 
  useDecisionSupport, 
  DecisionType, 
  DecisionOption,
  DecisionProposal,
  ALL_DECISION_TYPES,
  DECISION_TYPE_LABELS,
  CONFIDENCE_LABELS
} from '@/hooks/useDecisionSupport';

// ============================================================================
// ICONS PAR TYPE
// ============================================================================

const DECISION_ICONS: Record<DecisionType, React.ElementType> = {
  regime: FileText,
  routing: MapPin,
  services: Settings,
  incoterm: FileSignature,
  container: Container,
};

// ============================================================================
// PROPS
// ============================================================================

interface Props {
  caseId: string;
}

// ============================================================================
// COMPOSANT PRINCIPAL
// ============================================================================

export function DecisionSupportPanel({ caseId }: Props) {
  const queryClient = useQueryClient();
  
  const {
    proposals,
    missingInfo,
    isLoading,
    isCommitting,
    error,
    localState,
    generateOptions,
    selectOption,
    setOverride,
    commitDecision,
    committedCount,
    canCommit,
    getValidationError,
  } = useDecisionSupport(caseId);

  // Fetch quote case status pour déterminer si on peut débloquer le pricing
  const { data: quoteCase } = useQuery({
    queryKey: ['quote-case-status', caseId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quote_cases')
        .select('status')
        .eq('id', caseId)
        .single();
      if (error) throw error;
      return data;
    },
    refetchInterval: 5000, // Rafraîchir régulièrement pour détecter les changements
  });

  // État pour le dialog de confirmation
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    type: DecisionType | null;
  }>({ open: false, type: null });

  // État pour les sections collapsibles
  const [expandedTypes, setExpandedTypes] = useState<Set<DecisionType>>(new Set());

  // État pour le déblocage du pricing
  const [isUnlockingPricing, setIsUnlockingPricing] = useState(false);

  // ═══════════════════════════════════════════════════════════════════════════
  // HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════

  const handleValidateClick = (type: DecisionType) => {
    // Ouvrir le dialog de confirmation
    setConfirmDialog({ open: true, type });
  };

  const handleConfirmCommit = async () => {
    if (!confirmDialog.type) return;
    
    await commitDecision(confirmDialog.type);
    setConfirmDialog({ open: false, type: null });
  };

  const toggleExpanded = (type: DecisionType) => {
    setExpandedTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  // Handler pour débloquer le pricing (Phase 13)
  const handleUnlockPricing = async () => {
    setIsUnlockingPricing(true);
    try {
      const { data, error } = await supabase.functions.invoke('ack-pricing-ready', {
        body: { case_id: caseId }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      
      toast.success('Pricing débloqué - prêt pour le calcul');
      queryClient.invalidateQueries({ queryKey: ['quote-case-status'] });
      queryClient.invalidateQueries({ queryKey: ['quote-case'] });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Erreur inconnue';
      toast.error(`Échec du déblocage: ${errorMessage}`);
    } finally {
      setIsUnlockingPricing(false);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Option individuelle
  // ═══════════════════════════════════════════════════════════════════════════

  const renderOption = (
    option: DecisionOption, 
    type: DecisionType, 
    isSelected: boolean,
    isDisabled: boolean
  ) => {
    const confidence = CONFIDENCE_LABELS[option.confidence_level];
    const isExpanded = expandedTypes.has(type);

    return (
      <div 
        key={option.key}
        className={cn(
          "relative p-3 rounded-lg border transition-all",
          isSelected && "border-primary bg-primary/5 ring-1 ring-primary",
          !isSelected && "border-muted hover:border-muted-foreground/30",
          isDisabled && "opacity-50 cursor-not-allowed"
        )}
      >
        <div className="flex items-start gap-3">
          <RadioGroupItem 
            value={option.key} 
            id={`${type}-${option.key}`}
            disabled={isDisabled}
            className="mt-1"
          />
          <div className="flex-1 space-y-2">
            {/* Label + badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <Label 
                htmlFor={`${type}-${option.key}`}
                className={cn(
                  "text-sm font-medium cursor-pointer",
                  isDisabled && "cursor-not-allowed"
                )}
              >
                {option.label_fr}
              </Label>
              
              {/* Badge recommandé (discret) */}
              {option.is_recommended && (
                <Badge variant="outline" className="text-xs gap-1 border-amber-300 text-amber-700 bg-amber-50">
                  <Star className="h-3 w-3" />
                  Recommandé
                </Badge>
              )}
              
              {/* Badge confiance */}
              <Badge variant={confidence.variant} className="text-xs">
                {confidence.label}
              </Badge>
            </div>

            {/* Justification */}
            <p className="text-sm text-muted-foreground">
              {option.justification_fr}
            </p>

            {/* Pros/Cons (collapsible) */}
            {(option.pros.length > 0 || option.cons.length > 0) && (
              <Collapsible open={isExpanded}>
                <CollapsibleTrigger 
                  onClick={(e) => {
                    e.preventDefault();
                    toggleExpanded(type);
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  {isExpanded ? 'Masquer détails' : 'Voir avantages/inconvénients'}
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-2">
                  {option.pros.length > 0 && (
                    <div className="text-xs">
                      <span className="font-medium text-green-700">Avantages:</span>
                      <ul className="list-disc list-inside ml-2 text-green-600">
                        {option.pros.map((pro, i) => <li key={i}>{pro}</li>)}
                      </ul>
                    </div>
                  )}
                  {option.cons.length > 0 && (
                    <div className="text-xs">
                      <span className="font-medium text-red-700">Inconvénients:</span>
                      <ul className="list-disc list-inside ml-2 text-red-600">
                        {option.cons.map((con, i) => <li key={i}>{con}</li>)}
                      </ul>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Section par type de décision
  // ═══════════════════════════════════════════════════════════════════════════

  const renderDecisionSection = (proposal: DecisionProposal) => {
    const { decision_type: type, options } = proposal;
    const Icon = DECISION_ICONS[type];
    const label = DECISION_TYPE_LABELS[type].label;
    const state = localState[type];
    const isCommittedType = state.isCommitted;
    const isCommittingType = isCommitting === type;
    const validationError = getValidationError(type);

    return (
      <Card 
        key={type}
        className={cn(
          "transition-all",
          isCommittedType && "border-green-300 bg-green-50/30"
        )}
      >
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon className={cn(
                "h-5 w-5",
                isCommittedType ? "text-green-600" : "text-muted-foreground"
              )} />
              <CardTitle className="text-base">{label}</CardTitle>
              {isCommittedType && (
                <Badge variant="default" className="bg-green-600 text-xs">
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Validé
                </Badge>
              )}
            </div>
          </div>
          {isCommittedType && state.committedAt && (
            <CardDescription className="text-green-700">
              Décision validée le {new Date(state.committedAt).toLocaleString('fr-FR')}
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {/* RadioGroup pour les options */}
          <RadioGroup
            value={state.selectedKey || ''}
            onValueChange={(value) => selectOption(type, value)}
            disabled={isCommittedType}
            className="space-y-3"
          >
            {/* Options IA (toutes visibles, ordre stable) */}
            {options.map(option => renderOption(
              option, 
              type, 
              state.selectedKey === option.key,
              isCommittedType
            ))}

            {/* Option "Autre choix" */}
            <div 
              className={cn(
                "relative p-3 rounded-lg border transition-all",
                state.selectedKey === '__override__' && "border-primary bg-primary/5 ring-1 ring-primary",
                state.selectedKey !== '__override__' && "border-muted hover:border-muted-foreground/30",
                isCommittedType && "opacity-50 cursor-not-allowed"
              )}
            >
              <div className="flex items-start gap-3">
                <RadioGroupItem 
                  value="__override__" 
                  id={`${type}-override`}
                  disabled={isCommittedType}
                  className="mt-1"
                />
                <div className="flex-1 space-y-3">
                  <Label 
                    htmlFor={`${type}-override`}
                    className={cn(
                      "text-sm font-medium cursor-pointer",
                      isCommittedType && "cursor-not-allowed"
                    )}
                  >
                    Autre choix (personnalisé)
                  </Label>

                  {state.selectedKey === '__override__' && (
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Valeur personnalisée *</Label>
                        <Input
                          value={state.overrideValue || ''}
                          onChange={(e) => setOverride(type, e.target.value, state.overrideReason || '')}
                          placeholder="Votre choix..."
                          disabled={isCommittedType}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Justification obligatoire *</Label>
                        <Textarea
                          value={state.overrideReason || ''}
                          onChange={(e) => setOverride(type, state.overrideValue || '', e.target.value)}
                          placeholder="Expliquez pourquoi vous choisissez cette option..."
                          disabled={isCommittedType}
                          rows={2}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </RadioGroup>

          {/* Bouton de validation */}
          {!isCommittedType && (
            <div className="flex items-center justify-between pt-2">
              <div>
                {validationError && state.selectedKey && (
                  <p className="text-xs text-destructive flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {validationError}
                  </p>
                )}
              </div>
              <Button
                onClick={() => handleValidateClick(type)}
                disabled={!canCommit(type) || isCommittingType}
                className="gap-2"
              >
                {isCommittingType ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Validation...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4" />
                    Valider ce choix
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER: Dialog de confirmation
  // ═══════════════════════════════════════════════════════════════════════════

  const renderConfirmDialog = () => {
    if (!confirmDialog.type) return null;

    const type = confirmDialog.type;
    const state = localState[type];
    const proposal = proposals.find(p => p.decision_type === type);
    const selectedOption = proposal?.options.find(o => o.key === state.selectedKey);
    const isOverride = state.selectedKey === '__override__';

    return (
      <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog({ open, type: open ? type : null })}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmer la décision ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span className="text-muted-foreground">Type :</span>
                  <span className="font-medium">{DECISION_TYPE_LABELS[type].label}</span>
                  
                  <span className="text-muted-foreground">Choix :</span>
                  <span className="font-medium">
                    {isOverride ? state.overrideValue : selectedOption?.label_fr}
                  </span>
                  
                  {selectedOption?.is_recommended && !isOverride && (
                    <>
                      <span className="text-muted-foreground">Recommandation :</span>
                      <Badge variant="outline" className="w-fit text-xs border-amber-300 text-amber-700">
                        Option recommandée
                      </Badge>
                    </>
                  )}
                  
                  {isOverride && (
                    <>
                      <span className="text-muted-foreground">Override :</span>
                      <span className="text-amber-700">Oui</span>
                    </>
                  )}
                </div>

                {isOverride && state.overrideReason && (
                  <div className="p-2 bg-muted rounded text-sm">
                    <span className="text-muted-foreground">Justification : </span>
                    {state.overrideReason}
                  </div>
                )}

                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <Info className="h-4 w-4 text-amber-600 mt-0.5" />
                  <p className="text-sm text-amber-800">
                    Cette action est traçée et pourra être auditée. 
                    La décision sera enregistrée avec votre identifiant.
                  </p>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmCommit}>
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER PRINCIPAL
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {/* En-tête avec bouton de génération */}
      <Card className="border-indigo-200 bg-indigo-50/50">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-600" />
              <CardTitle className="text-lg text-indigo-900">
                Aide à la décision
              </CardTitle>
            </div>
            <Button
              onClick={generateOptions}
              disabled={isLoading}
              variant={proposals.length > 0 ? "outline" : "default"}
              className="gap-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyse en cours...
                </>
              ) : proposals.length > 0 ? (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Régénérer
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Générer les options de décision
                </>
              )}
            </Button>
          </div>
          <CardDescription className="text-indigo-700">
            L'IA propose des options comparées. Vous décidez.
          </CardDescription>
        </CardHeader>

        {/* Erreur */}
        {error && (
          <CardContent className="pt-0">
            <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </div>
          </CardContent>
        )}

        {/* Infos manquantes */}
        {missingInfo.length > 0 && (
          <CardContent className="pt-0">
            <Collapsible>
              <CollapsibleTrigger className="text-sm text-amber-700 hover:text-amber-800 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" />
                {missingInfo.length} information(s) manquante(s)
                <ChevronDown className="h-4 w-4" />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <ul className="text-sm text-muted-foreground space-y-1 pl-5 list-disc">
                  {missingInfo.map((info, i) => (
                    <li key={i}>{info}</li>
                  ))}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        )}

        {/* Indicateur de progression */}
        {proposals.length > 0 && (
          <CardContent className="pt-0">
            <DecisionProgressIndicator
              decisions={ALL_DECISION_TYPES.map(type => ({
                type,
                isCommitted: localState[type].isCommitted,
                isCommitting: isCommitting === type,
              }))}
            />
          </CardContent>
        )}
      </Card>

      {/* Bouton débloquer le pricing (Phase 13) */}
      {quoteCase?.status === 'DECISIONS_COMPLETE' && (
        <Card className="border-green-300 bg-green-50">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-6 w-6 text-green-600" />
                <div>
                  <p className="font-medium text-green-900">
                    Toutes les décisions sont validées (5/5)
                  </p>
                  <p className="text-sm text-green-700">
                    Débloquez le calcul de prix pour continuer
                  </p>
                </div>
              </div>
              <Button 
                onClick={handleUnlockPricing}
                disabled={isUnlockingPricing}
                className="gap-2 bg-green-600 hover:bg-green-700"
              >
                {isUnlockingPricing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Unlock className="h-4 w-4" />
                )}
                Débloquer le pricing
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sections par type de décision */}
      {proposals
        .sort((a, b) => 
          DECISION_TYPE_LABELS[a.decision_type].order - 
          DECISION_TYPE_LABELS[b.decision_type].order
        )
        .map(renderDecisionSection)}

      {/* Dialog de confirmation */}
      {renderConfirmDialog()}
    </div>
  );
}
