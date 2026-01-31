/**
 * UI COMPONENT — Phase 5B
 * QuotationTotalsCard - Affichage recapitulatif des totaux engine
 * Aucune logique metier, props only
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, Calculator, Package, Scale, Box } from 'lucide-react';
import type { QuotationTotals, QuoteIssue } from '@/features/quotation/domain/types';

interface QuotationTotalsCardProps {
  totals: QuotationTotals;
  currency?: string;
  issues?: ReadonlyArray<QuoteIssue>;
}

function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString('fr-FR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatMoney(amount: number, currency: string): string {
  return `${formatNumber(amount)} ${currency}`;
}

function MetricItem({
  icon,
  label,
  value,
  unit,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="text-center p-3 rounded-lg bg-muted/30">
      <div className="flex items-center justify-center gap-1 mb-1">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-semibold">
        {value}
        {unit && <span className="text-sm font-normal text-muted-foreground ml-1">{unit}</span>}
      </p>
    </div>
  );
}

function TotalRow({
  label,
  amount,
  currency,
  bold = false,
  highlight = false,
}: {
  label: string;
  amount: number;
  currency: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1 ${
        highlight ? 'bg-primary/10 px-2 rounded -mx-2' : ''
      }`}
    >
      <span className={`text-sm ${bold ? 'font-medium' : 'text-muted-foreground'}`}>
        {label}
      </span>
      <span className={`text-sm ${bold ? 'font-semibold' : ''}`}>
        {formatMoney(amount, currency)}
      </span>
    </div>
  );
}

export function QuotationTotalsCard({
  totals,
  currency = 'FCFA',
  issues = [],
}: QuotationTotalsCardProps) {
  const { subtotal_cargo_metrics, subtotal_services, total_ht, total_tax, total_ttc } = totals;
  const hasTax = total_tax > 0;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calculator className="h-4 w-4 text-primary" />
          Récapitulatif
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Métriques cargo */}
        <div className="grid grid-cols-3 gap-4">
          <MetricItem
            icon={<Scale className="h-4 w-4 text-muted-foreground" />}
            label="Poids total"
            value={formatNumber(subtotal_cargo_metrics.total_weight_kg)}
            unit="kg"
          />
          <MetricItem
            icon={<Box className="h-4 w-4 text-muted-foreground" />}
            label="Volume total"
            value={formatNumber(subtotal_cargo_metrics.total_volume_m3, 2)}
            unit="m³"
          />
          <MetricItem
            icon={<Package className="h-4 w-4 text-muted-foreground" />}
            label="Quantité"
            value={formatNumber(subtotal_cargo_metrics.total_quantity)}
          />
        </div>

        <Separator />

        {/* Totaux financiers */}
        <div className="space-y-2">
          <TotalRow
            label="Sous-total services"
            amount={subtotal_services}
            currency={currency}
          />
          <TotalRow
            label="Total HT"
            amount={total_ht}
            currency={currency}
            bold
          />
          {hasTax && (
            <>
              <TotalRow
                label="TVA"
                amount={total_tax}
                currency={currency}
              />
              <TotalRow
                label="Total TTC"
                amount={total_ttc}
                currency={currency}
                bold
                highlight
              />
            </>
          )}
        </div>

        {/* Issues / Alertes engine */}
        {issues.length > 0 && (
          <div className="mt-4 p-3 bg-warning/10 rounded-lg border border-warning/30">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-warning" />
              <span className="text-sm font-medium">
                Alertes de calcul
              </span>
            </div>
            <div className="space-y-1">
              {issues.map((issue, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  {issue.message}
                  {issue.path && <span className="text-muted-foreground/70"> ({issue.path})</span>}
                </p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
