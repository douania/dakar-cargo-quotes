/**
 * Phase 9.4 — Hook orchestration aide à la décision
 * 
 * CTO RULES STRICTES:
 * ❌ Aucune logique métier
 * ❌ Aucune écriture DB directe (supabase.from().insert/update/delete)
 * ✅ Orchestration pure des Edge Functions
 * ✅ État local pour sélections UI
 */

import { useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ============================================================================
// TYPES
// ============================================================================

export type DecisionType = 'regime' | 'routing' | 'services' | 'incoterm' | 'container';

export interface DecisionOption {
  key: string;
  label_fr: string;
  label_en: string;
  justification_fr: string;
  justification_en: string;
  pros: string[];
  cons: string[];
  confidence_level: 'low' | 'medium' | 'high';
  is_recommended: boolean;
}

export interface DecisionProposal {
  decision_type: DecisionType;
  options: DecisionOption[];
  source_fact_ids: string[];
}

export interface LocalDecisionState {
  selectedKey: string | null;       // null = aucune sélection
  overrideValue: string | null;     // valeur personnalisée si "Autre"
  overrideReason: string | null;    // justification obligatoire pour override
  isCommitted: boolean;             // true après commit réussi
  committedAt: string | null;       // timestamp du commit
}

export interface CommitResult {
  decision_id: string;
  remaining_decisions: number;
  all_complete: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const ALL_DECISION_TYPES: DecisionType[] = [
  'regime', 'routing', 'services', 'incoterm', 'container'
];

export const DECISION_TYPE_LABELS: Record<DecisionType, { label: string; order: number }> = {
  regime: { label: 'Régime douanier', order: 1 },
  routing: { label: 'Itinéraire logistique', order: 2 },
  services: { label: 'Périmètre de services', order: 3 },
  incoterm: { label: 'Incoterm', order: 4 },
  container: { label: 'Stratégie conteneur', order: 5 },
};

export const CONFIDENCE_LABELS: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' }> = {
  low: { label: 'Faible confiance', variant: 'destructive' },
  medium: { label: 'Confiance moyenne', variant: 'secondary' },
  high: { label: 'Haute confiance', variant: 'default' },
};

// ============================================================================
// INITIAL STATE FACTORY
// ============================================================================

function createInitialLocalState(): Record<DecisionType, LocalDecisionState> {
  const state: Partial<Record<DecisionType, LocalDecisionState>> = {};
  for (const type of ALL_DECISION_TYPES) {
    state[type] = {
      selectedKey: null,          // CTO: JAMAIS de pré-sélection
      overrideValue: null,
      overrideReason: null,
      isCommitted: false,
      committedAt: null,
    };
  }
  return state as Record<DecisionType, LocalDecisionState>;
}

// ============================================================================
// HOOK
// ============================================================================

export interface UseDecisionSupportReturn {
  // Données IA
  proposals: DecisionProposal[];
  missingInfo: string[];
  
  // États
  isLoading: boolean;
  isCommitting: DecisionType | null;  // null ou le type en cours de commit
  error: string | null;
  
  // État local par decision_type
  localState: Record<DecisionType, LocalDecisionState>;
  
  // Actions
  generateOptions: () => Promise<void>;
  selectOption: (type: DecisionType, key: string) => void;
  setOverride: (type: DecisionType, value: string, reason: string) => void;
  clearSelection: (type: DecisionType) => void;
  commitDecision: (type: DecisionType) => Promise<CommitResult | null>;
  
  // Statistiques
  committedCount: number;
  remainingCount: number;
  allComplete: boolean;
  
  // Validation
  canCommit: (type: DecisionType) => boolean;
  getValidationError: (type: DecisionType) => string | null;
}

export function useDecisionSupport(caseId: string): UseDecisionSupportReturn {
  // État des propositions IA
  const [proposals, setProposals] = useState<DecisionProposal[]>([]);
  const [missingInfo, setMissingInfo] = useState<string[]>([]);
  
  // États de chargement
  const [isLoading, setIsLoading] = useState(false);
  const [isCommitting, setIsCommitting] = useState<DecisionType | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  // État local des sélections (UI)
  const [localState, setLocalState] = useState<Record<DecisionType, LocalDecisionState>>(
    createInitialLocalState
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION: Générer les options (appel suggest-decisions)
  // ═══════════════════════════════════════════════════════════════════════════
  const generateOptions = useCallback(async () => {
    if (!caseId) {
      toast.error('Aucun dossier sélectionné');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('suggest-decisions', {
        body: { case_id: caseId }
      });

      if (fnError) throw fnError;

      if (data?.error) {
        // Gestion des erreurs métier (409, 403, etc.)
        if (data.error.includes('status')) {
          setError("Le dossier n'est pas prêt pour les décisions");
          toast.error("Le dossier n'est pas prêt pour les décisions");
        } else {
          setError(data.error);
          toast.error(data.error);
        }
        return;
      }

      setProposals(data.proposals || []);
      setMissingInfo(data.missing_info || []);
      toast.success(`${data.proposals?.length || 0} types de décision générés`);
    } catch (err) {
      console.error('[useDecisionSupport] Error generating options:', err);
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      setError(message);
      toast.error('Erreur lors de la génération des options');
    } finally {
      setIsLoading(false);
    }
  }, [caseId]);

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION: Sélectionner une option (état local uniquement)
  // ═══════════════════════════════════════════════════════════════════════════
  const selectOption = useCallback((type: DecisionType, key: string) => {
    setLocalState(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        selectedKey: key,
        // Reset override si on sélectionne une option standard
        overrideValue: key === '__override__' ? prev[type].overrideValue : null,
        overrideReason: key === '__override__' ? prev[type].overrideReason : null,
      }
    }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION: Définir un override (choix personnalisé)
  // ═══════════════════════════════════════════════════════════════════════════
  const setOverride = useCallback((type: DecisionType, value: string, reason: string) => {
    setLocalState(prev => ({
      ...prev,
      [type]: {
        ...prev[type],
        selectedKey: '__override__',
        overrideValue: value,
        overrideReason: reason,
      }
    }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION: Effacer la sélection
  // ═══════════════════════════════════════════════════════════════════════════
  const clearSelection = useCallback((type: DecisionType) => {
    setLocalState(prev => ({
      ...prev,
      [type]: {
        selectedKey: null,
        overrideValue: null,
        overrideReason: null,
        isCommitted: prev[type].isCommitted,
        committedAt: prev[type].committedAt,
      }
    }));
  }, []);

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION: Peut-on commit cette décision ?
  // ═══════════════════════════════════════════════════════════════════════════
  const canCommit = useCallback((type: DecisionType): boolean => {
    const state = localState[type];
    
    // Déjà committed
    if (state.isCommitted) return false;
    
    // Aucune sélection
    if (!state.selectedKey) return false;
    
    // Override sans justification
    if (state.selectedKey === '__override__') {
      if (!state.overrideValue?.trim()) return false;
      if (!state.overrideReason?.trim()) return false;
    }
    
    return true;
  }, [localState]);

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION: Message d'erreur de validation
  // ═══════════════════════════════════════════════════════════════════════════
  const getValidationError = useCallback((type: DecisionType): string | null => {
    const state = localState[type];
    
    if (state.isCommitted) return 'Décision déjà validée';
    if (!state.selectedKey) return 'Sélectionnez une option';
    
    if (state.selectedKey === '__override__') {
      if (!state.overrideValue?.trim()) return 'Valeur personnalisée requise';
      if (!state.overrideReason?.trim()) return 'Justification obligatoire pour un choix personnalisé';
    }
    
    return null;
  }, [localState]);

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTION: Commit une décision (appel commit-decision)
  // ═══════════════════════════════════════════════════════════════════════════
  const commitDecision = useCallback(async (type: DecisionType): Promise<CommitResult | null> => {
    if (!canCommit(type)) {
      toast.error(getValidationError(type) || 'Impossible de valider');
      return null;
    }

    const state = localState[type];
    const proposal = proposals.find(p => p.decision_type === type);
    
    if (!proposal) {
      toast.error('Proposition non trouvée');
      return null;
    }

    setIsCommitting(type);

    try {
      const body: Record<string, unknown> = {
        case_id: caseId,
        decision_type: type,
        proposal_json: {
          options: proposal.options,
          source_fact_ids: proposal.source_fact_ids,
        },
        selected_key: state.selectedKey === '__override__' 
          ? 'custom_override' 
          : state.selectedKey,
      };

      // Ajouter override si applicable
      if (state.selectedKey === '__override__') {
        body.override_value = state.overrideValue;
        body.override_reason = state.overrideReason;
      }

      const { data, error: fnError } = await supabase.functions.invoke('commit-decision', {
        body
      });

      if (fnError) throw fnError;

      // Gestion des erreurs HTTP retournées par la fonction
      if (data?.error) {
        if (data.allowed_statuses) {
          toast.error("Le dossier n'est pas prêt pour les décisions");
        } else {
          toast.error(data.error);
        }
        return null;
      }

      // Succès: mettre à jour l'état local
      const now = new Date().toISOString();
      setLocalState(prev => ({
        ...prev,
        [type]: {
          ...prev[type],
          isCommitted: true,
          committedAt: now,
        }
      }));

      const result: CommitResult = {
        decision_id: data.decision_id,
        remaining_decisions: data.remaining_decisions,
        all_complete: data.all_complete,
      };

      toast.success(`Décision "${DECISION_TYPE_LABELS[type].label}" validée`);

      if (result.all_complete) {
        toast.info('Toutes les décisions sont complètes !');
      }

      return result;
    } catch (err) {
      console.error('[useDecisionSupport] Error committing decision:', err);
      toast.error('Erreur lors de la validation');
      return null;
    } finally {
      setIsCommitting(null);
    }
  }, [caseId, canCommit, getValidationError, localState, proposals]);

  // ═══════════════════════════════════════════════════════════════════════════
  // STATISTIQUES (memoized)
  // ═══════════════════════════════════════════════════════════════════════════
  const stats = useMemo(() => {
    const committed = ALL_DECISION_TYPES.filter(t => localState[t].isCommitted).length;
    return {
      committedCount: committed,
      remainingCount: ALL_DECISION_TYPES.length - committed,
      allComplete: committed === ALL_DECISION_TYPES.length,
    };
  }, [localState]);

  return {
    // Données
    proposals,
    missingInfo,
    
    // États
    isLoading,
    isCommitting,
    error,
    localState,
    
    // Actions
    generateOptions,
    selectOption,
    setOverride,
    clearSelection,
    commitDecision,
    
    // Statistiques
    ...stats,
    
    // Validation
    canCommit,
    getValidationError,
  };
}
