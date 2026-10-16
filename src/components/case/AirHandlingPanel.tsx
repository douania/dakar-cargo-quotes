import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { readAirCase, readAirProfiles, previewAir, airMoney } from '@/lib/airHandlingApi';
import type { AirResolution } from '../../../supabase/functions/_shared/air-handling';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AirCatalogueSelection } from './AirCatalogueSelection';

export function AirHandlingResult({ result }: { result: AirResolution }) {
  return <div className="space-y-3" aria-live="polite">
    <dl className="grid gap-2 sm:grid-cols-2">{result.components.map(c => <div key={c.code} className="rounded-md border p-3">
      <dt className="text-sm text-muted-foreground">{c.code === 'warehouse_passage' ? 'Taxe fixe magasin — DMS' : c.label}</dt><dd className="font-medium">{airMoney(c.supplier_ht_xof)} HT fournisseur</dd>
      {c.reason && <dd className="text-sm text-muted-foreground">{c.reason}</dd>}
    </div>)}</dl>
    <p className="font-medium">Sous-total achat HT connu : {airMoney(result.supplier_known_ht_xof)}</p>
    <p>{result.schema_version === 2 ? 'HT des composants renseignés' : 'HT des cinq composants de handling'} : {airMoney(result.supplier_complete_ht_xof)}</p>
    {result.supplier_estimated_ht_xof != null && <p>Hypothèse de magasinage : {airMoney(result.supplier_estimated_ht_xof)} HT fournisseur, exclue du sous-total connu.</p>}
    <p>TTC fournisseur et prix de vente SODATRA : à confirmer. Non ajoutés au total payable.</p>
    <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">{result.reserves.map(r => <li key={r}>{r}</li>)}</ul>
  </div>;
}

