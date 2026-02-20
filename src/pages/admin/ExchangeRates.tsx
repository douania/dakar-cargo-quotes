import { useState, useEffect } from 'react';
import { MainLayout } from '@/components/layout/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Plus, Loader2, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  computeValidUntil,
  PERIOD_LABELS,
  DAY_LABELS,
  COMMON_CURRENCIES,
  type ValidityPeriod,
} from '@/lib/exchangeRateUtils';

interface ExchangeRate {
  id: string;
  currency_code: string;
  rate_to_xof: number;
  source: string;
  valid_from: string;
  valid_until: string;
  updated_by: string | null;
  created_at: string | null;
}

export default function ExchangeRates() {
  const [rates, setRates] = useState<ExchangeRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Form state
  const [currency, setCurrency] = useState('USD');
  const [customCurrency, setCustomCurrency] = useState('');
  const [rateValue, setRateValue] = useState('');
  const [period, setPeriod] = useState<ValidityPeriod>('weekly');
  const [dayOfWeek, setDayOfWeek] = useState(3); // Mercredi
  const [source, setSource] = useState('GAINDE');
  const [submitting, setSubmitting] = useState(false);

  const fetchRates = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('exchange_rates')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      toast.error('Erreur chargement des taux');
    } else {
      setRates(data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchRates(); }, []);

  const isActive = (r: ExchangeRate) => {
    const now = new Date().toISOString();
    return r.valid_from <= now && r.valid_until >= now;
  };

  const handleSubmit = async () => {
    const cur = currency === '__custom__' ? customCurrency.trim().toUpperCase() : currency;
    const rate = Number(rateValue);

    if (!cur || cur.length < 2) { toast.error('Devise invalide'); return; }
    if (!Number.isFinite(rate) || rate <= 0) { toast.error('Taux invalide'); return; }

    setSubmitting(true);
    try {
      const validUntil = computeValidUntil(period, dayOfWeek);

      const { error } = await supabase.functions.invoke('upsert-exchange-rate', {
        body: { currency_code: cur, rate_to_xof: rate, valid_until: validUntil, source },
      });
      if (error) throw error;

      toast.success(`Taux ${cur}/XOF = ${rate} enregistré`);
      setDialogOpen(false);
      resetForm();
      fetchRates();
    } catch (err: any) {
      toast.error(err.message || 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setCurrency('USD');
    setCustomCurrency('');
    setRateValue('');
    setPeriod('weekly');
    setDayOfWeek(3);
    setSource('GAINDE');
  };

  return (
    <MainLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Taux de change</h1>
            <p className="text-muted-foreground">Gestion des taux de conversion devises → XOF</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchRates} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
              Actualiser
            </Button>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Nouveau taux</Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Ajouter un taux de change</DialogTitle>
                  <DialogDescription>
                    Les dates de validité sont calculées automatiquement selon la période choisie.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  {/* Devise */}
                  <div className="space-y-2">
                    <Label>Devise</Label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COMMON_CURRENCIES.map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                        <SelectItem value="__custom__">Autre…</SelectItem>
                      </SelectContent>
                    </Select>
                    {currency === '__custom__' && (
                      <Input
                        placeholder="Code devise (ex: CHF)"
                        value={customCurrency}
                        onChange={e => setCustomCurrency(e.target.value)}
                        maxLength={5}
                      />
                    )}
                  </div>

                  {/* Taux */}
                  <div className="space-y-2">
                    <Label>1 {currency === '__custom__' ? customCurrency || '???' : currency} = ? XOF</Label>
                    <Input
                      type="number" step="0.01" min="0"
                      placeholder="Ex: 605.50"
                      value={rateValue}
                      onChange={e => setRateValue(e.target.value)}
                    />
                  </div>

                  {/* Période */}
                  <div className="space-y-2">
                    <Label>Période de validité</Label>
                    <Select value={period} onValueChange={v => setPeriod(v as ValidityPeriod)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(PERIOD_LABELS) as ValidityPeriod[]).map(p => (
                          <SelectItem key={p} value={p}>{PERIOD_LABELS[p]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Jour de la semaine (si hebdomadaire) */}
                  {period === 'weekly' && (
                    <div className="space-y-2">
                      <Label>Expire le (jour de la semaine)</Label>
                      <Select value={String(dayOfWeek)} onValueChange={v => setDayOfWeek(Number(v))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DAY_LABELS.map((label, i) => (
                            <SelectItem key={i} value={String(i)}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Source */}
                  <div className="space-y-2">
                    <Label>Source</Label>
                    <Input value={source} onChange={e => setSource(e.target.value)} placeholder="GAINDE" />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>Annuler</Button>
                  <Button onClick={handleSubmit} disabled={submitting || !rateValue}>
                    {submitting ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Enregistrement…</> : 'Enregistrer'}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Taux enregistrés</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : rates.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">Aucun taux enregistré</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Devise</TableHead>
                    <TableHead className="text-right">Taux / XOF</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Valide du</TableHead>
                    <TableHead>Valide jusqu'au</TableHead>
                    <TableHead>Statut</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rates.map(r => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.currency_code}</TableCell>
                      <TableCell className="text-right font-mono">
                        {r.rate_to_xof.toLocaleString('fr-FR', { maximumFractionDigits: 4 })}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{r.source}</TableCell>
                      <TableCell className="text-sm">
                        {format(new Date(r.valid_from), 'dd MMM yyyy HH:mm', { locale: fr })}
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.valid_until.startsWith('2100') ? 'Permanent' : format(new Date(r.valid_until), 'dd MMM yyyy HH:mm', { locale: fr })}
                      </TableCell>
                      <TableCell>
                        {isActive(r) ? (
                          <Badge className="bg-green-600/20 text-green-700 border-green-600/30">Actif</Badge>
                        ) : (
                          <Badge variant="secondary" className="text-muted-foreground">Expiré</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
}
