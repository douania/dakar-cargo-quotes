/**
 * UiSessionSummary - Phase 8.6
 * 
 * Session-only summary of user interactions with thread grouping.
 * UI-only, no backend writes, no persistence.
 */

import React from 'react';
import { Activity, Eye, Brain, ChevronDown, ChevronUp } from 'lucide-react';
import { type UsageStats } from '@/hooks/useUiUsageTracker';

interface UiSessionSummaryProps {
  stats: UsageStats;
}

/**
 * Displays a summary of user interactions during the current session.
 * Only shown if at least one action has been performed.
 */
export function UiSessionSummary({ stats }: UiSessionSummaryProps) {
  const totalActions = 
    stats.groupExpand + 
    stats.groupCollapse + 
    stats.conversationOpened + 
    stats.puzzleAnalyzed;

  // Don't render if no actions performed
  if (totalActions === 0) {
    return null;
  }

  // Calculate group usage rates (for observation only)
  const conversationGroupRate = stats.conversationOpened > 0
    ? Math.round((stats.conversationsFromGroup / stats.conversationOpened) * 100)
    : 0;
  
  const puzzleGroupRate = stats.puzzleAnalyzed > 0
    ? Math.round((stats.puzzlesFromGroup / stats.puzzleAnalyzed) * 100)
    : 0;

  return (
    <div className="mt-6 p-4 bg-muted/30 rounded-lg border border-border/50">
      <div className="flex items-center gap-2 mb-3 text-sm font-medium text-muted-foreground">
        <Activity className="h-4 w-4" />
        <span>Session actuelle</span>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        {/* Group interactions */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-muted-foreground">
            <ChevronDown className="h-3.5 w-3.5" />
            <ChevronUp className="h-3.5 w-3.5" />
          </div>
          <span>
            <strong className="text-foreground">{stats.groupExpand}</strong>
            {' '}ouvertures
          </span>
        </div>
        
        {/* Conversations viewed */}
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 text-muted-foreground" />
          <span>
            <strong className="text-foreground">{stats.conversationOpened}</strong>
            {' '}conversations
            {stats.conversationsFromGroup > 0 && (
              <span className="text-muted-foreground text-xs ml-1">
                ({conversationGroupRate}% groupes)
              </span>
            )}
          </span>
        </div>
        
        {/* Puzzles analyzed */}
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-muted-foreground" />
          <span>
            <strong className="text-foreground">{stats.puzzleAnalyzed}</strong>
            {' '}puzzles
            {stats.puzzlesFromGroup > 0 && (
              <span className="text-muted-foreground text-xs ml-1">
                ({puzzleGroupRate}% groupes)
              </span>
            )}
          </span>
        </div>
        
        {/* Total actions */}
        <div className="text-muted-foreground text-xs self-center">
          {totalActions} action{totalActions !== 1 ? 's' : ''} total
        </div>
      </div>
    </div>
  );
}

export default UiSessionSummary;
