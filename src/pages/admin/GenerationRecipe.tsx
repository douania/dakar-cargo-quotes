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
import { OPTIONAL_ZONE_REPLY_CONTRACT } from '@/lib/generationZoneContract';
import { recipeInvocationDiagnostic } from '@/lib/recipeInvocationDiagnostic';

const MODE = 'no_files_v1';
const ATTEMPT_KEY = 'dcq:recipe-attempt:no_files_v1';
const INSTRUCTIONS = 'Recette technique d’authentification uniquement. Brouillon interne sans envoi.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Target = { actorId: string; caseId: string; emailId: string };
type Checked = Target & { subject: string; attachments: number };
type Result = { draftId: string; engineVerified: boolean };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

async function bounded<T>(work: PromiseLike<T>, milliseconds = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve(work), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Délai de vérification dépassé.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/** Metadata only. Authorization is also rechecked by the server; this never grants access. */
async function preflight(target: Target): Promise<Checked> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || auth.user?.id !== target.actorId) throw new Error('La session ne correspond pas à l’opérateur autorisé.');
  const admission = await supabase.rpc('has_workspace_access');
  if (admission.error || admission.data !== true) throw new Error('L’accès au workspace ne peut pas être confirmé. Aucun droit n’a été modifié.');
  const email = await supabase.from('emails').select('id, subject, thread_ref').eq('id', target.emailId).single();
  if (email.error || email.data?.id !== target.emailId || !id(email.data.thread_ref)) throw new Error('Le courriel et son rattachement ne peuvent pas être confirmés.');
  const cases = await supabase.from('quote_cases').select('id, thread_id').eq('thread_id', email.data.thread_ref).limit(2);
  if (cases.error || !Array.isArray(cases.data) || cases.data.length !== 1 || cases.data[0].id !== target.caseId || cases.data[0].thread_id !== email.data.thread_ref) {
    throw new Error('Le courriel ne correspond pas à un unique dossier attendu.');
  }
  const attachments = await supabase.from('email_attachments').select('id, email_id, is_analyzed', { count: 'exact' }).eq('email_id', target.emailId).range(0, 999);
  const rows = attachments.data, count = attachments.count;
  if (attachments.error || !Array.isArray(rows) || !Number.isSafeInteger(count) || count === null || count < 0 || count > 1000 || count !== rows.length ||
      rows.some(row => !id(row.id) || row.email_id !== target.emailId || row.is_analyzed !== true) || new Set(rows.map(row => row.id)).size !== count) {
    throw new Error('La lecture complète des pièces déjà analysées ne peut pas être confirmée. Aucune analyse ne sera lancée.');
  }
  const drafts = await supabase.from('email_drafts').select('id', { count: 'exact', head: true }).eq('original_email_id', target.emailId);
  if (drafts.error || drafts.count !== 0) throw new Error('Un brouillon existe déjà, ou son absence ne peut pas être confirmée. Vérifiez en lecture seule avant toute recette.');
  return { ...target, subject: email.data.subject ?? '(sans objet)', attachments: count };
}

function acknowledgement(envelope: unknown, target: Target): Result {
  const fail = () => { throw new Error('Accusé de recette incomplet ou incohérent. Le résultat doit être vérifié en lecture seule.'); };
  if (!object(envelope) || envelope.ok !== true || !object(envelope.data)) return fail();
  const payload = envelope.data, effects = payload.recipe_effects, draft = payload.draft;
  if (payload.success !== true || payload.recipe_mode !== MODE || payload.zone_reply_contract !== OPTIONAL_ZONE_REPLY_CONTRACT ||
      !object(effects) || effects.draft_persisted !== true || effects.application_ai_calls_occurred !== true || effects.usage_counters_may_change !== true ||
      effects.attachment_analysis_performed !== false || effects.files_created !== false || effects.download_links_created !== false ||
      payload.attachment_needed !== false || payload.attachment_data !== null || payload.generated_attachment !== null ||
      !object(draft) || !id(draft.id) || draft.original_email_id !== target.emailId || draft.created_by !== target.actorId || draft.status !== 'draft' || draft.sent_at !== null ||
      typeof draft.subject !== 'string' || !draft.subject.startsWith('[RECETTE AUTH]') || typeof draft.body_text !== 'string' || !draft.body_text.startsWith('[RECETTE AUTH — NE PAS ENVOYER]')) return fail();
  const metadata = payload.quotation_metadata;
  const resolution = object(metadata) ? metadata.zone_resolution : null;
  return { draftId: draft.id, engineVerified: payload.can_quote_now === true && object(resolution) &&
    ['matched', 'unknown', 'ambiguous'].includes(String(resolution.status)) && ['delivery_zones', 'static_fallback'].includes(String(resolution.source)) };
}

