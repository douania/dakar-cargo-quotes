/**
 * ThreadStructureIndicators - Phase 8.6
 * 
 * Non-interactive display of thread structure metrics.
 * UI-only, no backend modifications.
 */

import React from 'react';
import { Layers, GitBranch, Mail } from 'lucide-react';

interface ThreadStructureIndicatorsProps {
  /** Number of visual groups */
  groupCount: number;
  /** Total number of threads */
  threadCount: number;
  /** Total number of emails across all threads */
  emailCount: number;
}

/**
 * Displays structure indicators for the thread list.
 * Shows group count, thread count, and email count.
 */
export function ThreadStructureIndicators({
  groupCount,
  threadCount,
  emailCount,
}: ThreadStructureIndicatorsProps) {
  // Don't render if no data
  if (threadCount === 0) {
    return null;
  }

  // Calculate if there's actual grouping happening
  const hasGrouping = groupCount < threadCount;

  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-muted/30 rounded-lg border border-border/50 text-sm text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <Layers className="h-4 w-4" />
        <span>
          <strong className="text-foreground">{groupCount}</strong>
          {' '}groupe{groupCount !== 1 ? 's' : ''}
        </span>
      </div>
      
      <span className="text-border">/</span>
      
      <div className="flex items-center gap-1.5">
        <GitBranch className="h-4 w-4" />
        <span>
          <strong className="text-foreground">{threadCount}</strong>
          {' '}fil{threadCount !== 1 ? 's' : ''}
        </span>
      </div>
      
      <span className="text-border">/</span>
      
      <div className="flex items-center gap-1.5">
        <Mail className="h-4 w-4" />
        <span>
          <strong className="text-foreground">{emailCount}</strong>
          {' '}email{emailCount !== 1 ? 's' : ''}
        </span>
      </div>
      
      {hasGrouping && (
        <span className="ml-2 text-xs text-muted-foreground/70">
          (regroupés par sujet)
        </span>
      )}
    </div>
  );
}

export default ThreadStructureIndicators;
