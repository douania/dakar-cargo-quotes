/**
 * Hook de gestion des lignes cargo
 * Phase 4C — Extraction safe de QuotationSheet
 */

import { useState, useCallback } from 'react';
import type { CargoLine } from '@/features/quotation/types';

export function useCargoLines(initial: CargoLine[] = []) {
  const [cargoLines, setCargoLines] = useState<CargoLine[]>(initial);

  const addCargoLine = useCallback((type: 'container' | 'breakbulk') => {
    const newLine: CargoLine = {
      id: crypto.randomUUID(),
      description: '',
      origin: '',
      cargo_type: type,
      container_type: type === 'container' ? '40HC' : undefined,
      container_count: type === 'container' ? 1 : undefined,
      coc_soc: 'COC',
    };
    setCargoLines(lines => [...lines, newLine]);
  }, []);

  const updateCargoLine = useCallback((id: string, updates: Partial<CargoLine>) => {
    setCargoLines(lines =>
      lines.map(line => (line.id === id ? { ...line, ...updates } : line))
    );
  }, []);

  const removeCargoLine = useCallback((id: string) => {
    setCargoLines(lines => lines.filter(line => line.id !== id));
  }, []);

  return {
    cargoLines,
    setCargoLines,
    addCargoLine,
    updateCargoLine,
    removeCargoLine,
  };
}