export default function GenerationRecipe() {
  const { user, authStatus } = useAuth();
  const [actorId, setActorId] = useState('');
  const [caseId, setCaseId] = useState('');
  const [emailId, setEmailId] = useState('');
  const [checked, setChecked] = useState<Checked | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<'check' | 'generate' | null>(null);
  const [error, setError] = useState('');
  const [storageBlocked, setStorageBlocked] = useState(false);
  const [invalidForm, setInvalidForm] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const pending = useRef(false), mounted = useRef(false), epoch = useRef(0), message = useRef<HTMLDivElement>(null);
  const currentUser = useRef(user?.id);
  currentUser.current = user?.id;

  useEffect(() => {
    mounted.current = true;
    const previous = document.title; document.title = 'Recette sans fichiers | Dakar Cargo Quotes';
    try { if (sessionStorage.getItem(ATTEMPT_KEY) !== null) setAttempted(true); }
    catch { setStorageBlocked(true); setAttempted(true); }
    return () => { mounted.current = false; document.title = previous; };
  }, []);
  useEffect(() => { epoch.current++; setChecked(null); setAcknowledged(false); setResult(null); setError(''); }, [user?.id, authStatus]);
  useEffect(() => {
    if (!error && !result) return;
    const firstInvalid = invalidForm ? ['actor', 'case', 'email'].map(key => document.getElementById(`recipe-${key}`)).find(field => field?.getAttribute('aria-invalid') === 'true') : null;
    (firstInvalid ?? message.current)?.focus();
  }, [error, result, invalidForm]);

  const reset = () => { epoch.current++; setChecked(null); setAcknowledged(false); setError(''); setResult(null); setInvalidForm(false); };
  const run = async (generate: boolean) => {
    if (pending.current || attempted || authStatus !== 'authenticated') return;
    const target = { actorId: actorId.trim().toLowerCase(), caseId: caseId.trim().toLowerCase(), emailId: emailId.trim().toLowerCase() };
    if (!Object.values(target).every(id)) { setInvalidForm(true); setError('Saisissez les trois identifiants UUID complets autorisés avant de vérifier.'); return; }
    if (target.actorId !== user?.id) { setError('La session ne correspond pas à l’opérateur autorisé.'); return; }
    if (generate && (!checked || !acknowledged || checked.actorId !== target.actorId || checked.caseId !== target.caseId || checked.emailId !== target.emailId)) return;
    pending.current = true; const token = ++epoch.current; let sent = false;
    let phase: 'invocation' | 'acknowledgement' | 'draft-read' = 'invocation', invocationDiagnostic = '';
    const active = () => mounted.current && epoch.current === token && currentUser.current === target.actorId;
    setBusy(generate ? 'generate' : 'check'); setError(''); setResult(null);
    try {
      const fresh = await bounded(preflight(target));
      if (!active()) return;
      setChecked(fresh);
      if (!generate) return;
      // Only non-secret attempt metadata survives a reload in THIS tab. No reset/retry control.
      // This is not server idempotence or an inter-tab lock. The server policy remains authoritative.
      if (sessionStorage.getItem(ATTEMPT_KEY) !== null) { setAttempted(true); throw new Error('Une tentative est déjà enregistrée dans cet onglet. Ne relancez pas.'); }
      sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify({ ...target, attemptedAt: new Date().toISOString() }));
      setAttempted(true); sent = true;
      const response = await bounded(supabase.functions.invoke('generate-response', { body: {
        recipe_mode: MODE, recipe_email_id: target.emailId, zone_reply_contract: OPTIONAL_ZONE_REPLY_CONTRACT,
        customInstructions: INSTRUCTIONS, expertStyle: 'auto', reply_language_override: 'AUTO',
      } }), 90_000);
      if (!active()) return;
      if (response.error) { invocationDiagnostic = await recipeInvocationDiagnostic(response.error); throw new Error('Recette non confirmée.'); }
      phase = 'acknowledgement';
      const ack = acknowledgement(response.data, target);
      phase = 'draft-read';
      const persisted = await bounded(supabase.from('email_drafts').select('id, original_email_id, created_by, status, sent_at, subject').eq('id', ack.draftId).eq('original_email_id', target.emailId).eq('created_by', target.actorId).single());
      if (!active()) return;
      if (persisted.error || persisted.data?.id !== ack.draftId || persisted.data.original_email_id !== target.emailId || persisted.data.created_by !== target.actorId || persisted.data.status !== 'draft' || persisted.data.sent_at !== null || !persisted.data.subject.startsWith('[RECETTE AUTH]')) throw new Error('L’enregistrement du brouillon ne peut pas être confirmé.');
      setResult(ack);
    } catch (failure) {
      if (sent && phase === 'invocation' && !invocationDiagnostic) invocationDiagnostic = await recipeInvocationDiagnostic(failure);
      if (active()) {
        const detail = sent ? 'Tentative terminée sans confirmation complète. Un brouillon et des frais IA peuvent exister. Ne relancez pas ; vérifiez en lecture seule et faites supprimer la politique serveur.' : failure instanceof Error ? failure.message : 'La vérification n’a pas abouti. Aucun appel de génération n’a été lancé.';
        const diagnostic = phase === 'invocation' ? `Appel de génération non confirmé. ${invocationDiagnostic}` : phase === 'acknowledgement' ? 'Accusé serveur incomplet ou incohérent.' : 'Relecture du brouillon non confirmée.';
        setError(sent ? `${detail} Diagnostic : ${diagnostic}` : detail); setChecked(null); setAcknowledged(false);
      }
    } finally { pending.current = false; if (mounted.current) setBusy(null); }
  };

  return <MainLayout><div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
    <div><Link to="/" className="text-sm text-primary underline-offset-4 hover:underline focus-visible:underline">Retour au tableau de bord</Link>
      <h1 className="mt-3 flex items-center gap-2 text-2xl font-bold"><FlaskConical aria-hidden="true" className="h-6 w-6 shrink-0" />Recette sans fichiers</h1>
      <p className="mt-2 text-sm text-muted-foreground">Vérifier l’authentification de la génération sur un courriel autorisé, puis conserver un brouillon interne sans envoi.</p>
    </div>
    <Alert role="note"><ShieldCheck aria-hidden="true" className="h-4 w-4" /><AlertTitle>Effets de l’essai</AlertTitle><AlertDescription className="space-y-2">
      <p>La politique serveur doit être activée séparément. Ce mode interdit la création de pièces et de liens de téléchargement ; il conserve les appels IA payants, le nouveau brouillon, les compteurs et les événements techniques.</p>
      <p>Une tentative au maximum dans cet onglet. Ce suivi ne verrouille pas les autres onglets ni le serveur. Une interruption ne garantit ni l’arrêt de l’IA ni l’absence de frais.</p>
      <p>La recette ne valide pas les prix ni le scénario commercial. Après l’essai, faites supprimer la politique serveur ; son expiration seule ne rétablit pas la génération ordinaire pour la cible.</p>
    </AlertDescription></Alert>
    <Card><CardHeader><CardTitle>Cible autorisée</CardTitle><CardDescription>Recopiez les identifiants du plan approuvé. La vérification lit uniquement l’identité, les rattachements et les métadonnées des pièces et brouillons.</CardDescription></CardHeader>
      <CardContent><form noValidate onSubmit={event => { event.preventDefault(); if (!(event.nativeEvent as KeyboardEvent).isComposing) void run(false); }} className="space-y-4">
        <p className="break-all text-sm">Session : {user?.email ?? 'non disponible'}</p>
        {([
          ['actor', 'Opérateur autorisé (UUID)', actorId, setActorId],
          ['case', 'Dossier (UUID)', caseId, setCaseId],
          ['email', 'Courriel (UUID)', emailId, setEmailId],
        ] as const).map(([key, label, value, setter]) => <div key={key} className="space-y-2"><Label htmlFor={`recipe-${key}`}>{label}</Label><Input id={`recipe-${key}`} value={value} onChange={event => { reset(); setter(event.target.value); }} disabled={!!busy || attempted} autoComplete="off" spellCheck={false} maxLength={36} aria-invalid={invalidForm && !id(value.trim())} aria-describedby={error ? 'recipe-help recipe-error' : 'recipe-help'} /></div>)}
        <p id="recipe-help" className="text-sm text-muted-foreground">Trois UUID complets sont requis. Aucun corps d’email, secret ou jeton n’est enregistré par cet écran dans le navigateur.</p>
        <Button type="submit" variant="outline" className="min-h-10 w-full sm:w-auto" disabled={!!busy || attempted || authStatus !== 'authenticated'}>{busy === 'check' && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}Vérifier en lecture seule</Button>
      </form></CardContent></Card>
    {checked && checked.actorId === user?.id && <Card><CardHeader><CardTitle>Vérification effectuée</CardTitle><CardDescription className="break-words">{checked.subject}</CardDescription></CardHeader><CardContent className="space-y-4">
      <p className="text-sm">Identité et workspace confirmés ; dossier unique ; {checked.attachments} pièce(s) déjà analysée(s) ; aucun brouillon préexistant. Ces contrôles seront répétés avant l’appel.</p>
      <p className="text-sm text-muted-foreground">Consigne fixe : {INSTRUCTIONS}</p>
      <div className="flex items-start gap-3"><Checkbox id="recipe-authorization" className="mt-1" checked={acknowledged} onCheckedChange={value => setAcknowledged(value === true)} disabled={!!busy || attempted} /><Label htmlFor="recipe-authorization" className="leading-5">L’essai connecté et ses frais sont autorisés pour cette cible ; la politique serveur est activée et sera supprimée après cette unique tentative.</Label></div>
      <Button type="button" onClick={() => void run(true)} className="min-h-10 w-full sm:w-auto" disabled={!!busy || attempted || !acknowledged || authStatus !== 'authenticated'}>{busy === 'generate' && <Loader2 aria-hidden="true" className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />}Exécuter la recette interne</Button>
    </CardContent></Card>}
    <div ref={message} tabIndex={-1} className="min-h-16 focus-visible:outline-none" aria-live="polite" aria-busy={!!busy}>
      {error && <Alert id="recipe-error" variant="destructive" role="alert"><AlertTitle>Recette arrêtée</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
      {storageBlocked && <Alert variant="destructive" role="alert"><AlertTitle>Suivi indisponible</AlertTitle><AlertDescription>Le suivi de tentative de cet onglet est indisponible. L’exécution est bloquée.</AlertDescription></Alert>}
      {result && checked?.actorId === user?.id && <Alert role="status"><AlertTitle>{result.engineVerified ? 'Brouillon interne confirmé' : 'Brouillon confirmé ; contrôle moteur non concluant'}</AlertTitle><AlertDescription className="space-y-2"><p className="break-all">Brouillon : {result.draftId}</p><p>L’accusé du mode sans fichiers et l’enregistrement ont été contrôlés. Aucun envoi n’a été demandé. Les invariants métier restent à comparer en lecture seule.</p><p>Faites supprimer immédiatement la politique serveur. Ne relancez pas l’essai.</p></AlertDescription></Alert>}
      {attempted && !storageBlocked && !busy && !result && !error && <p role="status" className="text-sm">Une tentative est déjà enregistrée dans cet onglet. Vérifiez le résultat en lecture seule et faites supprimer la politique serveur ; aucune relance n’est disponible.</p>}
      {busy && <p role="status" className="text-sm">{busy === 'check' ? 'Vérification en lecture seule…' : 'Recette en cours ; l’IA peut continuer même si cet écran est fermé…'}</p>}
    </div>
  </div></MainLayout>;
}
