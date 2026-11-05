import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlaskConical, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { MainLayout } from '@/components/layout/MainLayout';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { recipeInvocationDiagnostic } from '@/lib/recipeInvocationDiagnostic';
import { IDEMPOTENT_RECIPE, RECIPE_V2_MARKER, LEGACY_RECIPE_MARKER, RECIPE_INSTRUCTIONS, recipeUUID,
  readRecipeMarker, readRecipeReceiptV2, type RecipeTargetV2, type RecipeMarkerV2, type ClientRecipeReceipt } from '@/lib/generationRecipeV2';

async function bounded<T>(work: PromiseLike<T>, milliseconds = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Délai de vérification dépassé.')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function preflight(target: RecipeTargetV2): Promise<{ subject: string; attachments: number }> {
  const auth = await supabase.auth.getUser();
  if (auth.error || auth.data.user?.id !== target.actorId) throw new Error('La session ne correspond pas à l’opérateur.');
  const access = await supabase.rpc('has_workspace_access');
  if (access.error || access.data !== true) throw new Error('L’admission au workspace ne peut pas être confirmée.');
  const email = await supabase.from('emails').select('id,subject,thread_ref').eq('id', target.emailId).single();
  if (email.error || email.data?.id !== target.emailId || !recipeUUID(email.data.thread_ref)) throw new Error('Le courriel ne peut pas être confirmé.');
  const cases = await supabase.from('quote_cases').select('id,thread_id').eq('thread_id', email.data.thread_ref).limit(2);
  if (cases.error || cases.data?.length !== 1 || cases.data[0].id !== target.caseId || cases.data[0].thread_id !== email.data.thread_ref) throw new Error('Le rattachement à un dossier unique ne peut pas être confirmé.');
  const attachments = await supabase.from('email_attachments').select('id,email_id,is_analyzed', { count: 'exact' }).eq('email_id', target.emailId).range(0, 999);
  const rows = attachments.data, count = attachments.count;
  if (attachments.error || !Array.isArray(rows) || count === null || !Number.isSafeInteger(count) || count < 0 || count > 1000 || rows.length !== count ||
      rows.some(r => !recipeUUID(r.id) || r.email_id !== target.emailId || r.is_analyzed !== true) || new Set(rows.map(r => r.id)).size !== count) throw new Error('La lecture complète des pièces déjà analysées ne peut pas être confirmée.');
  const drafts = await supabase.from('email_drafts').select('id', { count: 'exact', head: true }).eq('original_email_id', target.emailId);
  if (drafts.error || drafts.count !== 0) throw new Error('Un brouillon existe déjà, ou son absence n’est pas confirmée. Consultez le reçu avant toute décision.');
  return { subject: email.data.subject ?? '(sans objet)', attachments: count };
}