export function AirHandlingPanel({ caseId, isLocked }: { caseId: string; isLocked: boolean }) {
  const qc = useQueryClient();
  const state = useQuery({ queryKey: ['air-handling-case', caseId], queryFn: () => readAirCase(caseId), retry: false });
  const profiles = useQuery({ queryKey: ['air-handling-profiles'], queryFn: readAirProfiles, retry: false });
  const [profileId, setProfileId] = useState(''); const [source, setSource] = useState('');
  const [general, setGeneral] = useState(false); const [warehouse, setWarehouse] = useState(false);
  const [pending, setPending] = useState(false); const [error, setError] = useState('');
  const [result, setResult] = useState<AirResolution | null>(null);
  const lock = useRef(false), requestId = useRef<string | null>(null), mounted = useRef(true);
  const previewGeneration = useRef(0);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { previewGeneration.current++; setResult(null); }, [state.data?.context_hash, state.data?.selection?.id]);
  const changed = () => { previewGeneration.current++; requestId.current = null; setError(''); setResult(null); };
  async function save() {
    if (lock.current || isLocked || !state.data) return;
    if (!profileId || !general || source.trim().length < 10) { setError('Choisissez un profil, confirmez la nature et précisez une source d’au moins 10 caractères.'); queueMicrotask(() => errorRef.current?.focus()); return; }
    lock.current = true; setPending(true); setError('');
    requestId.current ??= crypto.randomUUID();
    try {
      const { error: writeError } = await supabase.rpc('air_handling_select', { p_id: requestId.current, p_case_id: caseId,
        p_expected_id: state.data.selection?.id ?? null, p_profile_id: profileId, p_source_reference: source.trim(),
        p_warehouse_bracket_confirmed: warehouse, p_context_hash: state.data.context_hash });
      if (writeError) {
        const checked = await readAirCase(caseId); // Determine an uncertain result before allowing another submission.
        if (checked.selection?.id !== requestId.current) throw new Error('Sélection refusée');
      }
      if (!mounted.current) return;
      await qc.invalidateQueries({ queryKey: ['air-handling-case', caseId] });
      toast.success('Profil associé pour les prochains calculs. Les anciens devis sont conservés.');
      requestId.current = null;
    } catch { if (mounted.current) setError('Association non confirmée. Actualisez les données avant de réessayer.'); }
    finally { lock.current = false; if (mounted.current) setPending(false); }
  }
  async function simulate() {
    if (lock.current) return; lock.current = true; setPending(true); setError('');
    const generation = ++previewGeneration.current;
    try { const r = await previewAir({ case_id: caseId }); if (mounted.current && generation === previewGeneration.current) setResult(r); }
    catch { if (mounted.current) setError('Simulation indisponible. Aucune donnée du dossier n’a été modifiée.'); }
    finally { lock.current = false; if (mounted.current) setPending(false); }
  }
  return <Card className="mb-6"><CardHeader><CardTitle>Handling aéroportuaire</CardTitle></CardHeader><CardContent className="space-y-4">
    <p className="text-sm text-muted-foreground">2AS · DSS · import general cargo · mono-lot. La nature du fret et le fournisseur doivent être confirmés ; un médicament n’est pas classé automatiquement.</p>
    <Link className="text-sm underline" to="/admin/air-handling">Consulter et paramétrer les profils fournisseur</Link>
    <AirCatalogueSelection caseId={caseId} isLocked={isLocked}/>
    <details className="space-y-3"><summary className="cursor-pointer font-medium">Choisir ou reprendre un profil historique à cinq montants</summary>
    {(state.isLoading || profiles.isLoading) && <p role="status">Chargement du paramétrage…</p>}
    {(state.isError || profiles.isError) && <Alert variant="destructive"><AlertDescription>Paramétrage indisponible. <Button variant="outline" onClick={() => { void state.refetch(); void profiles.refetch(); }}>Réessayer la lecture</Button></AlertDescription></Alert>}
    {state.data && profiles.data && <>
      <p className="text-sm">Sélection enregistrée : {state.data.profile ? `2AS révision ${state.data.profile.revision}` : 'Aucune'}</p>
      <Button variant="outline" disabled={pending} onClick={() => { void state.refetch(); void profiles.refetch(); }}>Actualiser l’état du paramétrage</Button>
      {state.data.selection && state.data.selection.context_hash !== state.data.context_hash && <Alert><AlertDescription>Les données du dossier ont changé. Reconfirmez la sélection.</AlertDescription></Alert>}
      {!profiles.data.profiles.length && <p>Aucun profil disponible.</p>}
      <form noValidate onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-3">
        <Label htmlFor="air-case-profile">Profil à associer</Label>
        <Select value={profileId} onValueChange={v => { changed(); setProfileId(v); }} disabled={pending || isLocked}>
          <SelectTrigger id="air-case-profile"><SelectValue placeholder="Choisir explicitement un profil" /></SelectTrigger><SelectContent>{profiles.data.profiles.map(p => <SelectItem value={p.id} key={p.id}>2AS · général · révision {p.revision} · {p.effective_from}</SelectItem>)}</SelectContent>
        </Select>
        <div className="flex items-start gap-2"><Checkbox id="air-general" checked={general} disabled={pending || isLocked} onCheckedChange={v => { changed(); setGeneral(v === true); }} /><Label htmlFor="air-general">La pièce citée confirme 2AS, DSS et la nature general cargo de ce dossier.</Label></div>
        <div className="flex items-start gap-2"><Checkbox id="air-warehouse" checked={warehouse} disabled={pending || isLocked} onCheckedChange={v => { changed(); setWarehouse(v === true); }} /><Label htmlFor="air-warehouse">La pièce citée atteste séparément l’éligibilité à la taxe fixe magasin DMS de moins d’une tonne.</Label></div>
        <Label htmlFor="air-case-source">Pièce justificative et éléments confirmés</Label>
        <Textarea id="air-case-source" value={source} maxLength={2000} disabled={pending || isLocked} className="resize-none" onChange={e => { changed(); setSource(e.target.value); }} aria-describedby="air-case-help" />
        <p id="air-case-help" className="text-sm text-muted-foreground">Le poids taxable doit être un fait LTA validé dans le dossier. Cette association ne modifie aucun poids ni aucun devis existant.</p>
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending || isLocked || !profiles.data.profiles.length}>Associer pour les prochains calculs</Button><Button type="button" variant="outline" onClick={() => void simulate()} disabled={pending || !state.data.selection?.profile_id}>Simuler sans enregistrer de calcul</Button></div>
      </form>
    </>}
    <p ref={errorRef} tabIndex={-1} role={error ? 'alert' : undefined} className="text-sm text-destructive">{error}</p>
    {result && <AirHandlingResult result={result} />}</details>
  </CardContent></Card>;
}
