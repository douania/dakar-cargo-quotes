/**
 * Hook de gestion des lignes services
 * Phase 4C — Extraction safe de QuotationSheet
 */

import { useState, useCallback } from 'react';
import type { ServiceLine } from '@/features/quotation/types';

interface ServiceTemplate {
  service: string;
  description: string;
  unit: string;
}

export function useServiceLines(initial: ServiceLine[] = []) {
  const [serviceLines, setServiceLines] = useState<ServiceLine[]>(initial);

  const addServiceLine = useCallback((template?: ServiceTemplate) => {
    const newLine: ServiceLine = {
      id: crypto.randomUUID(),
      service: template?.service || '',
      description: template?.description || '',
      unit: template?.unit || 'forfait',
      quantity: 1,
      currency: 'FCFA',
    };
    setServiceLines(lines => [...lines, newLine]);
  }, []);

  const updateServiceLine = useCallback((id: string, updates: Partial<ServiceLine>) => {
    setServiceLines(lines =>
      lines.map(line => (line.id === id ? { ...line, ...updates } : line))
    );
  }, []);

  const removeServiceLine = useCallback((id: string) => {
    setServiceLines(lines => lines.filter(line => line.id !== id));
  }, []);

  return {
    serviceLines,
    setServiceLines,
    addServiceLine,
    updateServiceLine,
    removeServiceLine,
  };
}
