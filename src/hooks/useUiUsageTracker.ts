/**
 * useUiUsageTracker - Phase 8.6
 * 
 * Session-only tracking of UI usage patterns for thread grouping.
 * No database writes, no server logs. Pure observation.
 * 
 * RÈGLES DE DÉCISION PHASE 9 (non implémentées, observation seulement)
 * 
 * SI:
 *   - >70% des conversations ouvertes passent par des groupes multi-fils
 *   - ET >30% des puzzles sont lancés depuis des groupes multi-fils
 * ALORS:
 *   → Backend regroupement à étudier (Phase 9)
 * 
 * SINON:
 *   → UI-only confirmé, backend inchangé
 */

import { useRef, useState, useCallback } from 'react';

export interface UsageStats {
  /** Number of times a group was expanded */
  groupExpand: number;
  /** Number of times a group was collapsed */
  groupCollapse: number;
  /** Total conversation views */
  conversationOpened: number;
  /** Total puzzle analyses launched */
  puzzleAnalyzed: number;
  /** Conversations opened from within a multi-thread group */
  conversationsFromGroup: number;
  /** Puzzles analyzed from within a multi-thread group */
  puzzlesFromGroup: number;
}

export interface UseUiUsageTrackerReturn {
  stats: UsageStats;
  trackGroupExpand: () => void;
  trackGroupCollapse: () => void;
  trackConversationOpened: (fromGroup: boolean) => void;
  trackPuzzleAnalyzed: (fromGroup: boolean) => void;
  resetStats: () => void;
  /** Manually trigger UI update after batch operations */
  refreshStats: () => void;
}

const initialStats: UsageStats = {
  groupExpand: 0,
  groupCollapse: 0,
  conversationOpened: 0,
  puzzleAnalyzed: 0,
  conversationsFromGroup: 0,
  puzzlesFromGroup: 0,
};

/**
 * Hook for tracking UI usage patterns in session memory only.
 * 
 * Uses useRef to avoid unnecessary re-renders on every tracking call.
 * Call refreshStats() to update UI when stats display is needed.
 */
export function useUiUsageTracker(): UseUiUsageTrackerReturn {
  const statsRef = useRef<UsageStats>({ ...initialStats });
  
  // Counter to trigger re-renders only when explicitly requested
  const [, setUpdateTrigger] = useState(0);
  
  // Batched update - only triggers re-render when explicitly called
  const refreshStats = useCallback(() => {
    setUpdateTrigger(prev => prev + 1);
  }, []);
  
  const trackGroupExpand = useCallback(() => {
    statsRef.current.groupExpand++;
    // Batch: don't trigger re-render on every expand
  }, []);
  
  const trackGroupCollapse = useCallback(() => {
    statsRef.current.groupCollapse++;
    // Batch: don't trigger re-render on every collapse
  }, []);
  
  const trackConversationOpened = useCallback((fromGroup: boolean) => {
    statsRef.current.conversationOpened++;
    if (fromGroup) {
      statsRef.current.conversationsFromGroup++;
    }
    // Trigger update since this is a meaningful action
    refreshStats();
  }, [refreshStats]);
  
  const trackPuzzleAnalyzed = useCallback((fromGroup: boolean) => {
    statsRef.current.puzzleAnalyzed++;
    if (fromGroup) {
      statsRef.current.puzzlesFromGroup++;
    }
    // Trigger update since this is a meaningful action
    refreshStats();
  }, [refreshStats]);
  
  const resetStats = useCallback(() => {
    statsRef.current = { ...initialStats };
    refreshStats();
  }, [refreshStats]);
  
  return {
    stats: statsRef.current,
    trackGroupExpand,
    trackGroupCollapse,
    trackConversationOpened,
    trackPuzzleAnalyzed,
    resetStats,
    refreshStats,
  };
}

export default useUiUsageTracker;
