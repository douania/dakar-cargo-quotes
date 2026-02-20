/**
 * DutyBreakdownTable — Détail des droits et taxes par article
 * Affiche la ventilation complète similaire à une note douanière réelle.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronDown, ChevronUp, FileSearch } from 'lucide-react';
import type { DutyBreakdownItem } from '@/hooks/usePricingResultData';

interface DutyBreakdownTableProps {
  items: DutyBreakdownItem[];
  currency?: string;
}

const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n);
const pct = (r: number) => `${r}%`;

export function DutyBreakdownTable({ items, currency = 'XOF' }: DutyBreakdownTableProps) {
  const [expanded, setExpanded] = useState(false);

  if (!items || items.length === 0) return null;

  const taxColumns: { label: string; rateKey: keyof DutyBreakdownItem; amountKey: keyof DutyBreakdownItem }[] = [
    { label: 'DD', rateKey: 'dd_rate', amountKey: 'dd_amount' },
    { label: 'Surtaxe', rateKey: 'surtaxe_rate', amountKey: 'surtaxe_amount' },
    { label: 'RS', rateKey: 'rs_rate', amountKey: 'rs_amount' },
    { label: 'TIN', rateKey: 'tin_rate', amountKey: 'tin_amount' },
    { label: 'TCI', rateKey: 'tci_rate', amountKey: 'tci_amount' },
    { label: 'PCS', rateKey: 'pcs_rate', amountKey: 'pcs_amount' },
    { label: 'PCC', rateKey: 'pcc_rate', amountKey: 'pcc_amount' },
    { label: 'COSEC', rateKey: 'cosec_rate', amountKey: 'cosec_amount' },
    { label: 'PROMAD', rateKey: 'promad_rate', amountKey: 'promad_amount' },
  ];

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between">
          <span className="flex items-center gap-2">
            <FileSearch className="h-4 w-4" />
            Détail droits et taxes par article
            <Badge variant="secondary" className="text-xs ml-1">{items.length} article{items.length > 1 ? 's' : ''}</Badge>
          </span>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted">
                <TableHead className="text-xs font-medium">#</TableHead>
                <TableHead className="text-xs font-medium">Code HS</TableHead>
                <TableHead className="text-xs font-medium text-right">CAF ({currency})</TableHead>
                {taxColumns.map(col => (
                  <TableHead key={col.label} className="text-xs font-medium text-right">{col.label}</TableHead>
                ))}
                <TableHead className="text-xs font-medium text-right">Base TVA</TableHead>
                <TableHead className="text-xs font-medium text-right">TVA</TableHead>
                <TableHead className="text-xs font-medium text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.article_index}>
                  <TableCell className="text-xs font-mono">{item.article_index}</TableCell>
                  <TableCell className="text-xs font-mono">{item.hs_code}</TableCell>
                  <TableCell className="text-xs text-right">{fmt(item.caf)}</TableCell>
                  {taxColumns.map(col => {
                    const rate = item[col.rateKey] as number;
                    const amount = item[col.amountKey] as number;
                    return (
                      <TableCell key={col.label} className="text-xs text-right">
                        {amount > 0 ? (
                          <span title={pct(rate)}>{fmt(amount)}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell className="text-xs text-right">{fmt(item.base_tva)}</TableCell>
                  <TableCell className="text-xs text-right">
                    <span title={pct(item.tva_rate)}>{fmt(item.tva_amount)}</span>
                  </TableCell>
                  <TableCell className="text-xs text-right font-semibold">{fmt(item.total_duties)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="px-3 py-2 bg-muted/30 text-xs text-muted-foreground">
            Les montants entre parenthèses au survol indiquent les taux appliqués. Base TVA = CAF + DD + Surtaxe + RS + TIN + TCI.
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
