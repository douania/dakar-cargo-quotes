import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DollarSign, Package, Truck, History } from 'lucide-react';

export function QuickActionsCard() {
  return (
    <Card className="border-border/50 bg-gradient-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Actions rapides</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button variant="outline" className="w-full justify-start" size="sm">
          <DollarSign className="h-4 w-4 mr-2" />
          Calculer droits de douane
        </Button>
        <Button variant="outline" className="w-full justify-start" size="sm">
          <Package className="h-4 w-4 mr-2" />
          Rechercher code SH
        </Button>
        <Button variant="outline" className="w-full justify-start" size="sm">
          <Truck className="h-4 w-4 mr-2" />
          Tarifs transport routier
        </Button>
        <Button variant="outline" className="w-full justify-start" size="sm">
          <History className="h-4 w-4 mr-2" />
          Voir cotations similaires
        </Button>
      </CardContent>
    </Card>
  );
}
