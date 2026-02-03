/**
 * ThreadSubjectGroup - Phase 8.5
 * 
 * Visual grouping wrapper for email threads sharing the same normalized subject.
 * UI-only component, no backend modifications.
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight, HelpCircle, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { type ThreadGroup } from '@/lib/threadGrouping';

interface ThreadSubjectGroupProps<T> {
  /** The thread group to display */
  group: ThreadGroup<T>;
  /** Render function for individual threads */
  renderThread: (thread: T, index: number) => React.ReactNode;
  /** Phase 8.6: Callback when group is expanded (optional) */
  onGroupExpand?: () => void;
  /** Phase 8.6: Callback when group is collapsed (optional) */
  onGroupCollapse?: () => void;
}

/**
 * Displays a collapsible group of threads with the same normalized subject.
 * 
 * Behavior:
 * - Single thread: rendered directly without wrapper
 * - 2-6 threads: expanded by default
 * - 7+ threads: collapsed by default
 */
export function ThreadSubjectGroup<T extends { id: string }>({
  group,
  renderThread,
  onGroupExpand,
  onGroupCollapse,
}: ThreadSubjectGroupProps<T>) {
  // Determine default open state based on thread count
  // Must call hooks before any conditional returns
  const defaultOpen = group.threadCount <= 6;
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  // Phase 8.6: Track initial open state to avoid triggering on mount
  const hasInitialized = React.useRef(false);
  
  // Phase 8.6: Handle open state change with tracking
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    
    // Only track after initial render to avoid counting default open state
    if (hasInitialized.current) {
      if (open) {
        onGroupExpand?.();
      } else {
        onGroupCollapse?.();
      }
    } else {
      hasInitialized.current = true;
    }
  };
  
  // Single thread: render directly without grouping wrapper
  if (group.threadCount === 1) {
    return <>{renderThread(group.threads[0], 0)}</>;
  }
  
  // Format date range for display
  const formatDateRange = () => {
    if (!group.dateRange.first || !group.dateRange.last) return null;
    
    const first = group.dateRange.first.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
    });
    const last = group.dateRange.last.toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: 'short',
    });
    
    return first === last ? first : `${first} → ${last}`;
  };
  
  const dateRange = formatDateRange();
  
  return (
    <TooltipProvider>
      <Collapsible open={isOpen} onOpenChange={handleOpenChange}>
        {/* Group Header */}
        <div className="bg-muted/50 rounded-lg border border-border/60 mb-2">
          <CollapsibleTrigger asChild>
            <button
              className="w-full flex items-center justify-between p-3 hover:bg-muted/80 transition-colors rounded-lg text-left"
              type="button"
            >
              <div className="flex items-center gap-3 min-w-0 flex-1">
                {/* Expand/Collapse Icon */}
                {isOpen ? (
                  <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                )}
                
                {/* Group Icon */}
                <Layers className="h-4 w-4 text-primary flex-shrink-0" />
                
                {/* Subject */}
                <span className="font-medium text-sm truncate">
                  {group.displaySubject}
                </span>
              </div>
              
              <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                {/* Date Range */}
                {dateRange && (
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {dateRange}
                  </span>
                )}
                
                {/* Thread Count Badge */}
                <Badge variant="secondary" className="text-xs">
                  {group.threadCount} fils
                </Badge>
                
                {/* Visual Grouping Indicator with Tooltip */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge 
                      variant="outline" 
                      className="text-xs bg-secondary text-secondary-foreground border-border cursor-help"
                    >
                      <HelpCircle className="h-3 w-3 mr-1" />
                      Regroupement
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="left" className="max-w-xs">
                    <p className="text-sm">
                      Ces fils sont regroupés visuellement par sujet similaire.
                      <br />
                      <span className="text-muted-foreground">
                        Les données backend ne sont pas fusionnées.
                      </span>
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </button>
          </CollapsibleTrigger>
          
          {/* Collapsed Preview: Show first thread subject if collapsed */}
          {!isOpen && group.threadCount > 1 && (
            <div className="px-4 pb-2 text-xs text-muted-foreground">
              Cliquez pour voir les {group.threadCount} fils de cette conversation
            </div>
          )}
        </div>
        
        {/* Threads List */}
        <CollapsibleContent>
          <div className="space-y-3 pl-4 border-l-2 border-primary/20 ml-2">
            {group.threads.map((thread, index) => (
              <div key={thread.id}>
                {renderThread(thread, index)}
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </TooltipProvider>
  );
}

export default ThreadSubjectGroup;