export default function GenerationRecipeV2() {
  const { user, authStatus } = useAuth();
  const [actorId, setActorId] = useState(''), [caseId, setCaseId] = useState(''), [emailId, setEmailId] = useState(''), [grantId, setGrantId] = useState('');
  const [marker, setMarker] = useState<RecipeMarkerV2 | null>(null), [legacy, setLegacy] = useState(false), [storageBlocked, setStorageBlocked] = useState(false);
  const [checked, setChecked] = useState<(RecipeTargetV2 & { subject: string; attachments: number }) | null>(null);
  const [acknowledged, setAcknowledged] = useState(false), [busy, setBusy] = useState<'check' | 'run' | 'status' | 'revoke' | null>(null);
  const [receipt, setReceipt] = useState<ClientRecipeReceipt | null>(null), [persisted, setPersisted] = useState(false), [error, setError] = useState('');
  const [invalid, setInvalid] = useState(false);
  const mounted = useRef(false), pending = useRef(false), epoch = useRef(0), message = useRef<HTMLDivElement>(null), currentUser = useRef(user?.id);
  currentUser.current = user?.id;
  useEffect(() => { mounted.current = true; const title = document.title; document.title = 'Recette sans fichiers | Dakar Cargo Quotes'; return () => { mounted.current = false; document.title = title; }; }, []);
  useEffect(() => {
    epoch.current++; setChecked(null); setAcknowledged(false); setReceipt(null); setPersisted(false); setError('');
    setActorId(''); setCaseId(''); setEmailId(''); setGrantId('');
    try {
      setLegacy(sessionStorage.getItem(LEGACY_RECIPE_MARKER) !== null);
      const raw = sessionStorage.getItem(RECIPE_V2_MARKER), saved = raw === null ? null : readRecipeMarker(raw);
      setMarker(saved); setStorageBlocked(false);
      if (saved?.actorId === user?.id) { setActorId(saved.actorId); setCaseId(saved.caseId); setEmailId(saved.emailId); setGrantId(saved.grantId); }
    } catch { setStorageBlocked(true); }
  }, [user?.id, authStatus]);
  useEffect(() => {
    if (!error && !receipt) return;
    const field = invalid ? ['actor', 'case', 'email', 'grant'].map(k => document.getElementById(`recipe-v2-${k}`)).find(e => e?.getAttribute('aria-invalid') === 'true') : null;
    (field ?? message.current)?.focus();
  }, [error, receipt, invalid]);
  const reset = () => { epoch.current++; setChecked(null); setAcknowledged(false); setError(''); setReceipt(null); setPersisted(false); setInvalid(false); };
  const run = async (action: 'check' | 'run' | 'status' | 'revoke') => {
    if (pending.current || authStatus !== 'authenticated') return;
    const target = { actorId: actorId.trim().toLowerCase(), caseId: caseId.trim().toLowerCase(), emailId: emailId.trim().toLowerCase(), grantId: grantId.trim().toLowerCase() };
    if (!Object.values(target).every(recipeUUID)) { setInvalid(true); setError('Saisissez les quatre identifiants UUID complets.'); return; }
    if (target.actorId !== user?.id) { setError('La session ne correspond pas à l’opérateur.'); return; }
    if ((action === 'check' || action === 'run') && (marker || legacy || storageBlocked || (receipt && receipt.state !== 'authorized'))) return;
    if (action === 'run' && (!checked || !acknowledged || Object.keys(target).some(k => target[k as keyof RecipeTargetV2] !== checked[k as keyof RecipeTargetV2]))) return;
    if (action === 'revoke' && (!receipt || receipt.state !== 'completed' || receipt.revoked || !persisted)) return;
    const token = ++epoch.current, active = () => mounted.current && epoch.current === token && currentUser.current === target.actorId;
    pending.current = true; setBusy(action); setError(''); setInvalid(false);
    let sent = false;
    try {
      if (action === 'check' || action === 'run') {
        const fresh = await bounded(preflight(target)); if (!active()) return;
        setChecked({ ...target, ...fresh }); if (action === 'check') return;
      }
      let attemptId: string | undefined;
      if (action === 'run') {
        if (sessionStorage.getItem(LEGACY_RECIPE_MARKER) !== null || sessionStorage.getItem(RECIPE_V2_MARKER) !== null) throw new Error('Une tentative est déjà enregistrée ; consultez son résultat.');
        const saved = { ...target, attemptId: crypto.randomUUID(), attemptedAt: new Date().toISOString() };
        try { sessionStorage.setItem(RECIPE_V2_MARKER, JSON.stringify(saved)); }
        catch { setStorageBlocked(true); throw new Error('Le suivi ne peut pas être conservé ; aucune génération n’est lancée.'); }
        setMarker(saved); attemptId = saved.attemptId;
      }
      sent = true;
      const reply = await bounded(supabase.functions.invoke('generate-response', { body: {
        recipe_mode: IDEMPOTENT_RECIPE, recipe_action: action, recipe_grant_id: target.grantId, recipe_email_id: target.emailId, recipe_case_id: target.caseId,
        ...(action === 'run' ? { recipe_attempt_id: attemptId, zone_reply_contract: 'optional_factor_v1', customInstructions: RECIPE_INSTRUCTIONS, expertStyle: 'auto', reply_language_override: 'AUTO' } : {}),
      } }), action === 'run' ? 90_000 : 15_000);
      if (!active()) return;
      if (reply.error) throw reply.error;
      const found = readRecipeReceiptV2(reply.data, target);
      setReceipt(found); setPersisted(false); setChecked(null); setAcknowledged(false);
      if (found.state === 'completed') {
        const draft = await bounded(supabase.from('email_drafts').select('id,original_email_id,created_by,status,sent_at,subject').eq('id', found.draftId!).eq('original_email_id', target.emailId).eq('created_by', target.actorId).single());
        if (!active()) return;
        if (draft.error || draft.data?.id !== found.draftId || draft.data.original_email_id !== target.emailId || draft.data.created_by !== target.actorId || draft.data.status !== 'draft' || draft.data.sent_at !== null || !draft.data.subject.startsWith('[RECETTE AUTH]')) throw new Error('Le reçu est terminé mais le brouillon ne peut pas être relu. Ne relancez pas.');
        setPersisted(true);
      }
    } catch (failure) {
      const diagnostic = sent ? await recipeInvocationDiagnostic(failure) : '';
      if (active()) {
        setError(sent ? `${action === 'run' ? 'Résultat de génération non confirmé ; des frais IA ou un brouillon peuvent exister. Consultez le reçu sans relancer.' : action === 'revoke' ? 'La fermeture n’est pas confirmée ; consultez le reçu.' : 'La consultation n’a pas abouti ; aucune nouvelle génération n’a été demandée.'} ${diagnostic}` : failure instanceof Error ? failure.message : 'La vérification n’a pas abouti.');
        setChecked(null); setAcknowledged(false);
      }
    } finally { pending.current = false; if (mounted.current) setBusy(null); }
  };
  const locked = !!marker || legacy;
  return <MainLayout><div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
    <div><Link to="/" className="text-sm text-primary underline-offset-4 hover:underline focus-visible:underline">Retour au tableau de bord</Link>
      <h1 className="mt-3 flex items-center gap-2 text-2xl font-bold"><FlaskConical aria-hidden="true" className="h-6 w-6 shrink-0" />Recette sans fichiers</h1>
      <p className="mt-2 text-sm text-muted-foreground">Un essai interne par autorisation serveur, avec reçu consultable et brouillon sans envoi.</p></div>
    <Alert role="note"><ShieldCheck aria-hidden="true" className="h-4 w-4" /><AlertTitle>Effets et reprise de l’essai</AlertTitle><AlertDescription className="space-y-2">
      <p>La génération conserve les appels IA payants, les compteurs et un brouillon interne. Elle ne crée ni pièce ni lien de téléchargement et n’envoie rien au client.</p>
      <p>Après une interruption, consultez le reçu. Cette consultation ne relance pas l’IA. Une tentative non confirmée réserve encore le courriel ; son expiration ne permet pas de recommencer.</p>
      <p>Un nouveau dossier synthétique peut utiliser des connaissances et tarifs partagés. Cette recette technique ne valide ni les prix ni le dossier commercial.</p>
    </AlertDescription></Alert>
    <Card><CardHeader><CardTitle>Cible et autorisation</CardTitle><CardDescription>Utilisez les identifiants de l’essai préparé. L’autorisation est contrôlée par le serveur ; sa saisie n’accorde aucun accès.</CardDescription></CardHeader><CardContent>
      <form noValidate onSubmit={e => { e.preventDefault(); if (!(e.nativeEvent as KeyboardEvent).isComposing) void run('check'); }} className="space-y-4">
        <p className="break-all text-sm">Session : {user?.email ?? 'non disponible'}</p>
        {([
          ['actor', 'Opérateur autorisé (UUID)', actorId, setActorId], ['case', 'Dossier (UUID)', caseId, setCaseId],
          ['email', 'Courriel (UUID)', emailId, setEmailId], ['grant', 'Autorisation de recette (UUID)', grantId, setGrantId],
        ] as const).map(([key, label, value, setter]) => <div key={key} className="space-y-2"><Label htmlFor={`recipe-v2-${key}`}>{label}</Label><Input id={`recipe-v2-${key}`} value={value} onChange={e => { reset(); setter(e.target.value); }} disabled={!!busy || locked} autoComplete="off" spellCheck={false} maxLength={36} aria-invalid={invalid && !recipeUUID(value.trim())} aria-describedby="recipe-v2-help" /></div>)}
        <p id="recipe-v2-help" className="text-sm text-muted-foreground">Le suivi de l’onglet conserve uniquement les identifiants et l’heure ; aucun corps de courriel, secret ou jeton.</p>
        <div className="flex flex-wrap gap-3"><Button type="submit" variant="outline" disabled={!!busy || locked || storageBlocked || (!!receipt && receipt.state !== 'authorized') || authStatus !== 'authenticated'}>Vérifier avant l’essai</Button>
          <Button type="button" variant="outline" onClick={() => void run('status')} disabled={!!busy || authStatus !== 'authenticated'}>Consulter le résultat sans relancer</Button></div>
      </form></CardContent></Card>
    {legacy && <Alert role="alert" variant="destructive"><AlertTitle>Ancienne tentative sans reçu durable</AlertTitle><AlertDescription>Son marqueur est conservé. Aucune nouvelle génération n’est permise dans cet onglet ; vérifiez ses effets et sa terminaison.</AlertDescription></Alert>}
    {storageBlocked && <Alert role="alert" variant="destructive"><AlertTitle>Suivi indisponible</AlertTitle><AlertDescription>La génération est bloquée. La consultation d’un reçu existant reste disponible.</AlertDescription></Alert>}
    {marker && marker.actorId === user?.id && <p role="note" className="text-sm">Une tentative est enregistrée. Consultez son reçu ; aucune relance de génération n’est proposée.</p>}
    {checked && checked.actorId === user?.id && !locked && <Card><CardHeader><CardTitle>Vérification effectuée</CardTitle><CardDescription>{checked.subject}</CardDescription></CardHeader><CardContent className="space-y-4">
      <p>Identité et workspace confirmés ; dossier unique ; {checked.attachments} pièce(s) déjà analysée(s) ; aucun brouillon préexistant.</p>
      <div className="flex items-start gap-3"><Checkbox id="recipe-v2-authorization" checked={acknowledged} onCheckedChange={v => setAcknowledged(v === true)} disabled={!!busy} /><Label htmlFor="recipe-v2-authorization" className="leading-5">Cet essai et ses frais sont autorisés ; l’autorisation serveur a été préparée pour cette cible, sans ancienne exécution non confirmée.</Label></div>
      <Button type="button" onClick={() => void run('run')} disabled={!!busy || !acknowledged}>Exécuter l’essai interne une fois</Button>
    </CardContent></Card>}
    <div ref={message} tabIndex={-1} className="min-h-16 focus-visible:outline-none" aria-live="polite" aria-busy={!!busy}>
      {busy && <p role="status" className="flex items-center gap-2"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />{busy === 'run' ? 'Essai en cours ; fermer cet écran n’annule pas l’IA.' : 'Vérification en cours…'}</p>}
      {error && <Alert role="alert" variant="destructive"><AlertTitle>Opération non confirmée</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {receipt && receipt.actorId === user?.id && authStatus === 'authenticated' && receipt.caseId === caseId.trim().toLowerCase() && receipt.emailId === emailId.trim().toLowerCase() && receipt.grantId === grantId.trim().toLowerCase() && <Alert role="status"><AlertTitle>{receipt.state === 'completed' && persisted ? 'Brouillon interne confirmé' : receipt.state === 'completed' ? 'Reçu terminé ; relecture du brouillon non confirmée' : receipt.state === 'authorized' ? 'Autorisation enregistrée ; aucun reçu terminal' : 'Traitement non confirmé ; courriel réservé'}</AlertTitle><AlertDescription className="space-y-2">
        {receipt.draftId && <p className="break-all">Brouillon : {receipt.draftId}</p>}
        {receipt.state === 'completed' && persisted && <p>{receipt.engineVerified ? 'Le reçu confirme aussi le contrôle moteur.' : 'Le contrôle moteur n’est pas établi par ce reçu.'} Aucun envoi demandé.</p>}
        {receipt.state !== 'completed' && <p>Cet état ne prouve pas que le serveur travaille encore. Vérifiez le reçu sans créer de nouvelle autorisation ou clé pour contourner la réserve.</p>}
        {receipt.revoked ? <p>L’autorisation est fermée ; les états non confirmés restent réservés.</p> : receipt.state === 'completed' && persisted ? <><p>Fermer l’autorisation conserve le brouillon et le reçu. Les parcours ordinaires pourront reprendre si aucune autre réserve n’existe.</p><Button type="button" variant="outline" onClick={() => void run('revoke')} disabled={!!busy}>Fermer l’autorisation de recette</Button></> : null}
      </AlertDescription></Alert>}
    </div>
  </div></MainLayout>;
}
