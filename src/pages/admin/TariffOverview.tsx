import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/Header";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BarChart3, Ship, Anchor, Warehouse, Truck, Globe } from "lucide-react";

const formatAmount = (n: number | null) => n != null ? new Intl.NumberFormat('fr-FR').format(n) : '-';

const getEvidenceBadge = (level: string | null) => {
  switch (level) {
    case 'official': return <Badge className="bg-green-600 text-white text-xs">Officiel</Badge>;
    case 'observed': return <Badge className="bg-amber-500 text-white text-xs">Observé</Badge>;
    case 'to_confirm': return <Badge variant="secondary" className="text-xs">À confirmer</Badge>;
    default: return null;
  }
};

function PortTariffsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['tariff-overview-port'],
    queryFn: async () => {
      const { data, error } = await supabase.from('port_tariffs').select('id, provider, category, classification, operation_type, cargo_type, amount, unit, is_active, evidence_level').order('provider').limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Fournisseur</TableHead>
          <TableHead>Catégorie</TableHead>
          <TableHead>Opération</TableHead>
          <TableHead>Classification</TableHead>
          <TableHead className="text-right">Montant</TableHead>
          <TableHead>Preuve</TableHead>
          <TableHead>Actif</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? <TableRow><TableCell colSpan={7} className="text-center py-6">Chargement...</TableCell></TableRow> :
        data?.map(r => (
          <TableRow key={r.id} className={!r.is_active ? 'opacity-50' : ''}>
            <TableCell><Badge variant="outline">{r.provider}</Badge></TableCell>
            <TableCell className="text-sm">{r.category}</TableCell>
            <TableCell className="text-sm">{r.operation_type}</TableCell>
            <TableCell className="text-sm font-medium">{r.classification}</TableCell>
            <TableCell className="text-right font-mono">{formatAmount(r.amount)} {r.unit}</TableCell>
            <TableCell>{getEvidenceBadge(r.evidence_level)}</TableCell>
            <TableCell>{r.is_active ? '✓' : '✗'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function CarrierTemplatesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['tariff-overview-carrier'],
    queryFn: async () => {
      const { data, error } = await supabase.from('carrier_billing_templates').select('id, carrier, charge_code, charge_name, calculation_method, default_amount, currency, operation_type, is_active').order('carrier').limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Compagnie</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Frais</TableHead>
          <TableHead>Calcul</TableHead>
          <TableHead className="text-right">Montant</TableHead>
          <TableHead>Opération</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-6">Chargement...</TableCell></TableRow> :
        data?.map(r => (
          <TableRow key={r.id} className={!r.is_active ? 'opacity-50' : ''}>
            <TableCell><Badge variant="outline">{r.carrier}</Badge></TableCell>
            <TableCell className="font-mono text-sm">{r.charge_code}</TableCell>
            <TableCell className="text-sm">{r.charge_name}</TableCell>
            <TableCell className="text-xs text-muted-foreground">{r.calculation_method}</TableCell>
            <TableCell className="text-right font-mono">{formatAmount(r.default_amount)} {r.currency}</TableCell>
            <TableCell className="text-sm">{r.operation_type || '-'}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function DemurrageTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['tariff-overview-demurrage'],
    queryFn: async () => {
      const { data, error } = await supabase.from('demurrage_rates').select('id, carrier, container_type, free_days_import, free_days_export, day_1_7_rate, day_8_14_rate, day_15_plus_rate, currency, is_active').order('carrier').limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Compagnie</TableHead>
          <TableHead>Conteneur</TableHead>
          <TableHead>Franchise Import</TableHead>
          <TableHead>Franchise Export</TableHead>
          <TableHead className="text-right">J1-7</TableHead>
          <TableHead className="text-right">J8-14</TableHead>
          <TableHead className="text-right">J15+</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? <TableRow><TableCell colSpan={7} className="text-center py-6">Chargement...</TableCell></TableRow> :
        data?.map(r => (
          <TableRow key={r.id} className={!r.is_active ? 'opacity-50' : ''}>
            <TableCell><Badge variant="outline">{r.carrier}</Badge></TableCell>
            <TableCell className="text-sm">{r.container_type}</TableCell>
            <TableCell className="text-center">{r.free_days_import}j</TableCell>
            <TableCell className="text-center">{r.free_days_export}j</TableCell>
            <TableCell className="text-right font-mono">{formatAmount(r.day_1_7_rate)}</TableCell>
            <TableCell className="text-right font-mono">{formatAmount(r.day_8_14_rate)}</TableCell>
            <TableCell className="text-right font-mono">{formatAmount(r.day_15_plus_rate)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function WarehouseTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['tariff-overview-warehouse'],
    queryFn: async () => {
      const { data, error } = await supabase.from('warehouse_franchise').select('*').order('provider').limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Provider</TableHead>
          <TableHead>Cargo</TableHead>
          <TableHead>Conteneur</TableHead>
          <TableHead>Franchise</TableHead>
          <TableHead className="text-right">Tarif/jour</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? <TableRow><TableCell colSpan={5} className="text-center py-6">Chargement...</TableCell></TableRow> :
        data?.map(r => (
          <TableRow key={r.id}>
            <TableCell><Badge variant="outline">{r.provider}</Badge></TableCell>
            <TableCell className="text-sm">{r.cargo_type}</TableCell>
            <TableCell className="text-sm">{r.container_type || '-'}</TableCell>
            <TableCell className="text-center">{r.free_days}j</TableCell>
            <TableCell className="text-right font-mono">{formatAmount(r.rate_per_day)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TransportTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['tariff-overview-transport'],
    queryFn: async () => {
      const { data, error } = await supabase.from('local_transport_rates').select('*').order('destination').limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Destination</TableHead>
          <TableHead>Conteneur</TableHead>
          <TableHead>Cargo</TableHead>
          <TableHead className="text-right">Tarif</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? <TableRow><TableCell colSpan={4} className="text-center py-6">Chargement...</TableCell></TableRow> :
        data?.map(r => (
          <TableRow key={r.id}>
            <TableCell className="font-medium">{r.destination}</TableCell>
            <TableCell className="text-sm">{r.container_type || '-'}</TableCell>
            <TableCell className="text-sm">{r.cargo_category || '-'}</TableCell>
            <TableCell className="text-right font-mono">{formatAmount(r.rate_amount)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ClearingTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['tariff-overview-clearing'],
    queryFn: async () => {
      const { data, error } = await supabase.from('border_clearing_rates').select('id, corridor, country, charge_code, charge_name, amount_20ft, amount_40ft, currency, is_active').order('corridor').limit(200);
      if (error) throw error;
      return data;
    },
  });
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Corridor</TableHead>
          <TableHead>Pays</TableHead>
          <TableHead>Code</TableHead>
          <TableHead>Frais</TableHead>
          <TableHead className="text-right">20ft</TableHead>
          <TableHead className="text-right">40ft</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? <TableRow><TableCell colSpan={6} className="text-center py-6">Chargement...</TableCell></TableRow> :
        data?.map(r => (
          <TableRow key={r.id} className={!r.is_active ? 'opacity-50' : ''}>
            <TableCell className="font-medium">{r.corridor}</TableCell>
            <TableCell className="text-sm">{r.country}</TableCell>
            <TableCell className="font-mono text-sm">{r.charge_code}</TableCell>
            <TableCell className="text-sm">{r.charge_name}</TableCell>
            <TableCell className="text-right font-mono">{formatAmount(r.amount_20ft)}</TableCell>
            <TableCell className="text-right font-mono">{formatAmount(r.amount_40ft)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function TariffOverview() {
  const [activeTab, setActiveTab] = useState('port');

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8">
        <div className="flex items-center gap-3 mb-6">
          <BarChart3 className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-2xl font-bold">Vue Tarifs Consolidée</h1>
            <p className="text-muted-foreground">Lecture seule — cliquez sur une page admin pour éditer</p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="port" className="gap-1"><Anchor className="h-3 w-3" />Port</TabsTrigger>
            <TabsTrigger value="carrier" className="gap-1"><Ship className="h-3 w-3" />Compagnies</TabsTrigger>
            <TabsTrigger value="demurrage" className="gap-1"><Ship className="h-3 w-3" />Surestaries</TabsTrigger>
            <TabsTrigger value="warehouse" className="gap-1"><Warehouse className="h-3 w-3" />Magasinage</TabsTrigger>
            <TabsTrigger value="transport" className="gap-1"><Truck className="h-3 w-3" />Transport</TabsTrigger>
            <TabsTrigger value="clearing" className="gap-1"><Globe className="h-3 w-3" />Dédouanement</TabsTrigger>
          </TabsList>

          <div className="border rounded-lg mt-4 overflow-x-auto">
            <TabsContent value="port" className="m-0"><PortTariffsTab /></TabsContent>
            <TabsContent value="carrier" className="m-0"><CarrierTemplatesTab /></TabsContent>
            <TabsContent value="demurrage" className="m-0"><DemurrageTab /></TabsContent>
            <TabsContent value="warehouse" className="m-0"><WarehouseTab /></TabsContent>
            <TabsContent value="transport" className="m-0"><TransportTab /></TabsContent>
            <TabsContent value="clearing" className="m-0"><ClearingTab /></TabsContent>
          </div>
        </Tabs>
      </main>
    </div>
  );
}
