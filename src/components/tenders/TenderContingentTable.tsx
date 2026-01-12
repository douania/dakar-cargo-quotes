import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface TenderContingent {
  id: string;
  contingent_name: string;
  origin_location: string | null;
  destination_port: string | null;
  destination_site: string | null;
  cargo_teus: number;
  cargo_vehicles: number;
  cargo_tonnes: number;
  cargo_cbm: number;
  deadline_ddd: string | null;
  status: string;
  total_cost_estimate: number | null;
  selling_price: number | null;
}

interface TenderContingentTableProps {
  contingents: TenderContingent[];
}

const statusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: 'En attente', color: 'bg-muted text-muted-foreground' },
  quoted: { label: 'Coté', color: 'bg-blue-100 text-blue-800' },
  confirmed: { label: 'Confirmé', color: 'bg-green-100 text-green-800' },
};

export function TenderContingentTable({ contingents }: TenderContingentTableProps) {
  const totals = contingents.reduce((acc, c) => ({
    teus: acc.teus + (c.cargo_teus || 0),
    vehicles: acc.vehicles + (c.cargo_vehicles || 0),
    tonnes: acc.tonnes + (c.cargo_tonnes || 0),
    cbm: acc.cbm + (c.cargo_cbm || 0),
    cost: acc.cost + (c.total_cost_estimate || 0),
    price: acc.price + (c.selling_price || 0),
  }), { teus: 0, vehicles: 0, tonnes: 0, cbm: 0, cost: 0, price: 0 });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Détail des contingents</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contingent</TableHead>
                <TableHead>Origine</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead className="text-right">TEUs</TableHead>
                <TableHead className="text-right">Véhicules</TableHead>
                <TableHead className="text-right">Tonnes</TableHead>
                <TableHead className="text-right">m³</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead className="text-right">Coût estimé</TableHead>
                <TableHead>Statut</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contingents.map((contingent) => {
                const config = statusConfig[contingent.status] || statusConfig.pending;
                return (
                  <TableRow key={contingent.id}>
                    <TableCell className="font-medium">{contingent.contingent_name}</TableCell>
                    <TableCell>{contingent.origin_location || '-'}</TableCell>
                    <TableCell>
                      <div>
                        <span className="font-medium">{contingent.destination_port || '-'}</span>
                        {contingent.destination_site && (
                          <span className="text-xs text-muted-foreground block">
                            {contingent.destination_site}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{contingent.cargo_teus || '-'}</TableCell>
                    <TableCell className="text-right">{contingent.cargo_vehicles || '-'}</TableCell>
                    <TableCell className="text-right">
                      {contingent.cargo_tonnes ? contingent.cargo_tonnes.toLocaleString() : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      {contingent.cargo_cbm ? contingent.cargo_cbm.toLocaleString() : '-'}
                    </TableCell>
                    <TableCell>
                      {contingent.deadline_ddd 
                        ? format(new Date(contingent.deadline_ddd), 'dd/MM/yyyy', { locale: fr })
                        : '-'
                      }
                    </TableCell>
                    <TableCell className="text-right">
                      {contingent.total_cost_estimate 
                        ? `${contingent.total_cost_estimate.toLocaleString()} €`
                        : '-'
                      }
                    </TableCell>
                    <TableCell>
                      <Badge className={config.color}>{config.label}</Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {/* Totals Row */}
              <TableRow className="bg-muted/50 font-medium">
                <TableCell>TOTAL</TableCell>
                <TableCell colSpan={2}>{contingents.length} contingents</TableCell>
                <TableCell className="text-right">{totals.teus || '-'}</TableCell>
                <TableCell className="text-right">{totals.vehicles || '-'}</TableCell>
                <TableCell className="text-right">
                  {totals.tonnes ? totals.tonnes.toLocaleString() : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {totals.cbm ? totals.cbm.toLocaleString() : '-'}
                </TableCell>
                <TableCell>-</TableCell>
                <TableCell className="text-right">
                  {totals.cost ? `${totals.cost.toLocaleString()} €` : '-'}
                </TableCell>
                <TableCell>-</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
