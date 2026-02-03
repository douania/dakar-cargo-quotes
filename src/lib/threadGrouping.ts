/**
 * Thread Grouping Utilities - Phase 8.5
 * 
 * Provides UI-only visual grouping of email threads by normalized subject.
 * No backend modifications, no database writes.
 */

/**
 * Normalizes an email subject for visual grouping purposes.
 * Removes common prefixes (Re:, Fw:, Fwd:, Tr:, SPAM:) and normalizes whitespace.
 */
export function normalizeSubjectForGrouping(subject: string | null): string {
  if (!subject) return 'no-subject';
  
  return subject
    .toLowerCase()
    // Remove common email prefixes (with case-insensitive flags)
    .replace(/^re:\s*/gi, '')
    .replace(/^fw:\s*/gi, '')
    .replace(/^fwd:\s*/gi, '')
    .replace(/^tr:\s*/gi, '')      // French "Transféré"
    .replace(/^spam:\s*/gi, '')    // Spam prefix
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if two dates are within a specified time window.
 * Used to split threads with same subject but far apart in time.
 */
export function isWithinDateWindow(
  dateA: string | null,
  dateB: string | null,
  windowDays: number = 30
): boolean {
  // If either date is missing, assume they're in the same window
  if (!dateA || !dateB) return true;
  
  const a = new Date(dateA).getTime();
  const b = new Date(dateB).getTime();
  const diffMs = Math.abs(a - b);
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  
  return diffDays <= windowDays;
}

/**
 * Interface representing a visual group of threads.
 */
export interface ThreadGroup<T> {
  /** Unique key for the group (normalized subject, possibly with suffix) */
  groupKey: string;
  /** Display subject (first original subject in the group) */
  displaySubject: string;
  /** Threads in this group */
  threads: T[];
  /** Number of threads in this group */
  threadCount: number;
  /** Date range spanning all threads in the group */
  dateRange: {
    first: Date | null;
    last: Date | null;
  };
}

/**
 * Minimum thread type required for grouping.
 */
interface ThreadForGrouping {
  id: string;
  subject_normalized: string;
  first_message_at: string | null;
  last_message_at: string | null;
}

/**
 * Groups threads by normalized subject, with temporal windowing.
 * 
 * Algorithm:
 * 1. Group threads by normalized subject
 * 2. Within each subject group, sort by date
 * 3. Split into sub-groups if threads are more than 30 days apart
 * 4. Sort final groups by most recent date (descending)
 * 
 * @param threads - Array of threads to group
 * @returns Array of ThreadGroup objects
 */
export function groupThreadsBySubject<T extends ThreadForGrouping>(
  threads: T[]
): ThreadGroup<T>[] {
  const groups = new Map<string, T[]>();
  
  // First pass: group by normalized subject
  threads.forEach(thread => {
    const key = normalizeSubjectForGrouping(thread.subject_normalized);
    const existing = groups.get(key) || [];
    existing.push(thread);
    groups.set(key, existing);
  });
  
  // Second pass: apply temporal windowing and build final groups
  const result: ThreadGroup<T>[] = [];
  
  groups.forEach((threadList, groupKey) => {
    // Sort threads by date (ascending)
    const sorted = [...threadList].sort((a, b) => {
      const dateA = a.first_message_at ? new Date(a.first_message_at).getTime() : 0;
      const dateB = b.first_message_at ? new Date(b.first_message_at).getTime() : 0;
      return dateA - dateB;
    });
    
    // Sub-group by 30-day temporal window
    const subGroups: T[][] = [];
    let currentSubGroup: T[] = [];
    
    sorted.forEach(thread => {
      if (currentSubGroup.length === 0) {
        currentSubGroup.push(thread);
      } else {
        const firstInGroup = currentSubGroup[0];
        if (isWithinDateWindow(firstInGroup.first_message_at, thread.first_message_at, 30)) {
          currentSubGroup.push(thread);
        } else {
          // Thread is outside 30-day window, start new sub-group
          subGroups.push(currentSubGroup);
          currentSubGroup = [thread];
        }
      }
    });
    
    // Don't forget the last sub-group
    if (currentSubGroup.length > 0) {
      subGroups.push(currentSubGroup);
    }
    
    // Create final groups
    subGroups.forEach((subGroup, index) => {
      // Calculate date range for this sub-group
      const dates = subGroup
        .map(t => t.first_message_at ? new Date(t.first_message_at) : null)
        .filter((d): d is Date => d !== null);
      
      const lastDates = subGroup
        .map(t => t.last_message_at ? new Date(t.last_message_at) : null)
        .filter((d): d is Date => d !== null);
      
      // Combine all dates for range calculation
      const allDates = [...dates, ...lastDates];
      
      result.push({
        groupKey: subGroups.length > 1 ? `${groupKey}_${index}` : groupKey,
        displaySubject: subGroup[0].subject_normalized || 'Sans sujet',
        threads: subGroup,
        threadCount: subGroup.length,
        dateRange: {
          first: allDates.length > 0 ? new Date(Math.min(...allDates.map(d => d.getTime()))) : null,
          last: allDates.length > 0 ? new Date(Math.max(...allDates.map(d => d.getTime()))) : null,
        },
      });
    });
  });
  
  // Sort groups by most recent date (descending)
  return result.sort((a, b) => {
    const dateA = a.dateRange.last?.getTime() || 0;
    const dateB = b.dateRange.last?.getTime() || 0;
    return dateB - dateA;
  });
}
