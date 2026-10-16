import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MainLayout } from '@/components/layout/MainLayout';
import { AirHandlingResult } from '@/components/case/AirHandlingPanel';
import { AirCatalogueAdmin } from '@/components/case/AirCatalogueAdmin';
import { readAirProfiles, previewAir, airMoney } from '@/lib/airHandlingApi';
import { supabase } from '@/integrations/supabase/client';
import { validAirRates, type AirRates, type AirResolution } from '../../../supabase/functions/_shared/air-handling';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const fields: Array<[keyof AirRates, string]> = [['collection_per_kg', 'Collecte HT par kg taxable'], ['security_per_kg', 'Sécurité HT par kg taxable'],
  ['documents', 'Remise documentaire HT'], ['warehouse_passage', 'Taxe fixe magasin DMS HT, éligibilité attestée'], ['it', 'Informatique HT']];
export default function AirHandling() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['air-handling-profiles'], queryFn: readAirProfiles, retry: false });
  const [selected, setSelected] = useState(''); const [rates, setRates] = useState<Record<string, string>>({});
  const [source, setSource] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState(''); const [pending, setPending] = useState(false);
  const [weight, setWeight] = useState(''); const [warehouse, setWarehouse] = useState(false);
  const [result, setResult] = useState<AirResolution | null>(null);
  const requestId = useRef<string | null>(null), lock = useRef(false), mounted = useRef(true);
  const previewGeneration = useRef(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const profile = query.data?.profiles.find(p => p.id === selected);
  useEffect(() => { previewGeneration.current++; setResult(null); }, [selected]);
  useEffect(() => { document.title = 'Handling aéroportuaire · DCQ'; mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!selected && query.data?.profiles.length) {
    const p = query.data.profiles[query.data.profiles.length - 1]; setSelected(p.id);
    setRates(Object.fromEntries(fields.map(([k]) => [k, String(p.rates[k])])));
  } }, [query.data, selected]);
  const edit = () => { requestId.current = null; setError(''); };
  const invalid = (message: string) => { setError(message); queueMicrotask(() => errorRef.current?.focus()); };
  async function save() {
    if (lock.current || !profile || !query.data?.can_edit) return;
    const numeric = Object.fromEntries(fields.map(([k]) => [k, rates[k]?.trim() ? Number(rates[k]) : NaN]));
    if (!validAirRates(numeric) || source.trim().length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return invalid('Renseignez les cinq montants HT, une date valide et la référence de validation d’au moins 10 caractères.');
    lock.current = true; setPending(true); setError(''); requestId.current ??= crypto.randomUUID();
    try {
      const { error: writeError } = await supabase.rpc('air_handling_publish', { p_id: requestId.current, p_parent_id: profile.id, p_rates: numeric,
        p_effective_from: date, p_effective_to: endDate || null, p_source_reference: source.trim() });
      const verified = await readAirProfiles(); // Check both successful and uncertain writes by the stable operation ID.
      const created = verified.profiles.find(p => p.id === requestId.current);
      if (!created || (writeError && created.source_reference !== source.trim())) throw new Error('Save unconfirmed');
      if (!mounted.current) return;
      previewGeneration.current++; setResult(null);
      qc.setQueryData(['air-handling-profiles'], verified); setSelected(created.id); setSource('');
      setRates(Object.fromEntries(fields.map(([k]) => [k, String(created.rates[k])])));
      toast.success('Nouvelle révision enregistrée. Les sélections et devis antérieurs sont conservés.'); requestId.current = null;
    } catch { if (mounted.current) setError('Enregistrement non confirmé ou révision concurrente. Actualisez avant de réessayer ; votre saisie est conservée.'); }
    finally { lock.current = false; if (mounted.current) setPending(false); }
  }
  async function simulate() {
    if (lock.current || !profile) return;
    const kg = weight.trim() ? Number(weight) : NaN;
    if (!Number.isFinite(kg) || kg <= 0) return invalid('Saisissez un poids taxable positif pour cet exemple hors dossier.');
    lock.current = true; setPending(true); setError(''); setResult(null);
    const generation = ++previewGeneration.current;
    try { const r = await previewAir({ profile_id: profile.id, taxable_kg: kg, general_cargo_confirmed: true, warehouse_bracket_confirmed: warehouse }); if (mounted.current && generation === previewGeneration.current) setResult(r); }
    catch { if (mounted.current) setError('Simulation indisponible. Aucun calcul de dossier n’a été enregistré.'); }
    finally { lock.current = false; if (mounted.current) setPending(false); }
  }
  return <MainLayout><div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
    <div><h1 className="text-2xl font-semibold">Handling aéroportuaire</h1><p className="text-muted-foreground">2AS · DSS · catalogue d’achat fournisseur en FCFA et profils historiques</p></div>
    <AirCatalogueAdmin />
    <details className="space-y-4 rounded-md border p-4"><summary className="cursor-pointer font-semibold">Profils historiques à cinq montants et simulation initiale</summary>
    <Alert><AlertDescription>Ces profils historiques restent distincts du catalogue complet. Ils ne calculent pas le magasinage. Les anciens devis conservent leur paramétrage ; la rubrique de 6 000 FCFA correspond à la taxe fixe magasin DMS.</AlertDescription></Alert>
    {query.isLoading && <p role="status">Chargement des profils…</p>}
    {query.isError && <Alert variant="destructive"><AlertDescription>Profils indisponibles. <Button variant="outline" onClick={() => void query.refetch()}>Réessayer la lecture</Button></AlertDescription></Alert>}
    {query.data && !query.data.profiles.length && <p>Aucun profil fournisseur disponible.</p>}
    {query.data && <>
      <Label htmlFor="air-profile">Profil et révision à consulter</Label>
      <Select value={selected} onValueChange={v => { setSelected(v); edit(); setSource(''); setResult(null);
        const p = query.data.profiles.find(p => p.id === v); if (p) setRates(Object.fromEntries(fields.map(([k]) => [k, String(p.rates[k])])));
      }} disabled={pending}>
        <SelectTrigger id="air-profile"><SelectValue placeholder="Choisir une révision" /></SelectTrigger><SelectContent>{query.data.profiles.map(p => <SelectItem key={p.id} value={p.id}>2AS · révision {p.revision} · applicable à partir du {p.effective_from}</SelectItem>)}</SelectContent>
      </Select>
      {profile && <>
        <Card><CardHeader><CardTitle>Barème d’achat enregistré</CardTitle></CardHeader><CardContent className="space-y-3">
          <p className="break-words text-sm">Source : {profile.source_reference}</p>
          <dl className="grid gap-3 sm:grid-cols-2">{fields.map(([k,label]) => <div key={k}><dt className="text-sm text-muted-foreground">{label}</dt><dd className="font-medium">{airMoney(profile.rates[k])}</dd></div>)}</dl>
          <p className="text-sm text-muted-foreground">Aucune date d’effet passée n’a été déduite du nom « grille 2024 ». Les suppléments et tranches non activés restent dans la preuve source.</p>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Créer une nouvelle révision</CardTitle></CardHeader><CardContent>
          {!query.data.can_edit && <p className="mb-3 text-sm">Lecture seule : administration tarifaire requise pour enregistrer une révision.</p>}
          <form noValidate onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-4">
            <fieldset disabled={!query.data.can_edit || pending} className="grid gap-4 sm:grid-cols-2"><legend className="sr-only">Montants d’achat HT en FCFA</legend>{fields.map(([k,label]) => <div key={k} className="space-y-1"><Label htmlFor={`air-rate-${k}`}>{label}</Label><Input id={`air-rate-${k}`} inputMode="decimal" value={rates[k] ?? ''} onChange={e => { edit(); setRates(v => ({ ...v, [k]: e.target.value })); }} /></div>)}</fieldset>
            <Label htmlFor="air-effective">Début d’application (AAAA-MM-JJ)</Label><Input className="max-w-xs" id="air-effective" maxLength={10} placeholder="AAAA-MM-JJ" value={date} disabled={!query.data.can_edit || pending} onChange={e => { edit(); setDate(e.target.value); }} />
            <Label htmlFor="air-effective-end">Fin d’application, facultative (AAAA-MM-JJ)</Label><Input className="max-w-xs" id="air-effective-end" maxLength={10} placeholder="AAAA-MM-JJ" value={endDate} disabled={!query.data.can_edit || pending} onChange={e => { edit(); setEndDate(e.target.value); }} />
            <Label htmlFor="air-source">Référence du barème et validation de cette révision</Label><Textarea id="air-source" className="resize-none" maxLength={2000} value={source} disabled={!query.data.can_edit || pending} onChange={e => { edit(); setSource(e.target.value); }} />
            <Button type="submit" disabled={!query.data.can_edit || pending}>Enregistrer une nouvelle révision</Button>
          </form>
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Vérifier un exemple general cargo</CardTitle></CardHeader><CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">Simulation hors dossier à partir du profil enregistré. Aucun poids, calcul ou devis n’est créé.</p>
          <form noValidate onSubmit={e => { e.preventDefault(); void simulate(); }} className="space-y-3">
            <Label htmlFor="air-example-weight">Poids taxable LTA de l’exemple, en kg</Label><Input id="air-example-weight" className="max-w-xs" inputMode="decimal" value={weight} disabled={pending} onChange={e => { setWeight(e.target.value); setResult(null); }} />
            <div className="flex items-start gap-2"><Checkbox id="air-example-warehouse" checked={warehouse} disabled={pending} onCheckedChange={v => { setWarehouse(v === true); setResult(null); }} /><Label htmlFor="air-example-warehouse">Éligibilité taxe fixe magasin DMS moins d’une tonne attestée pour cet exemple</Label></div>
            <Button type="submit" variant="outline" disabled={pending}>Simuler l’achat fournisseur</Button>
          </form>
          {result && <AirHandlingResult result={result} />}
        </CardContent></Card>
      </>}
    </>}
    <p ref={errorRef} role={error ? 'alert' : undefined} tabIndex={-1} className="text-sm text-destructive">{error}</p></details>
  </div></MainLayout>;
}
