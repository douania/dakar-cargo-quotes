import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { readAirCatalogues } from '@/lib/airHandlingApi';
import { validAirCatalogue, airUnits, type AirCataloguePayload, type AirTariffEntry } from '../../../supabase/functions/_shared/air-tariff';
import { canonicalStringify } from '../../../supabase/functions/_shared/canonical-hash';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const numeric: Array<[keyof AirTariffEntry,string]> = [['value','Montant ou pourcentage'],['minimum','Minimum de perception'],['weight_from_kg','Poids à partir de (kg)'],['weight_to_kg','Poids jusqu’à (kg)'],['day_from','Premier jour de période'],['day_to','Dernier jour de période'],['free_hours','Franchise documentée (heures)'],['threshold','Seuil documenté (XOF)']];
export function AirCatalogueAdmin() {
  const query = useQuery({queryKey:['air-tariff-catalogues'],queryFn:readAirCatalogues,retry:false});
  const qc = useQueryClient();
  const [selected,setSelected] = useState(''),[draft,setDraft] = useState<AirCataloguePayload | null>(null),[dirty,setDirty] = useState(false);
  const [section,setSection] = useState('Documentaire'),[page,setPage] = useState(0),[entryKey,setEntryKey] = useState('');
  const [source,setSource] = useState(''),[start,setStart] = useState(new Date().toISOString().slice(0,10)),[end,setEnd] = useState('');
  const [pending,setPending] = useState(false),[error,setError] = useState('');
  const operation = useRef<string | null>(null),lock = useRef(false),mounted = useRef(true),errorRef = useRef<HTMLParagraphElement>(null);
  const catalogue = query.data?.catalogues.find(c=>c.id===selected);
  useEffect(()=>{ mounted.current=true;return ()=>{mounted.current=false;}; },[]);
  useEffect(()=>{if(!selected && query.data?.catalogues.length) setSelected(query.data.catalogues.at(-1)!.id);},[query.data,selected]);
  useEffect(()=>{if(catalogue && !draft) setDraft(structuredClone(catalogue.payload));},[catalogue,draft]);
  const entries = draft?.entries.filter(e=>e.section===section) ?? [],entry=draft?.entries.find(e=>e.key===entryKey);
  const edit = (patch: Partial<AirTariffEntry>) => { operation.current=null;setDirty(true);setError('');setDraft(p=>p?{...p,entries:p.entries.map(e=>e.key===entryKey?{...e,...patch}:e)}:p); };
  const invalid = (message:string) => {setError(message);queueMicrotask(()=>errorRef.current?.focus());};
  async function save() {
    if(lock.current || !catalogue || !draft || !query.data?.can_edit) return;
    if(!validAirCatalogue(draft) || source.trim().length<10 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || (end && (!/^\d{4}-\d{2}-\d{2}$/.test(end) || end<start))) return invalid('Vérifiez les montants, les dates et la justification de dix caractères minimum. Un champ numérique vide conserve une valeur inconnue.');
    lock.current=true;setPending(true);setError('');operation.current??=crypto.randomUUID();
    const id=operation.current;
    try {
      await supabase.rpc('air_tariff_publish',{p_id:id,p_parent_id:catalogue.id,p_payload:draft,p_effective_from:start,p_effective_to:end||null,p_source_reference:source.trim()});
      const verified=await readAirCatalogues(),created=verified.catalogues.find(c=>c.id===id);
      if(!created || canonicalStringify(created.payload)!==canonicalStringify(draft) || created.source_reference!==source.trim() || created.effective_from!==start || created.effective_to!==(end||null)) throw new Error('Unconfirmed catalogue');
      if(!mounted.current)return;
      qc.setQueryData(['air-tariff-catalogues'],verified);setSelected(created.id);setDraft(structuredClone(created.payload));setDirty(false);setSource('');operation.current=null;
      toast.success('Catalogue complet enregistré dans une nouvelle révision. Les anciens devis sont conservés.');
    } catch {if(mounted.current)invalid('Enregistrement non confirmé ou révision concurrente. Votre saisie est conservée ; actualisez le catalogue avant de reprendre.');}
    finally {lock.current=false;if(mounted.current)setPending(false);}
  }
  return <Card><CardHeader><CardTitle>Catalogue complet 2AS — toutes les rubriques</CardTitle></CardHeader><CardContent className="space-y-4">
    <p>Documentaire, taxes, magasinage ordinaire et frigorifique, quinze services annexes et codes de facturation. Les conditions inconnues restent visibles même si leur montant est enregistré.</p>
    {query.isLoading && <p role="status">Chargement du catalogue complet.</p>}
    {query.isError && <Alert variant="destructive"><AlertDescription>Catalogue indisponible. <Button variant="outline" onClick={()=>void query.refetch()}>Réessayer le catalogue</Button></AlertDescription></Alert>}
    {query.data && !query.data.catalogues.length && <p>Aucun catalogue complet disponible.</p>}
    {query.data && <>
      <Label htmlFor="air-catalogue-revision">Révision du catalogue complet</Label>
      <Select value={selected} disabled={pending||dirty} onValueChange={v=>{setSelected(v);setDraft(null);setEntryKey('');setSource('');operation.current=null;}}><SelectTrigger id="air-catalogue-revision"><SelectValue placeholder="Choisir un catalogue"/></SelectTrigger><SelectContent>{query.data.catalogues.map(c=><SelectItem key={c.id} value={c.id}>Révision {c.revision} — {c.effective_from}</SelectItem>)}</SelectContent></Select>
    </>}
    {catalogue && draft && <>
      <p className="break-words text-sm">Source du catalogue : {catalogue.source_reference}</p>
      <p className="text-sm">{draft.entries.length} rubriques enregistrées. Les pourcentages sont exprimés en % : 18 signifie 18 %. Aucune formule du simulateur n’est appliquée automatiquement.</p>
      <p className="text-sm text-muted-foreground">Un changement de condition, minimum, franchise ou tranche est conservé. Son application reste réservée tant que la règle de calcul correspondante n’est pas validée.</p>
      <Label htmlFor="air-catalogue-section">Famille de rubriques</Label>
      <Select value={section} onValueChange={v=>{setSection(v);setPage(0);setEntryKey('');}}><SelectTrigger id="air-catalogue-section"><SelectValue/></SelectTrigger><SelectContent>{[...new Set(draft.entries.map(e=>e.section))].map(s=><SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent></Select>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Rubriques du catalogue — {section}</caption><thead><tr className="border-b"><th scope="col" className="p-2">Code et rubrique</th><th scope="col" className="p-2">Valeur</th><th scope="col" className="p-2">Qualification</th><th scope="col" className="p-2">Détail</th></tr></thead><tbody>{entries.slice(page*10,page*10+10).map(e=><tr key={e.key} className="border-b"><th scope="row" className="p-2 font-normal">{e.code ?? 'Sans code'} — {e.label}</th><td className="p-2">{e.value===null?'À confirmer':new Intl.NumberFormat('fr-FR').format(e.value)} {e.unit}</td><td className="p-2">{e.qualification==='documented'?'Documenté':e.qualification==='ambiguous'?'Condition à confirmer':'Non renseigné'}</td><td className="p-2"><Button variant="outline" size="sm" onClick={()=>setEntryKey(e.key)} aria-label={`Consulter ou modifier ${e.key}`}>Ouvrir</Button></td></tr>)}</tbody></table></div>
      <nav aria-label="Pages du catalogue" className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={page===0} onClick={()=>setPage(p=>p-1)}>Page précédente</Button><span aria-live="polite">Page {page+1} sur {Math.max(1,Math.ceil(entries.length/10))}</span><Button variant="outline" disabled={(page+1)*10>=entries.length} onClick={()=>setPage(p=>p+1)}>Page suivante</Button></nav>
      {entry && <fieldset disabled={pending||!query.data?.can_edit} className="space-y-3 rounded-md border p-4"><legend className="px-1 font-medium">Rubrique {entry.key}</legend>
        <p className="break-words text-sm">Preuve d’origine : {entry.source.sheet}, ligne analysée {entry.source.parsed_row} (index à partir de zéro). {entry.source.raw_cells.join(' | ')}</p>
        <Label htmlFor="air-entry-label">Libellé de la rubrique</Label><Input id="air-entry-label" value={entry.label} onChange={e=>edit({label:e.target.value})}/>
        <Label htmlFor="air-entry-code">Code de facturation (texte, zéros initiaux conservés)</Label><Input id="air-entry-code" value={entry.code??''} onChange={e=>edit({code:e.target.value||null})}/>
        <Label htmlFor="air-entry-unit">Unité du tarif</Label><Select value={entry.unit} onValueChange={v=>edit({unit:v as AirTariffEntry['unit']})}><SelectTrigger id="air-entry-unit"><SelectValue/></SelectTrigger><SelectContent>{airUnits.map(u=><SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent></Select>
        <div className="grid gap-3 sm:grid-cols-2">{numeric.map(([key,label])=><div key={key} className="space-y-1"><Label htmlFor={`air-entry-${key}`}>{label}</Label><Input id={`air-entry-${key}`} inputMode="decimal" value={entry[key]===null?'':String(entry[key])} onChange={e=>edit({[key]:e.target.value.trim()===''?null:Number(e.target.value)})}/></div>)}</div>
        <Label htmlFor="air-entry-condition">Conditions et limites d’application</Label><Textarea className="resize-none" id="air-entry-condition" value={entry.condition} maxLength={4000} onChange={e=>edit({condition:e.target.value})}/>
        <Label htmlFor="air-entry-qualification">Qualification du paramètre</Label><Select value={entry.qualification} onValueChange={v=>edit({qualification:v as AirTariffEntry['qualification']})}><SelectTrigger id="air-entry-qualification"><SelectValue/></SelectTrigger><SelectContent><SelectItem value="documented">Documenté</SelectItem><SelectItem value="ambiguous">Condition à confirmer</SelectItem><SelectItem value="missing">Non renseigné</SelectItem></SelectContent></Select>
      </fieldset>}
      {!query.data?.can_edit && <p>Lecture seule : administration tarifaire requise.</p>}
      {dirty && <Alert><AlertDescription>Modifications non enregistrées. Enregistrez une révision complète ou abandonnez ce brouillon pour changer de catalogue.</AlertDescription></Alert>}
      <form noValidate onSubmit={e=>{e.preventDefault();void save();}} className="space-y-3">
        <Label htmlFor="air-catalogue-start">Début du catalogue (AAAA-MM-JJ)</Label><Input id="air-catalogue-start" className="max-w-xs" value={start} maxLength={10} disabled={pending||!query.data?.can_edit} onChange={e=>{setStart(e.target.value);operation.current=null;}}/>
        <Label htmlFor="air-catalogue-end">Fin du catalogue, facultative (AAAA-MM-JJ)</Label><Input id="air-catalogue-end" className="max-w-xs" value={end} maxLength={10} disabled={pending||!query.data?.can_edit} onChange={e=>{setEnd(e.target.value);operation.current=null;}}/>
        <Label htmlFor="air-catalogue-source">Justification de la nouvelle révision complète</Label><Textarea id="air-catalogue-source" className="resize-none" maxLength={2000} disabled={pending||!query.data?.can_edit} value={source} onChange={e=>{setSource(e.target.value);operation.current=null;}}/>
        <div className="flex flex-wrap gap-2"><Button type="submit" disabled={pending||!query.data?.can_edit}>Enregistrer le catalogue complet</Button><Button type="button" variant="outline" disabled={pending||!dirty} onClick={()=>{setDraft(structuredClone(catalogue.payload));setDirty(false);operation.current=null;setError('');}}>Abandonner le brouillon du catalogue</Button><Button type="button" variant="outline" disabled={pending||dirty} onClick={()=>void query.refetch()}>Actualiser les catalogues</Button></div>
      </form>
    </>}
    <p ref={errorRef} tabIndex={-1} role={error?'alert':undefined} className="text-sm text-destructive">{error}</p>
  </CardContent></Card>;
}
