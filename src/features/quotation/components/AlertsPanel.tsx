import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, HelpCircle, CheckCircle } from 'lucide-react';
import type { Alert } from '@/features/quotation/types';

interface AlertsPanelProps {
  alerts: Alert[];
}

export function AlertsPanel({ alerts }: AlertsPanelProps) {
  if (alerts.length === 0) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 text-amber-500">
          <AlertTriangle className="h-4 w-4" />
          Points d'attention ({alerts.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1">
          {alerts.map((alert, i) => (
            <li key={i} className="text-sm flex items-center gap-2">
              {alert.type === 'warning' && <AlertTriangle className="h-3 w-3 text-amber-500" />}
              {alert.type === 'info' && <HelpCircle className="h-3 w-3 text-ocean" />}
              {alert.type === 'error' && <AlertTriangle className="h-3 w-3 text-red-500" />}
              {alert.type === 'success' && <CheckCircle className="h-3 w-3 text-green-500" />}
              <span className="text-muted-foreground">{alert.message}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
