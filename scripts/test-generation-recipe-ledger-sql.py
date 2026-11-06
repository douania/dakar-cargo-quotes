"""Offline PostgreSQL roles/RLS/concurrency test. No Cloud, ports or host volumes.
Uses the real new migration, canonical workspace function and draft owner policies.
JWT claim variables model PostgREST; GoTrue cryptography is not exercised here.
"""
from pathlib import Path
import subprocess,datetime,uuid,json,time,concurrent.futures,traceback,re,hashlib,argparse,os
parser=argparse.ArgumentParser();parser.add_argument('--out',required=True);parser.add_argument('--skip-handler',action='store_true');args=parser.parse_args()
repo=Path(__file__).resolve().parents[1];out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
A='11111111-1111-4111-8111-111111111111';B='22222222-2222-4222-8222-222222222222';C='cccccccc-cccc-4ccc-8ccc-cccccccccccc';E='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';T='dddddddd-dddd-4ddd-8ddd-dddddddddddd';C2='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';E2='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';T2='ffffffff-ffff-4fff-8fff-ffffffffffff';H='a'*64
G='33333333-3333-4333-8333-333333333333';G2='44444444-4444-4444-8444-444444444444'
cid=None;checks=[];errors=[];windows={};label='generation-recipe-ledger';started=datetime.datetime.now(datetime.timezone.utc).isoformat();handler_result=None
def uid():return str(uuid.uuid4())
def lit(v):
 if v is None:return 'NULL'
 if isinstance(v,bool):return 'true' if v else 'false'
 return "'"+str(v).replace("'","''")+"'"
def run(cmd,input=None):return subprocess.run(cmd,input=input,capture_output=True,text=True,encoding='utf8')
def sql(s,role=None,user=A,error=None):
 if role:s=f"SET ROLE {role}; SET request.jwt.claims={lit(json.dumps({'role':role,'sub':user}))}; "+s
 r=run(['docker','exec','-i',cid,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],s)
 if error:assert r.returncode!=0 and error in r.stderr,(r.stdout,r.stderr);return r.stderr
 assert r.returncode==0,r.stderr
 return r.stdout.strip()
def rpc(name,params,role='service_role',actor=A,error=None):
 text='SELECT public.'+name+'('+','.join(k+'=>'+lit(v) for k,v in params.items())+');'
 result=sql(text,role,actor,error)
 return result if error else json.loads(result)
def count(table):return int(sql('SELECT count(*) FROM public.'+table+';'))
def target(c=C,e=E):return {'p_case':c,'p_email':e}
def grant(g=G,c=C,e=E,actor=A,seconds=900):
 now=datetime.datetime.now(datetime.timezone.utc);w=((now-datetime.timedelta(seconds=1)).isoformat(timespec='milliseconds'),(now+datetime.timedelta(seconds=seconds)).isoformat(timespec='milliseconds'));windows[g]=w
 return rpc('register_generation_recipe_grant',dict(p_grant=g,p_actor=actor,**target(c,e),p_hash=H,p_starts=w[0],p_expires=w[1]))
def register_same(g=G,actor=A,h=H):return rpc('register_generation_recipe_grant',dict(p_grant=g,p_actor=actor,**target(),p_hash=h,p_starts=windows[g][0],p_expires=windows[g][1]))
def claim(a,k=None,g=G,actor=A,h=H,error=None):return rpc('claim_generation_recipe_attempt',dict(p_grant=g,p_attempt=a,p_actor=actor,p_hash=h,p_fence=k or uid()),error=error)
def finish(a,k,actor=A,error=None):return rpc('finish_generation_recipe_attempt',dict(p_attempt=a,p_actor=actor,p_fence=k,p_subject='[RECETTE AUTH] Synthetic',p_body='[RECETTE AUTH — NE PAS ENVOYER] Synthetic',p_to='sender@example.invalid',p_engine_verified=True),error=error)
def uncertain(a,k,actor=A):return rpc('mark_generation_recipe_uncertain',dict(p_attempt=a,p_actor=actor,p_fence=k))
def receipt(g=G,actor=A,c=C,e=E,error=None):return rpc('read_generation_recipe_receipt',dict(p_grant=g,p_actor=actor,**target(c,e)),error=error)
def revoke(g=G,actor=A):return rpc('revoke_generation_recipe_grant',dict(p_grant=g,p_actor=actor,**target()))
def lease(i=None,k=None,actor=A,e=E):return rpc('begin_generation_email_lease',dict(p_lease=i or uid(),p_actor=actor,p_email=e,p_fence=k or uid()))
def endlease(i,k,actor=A):return rpc('finish_generation_email_lease',dict(p_lease=i,p_actor=actor,p_fence=k))
def kind(r,k):assert r['kind']==k,(r,k)
def parallel(values,fn):
 with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:return list(pool.map(fn,values))
def reset():
 sql("DROP TRIGGER IF EXISTS synthetic_failure ON public.email_drafts; DROP TRIGGER IF EXISTS synthetic_receipt_failure ON public.generation_recipe_attempts; TRUNCATE public.generation_recipe_attempts,public.generation_recipe_grants,public.generation_recipe_email_leases,public.generation_recipe_quarantines,public.email_drafts; UPDATE auth.users SET banned_until=NULL; DELETE FROM public.app_roles; "+f"INSERT INTO public.app_roles(user_id,role) VALUES('{A}','workspace_operator'),('{B}','role_admin');")
 windows.clear()
 sql(f"UPDATE public.emails SET thread_ref='{T}' WHERE id='{E}'; UPDATE public.quote_cases SET thread_id='{T}' WHERE id='{C}'; DROP TRIGGER IF EXISTS synthetic_draft_gate ON public.email_drafts;")
def check(name,fn):
 reset();result=fn();assert result is not False,name;checks.append({'name':name,'status':'PASS'});print('PASS '+name,flush=True)
try:
 r=run(['docker','run','--pull','never','--rm','-d','--name','dcq-ledger-'+uuid.uuid4().hex[:12],'--label','dcq.local.test='+label,'--network','none','--tmpfs','/var/lib/postgresql/data','--memory','512m','--cpus','2','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-alpine']);assert r.returncode==0,r.stderr;cid=r.stdout.strip()
 for _ in range(120):
  final=run(['docker','exec',cid,'sh','-c','test "$(cat /proc/1/comm)" = postgres'])
  if final.returncode==0 and run(['docker','exec',cid,'pg_isready','-U','postgres']).returncode==0:break
  time.sleep(.1)
 else:raise RuntimeError('Synthetic PostgreSQL startup failed')
 sql('''CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,banned_until timestamptz);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
 ''')
 # auth.uid returns uuid; explicitly cast the canonical JWT sub in this fixture.
except Exception:
 errors.append(traceback.format_exc())
 # The fixture setup is completed below; any failure is handled by final cleanup.

try:
 if errors:raise RuntimeError(errors[-1])
 sql("CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$; CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role' $$; GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon,authenticated,service_role;")
 role_source=(repo/'supabase/migrations/20260620130000_pad_c2_app_roles.sql').read_text(encoding='utf8');ddl=re.search(r'CREATE TABLE IF NOT EXISTS public.app_roles \([\s\S]*?\n\);',role_source).group();sql(ddl);sql("ALTER TABLE public.app_roles DROP CONSTRAINT app_roles_role_check; ALTER TABLE public.app_roles ADD CHECK(role IN('pad_admin','pad_supervisor','tariff_admin','role_admin','workspace_operator'));")
 sql('''CREATE TABLE public.emails(id uuid PRIMARY KEY,thread_ref uuid);
 CREATE TABLE public.quote_cases(id uuid PRIMARY KEY,thread_id uuid UNIQUE,created_by uuid);
 CREATE TABLE public.email_drafts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),original_email_id uuid,to_addresses text[] NOT NULL,subject text NOT NULL,body_text text,status text,ai_generated boolean,created_by uuid,sent_at timestamptz,created_at timestamptz DEFAULT now());
 ALTER TABLE public.email_drafts ENABLE ROW LEVEL SECURITY;
 GRANT SELECT,INSERT,UPDATE,DELETE ON public.email_drafts TO authenticated;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
 ''')
 workspace=(repo/'supabase/migrations/20261007120000_internal_workspace_access.sql').read_text(encoding='utf8');fn=re.search(r'CREATE OR REPLACE FUNCTION public.has_workspace_access\(\)[\s\S]*?\$\$;',workspace).group();sql(fn);sql('REVOKE ALL ON FUNCTION public.has_workspace_access() FROM PUBLIC; GRANT EXECUTE ON FUNCTION public.has_workspace_access() TO anon,authenticated;')
 sql((repo/'supabase/migrations/20260328214504_70ce4140-5602-4760-b684-3253b429881f.sql').read_text(encoding='utf8'))
 sql('CREATE POLICY workspace_members_only ON public.email_drafts AS RESTRICTIVE FOR ALL TO PUBLIC USING(public.has_workspace_access()) WITH CHECK(public.has_workspace_access());')
 sql(f"INSERT INTO auth.users(id) VALUES('{A}'),('{B}'); INSERT INTO public.emails VALUES('{E}','{T}'),('{E2}','{T2}'); INSERT INTO public.quote_cases VALUES('{C}','{T}','{B}'),('{C2}','{T2}','{A}');")
 migration=repo/'supabase/migrations/20261105140000_generation_recipe_ledger.sql';sql(migration.read_text(encoding='utf8'))
 for role in ['anon','authenticated','service_role']:
  for table in ['generation_recipe_grants','generation_recipe_attempts','generation_recipe_email_leases','generation_recipe_quarantines']:
   check(role+' cannot directly read '+table,lambda role=role,table=table:sql('SELECT * FROM public.'+table+';',role,error='permission denied'))
 for role in ['anon','authenticated']:
  check(role+' cannot call privileged recipe RPC',lambda role=role:rpc('read_generation_recipe_receipt',dict(p_grant=G,p_actor=A,**target()),role=role,error='permission denied'))
 check('client forged service claim still lacks database EXECUTE',lambda:sql(f"SET ROLE authenticated; SET request.jwt.claims='{{\"role\":\"service_role\",\"sub\":\"{A}\"}}'; SELECT public.read_generation_recipe_receipt('{G}','{A}','{C}','{E}');",error='permission denied'))
 def wrong_claim_role():
  sql(f"SET ROLE service_role; SET request.jwt.claims='{{\"role\":\"authenticated\",\"sub\":\"{A}\"}}'; SELECT public.read_generation_recipe_receipt('{G}','{A}','{C}','{E}');",error='RECIPE_SERVICE_REQUIRED')
 check('RPC also verifies canonical service role claim',wrong_claim_role)
 def shared():kind(grant(),'registered');assert count('generation_recipe_grants')==1
 check('workspace operator can use shared case owned by another member',shared)
 def banned():sql(f"UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='{A}';");grant_error=dict(p_grant=G,p_actor=A,**target(),p_hash=H,p_starts='2026-01-01',p_expires='2026-01-01T00:10Z');rpc('register_generation_recipe_grant',grant_error,error='RECIPE_WORKSPACE_REQUIRED')
 check('banned actor cannot register',banned)
 def no_role():sql(f"DELETE FROM public.app_roles WHERE user_id='{A}';");receipt(error='RECIPE_WORKSPACE_REQUIRED')
 check('no admitted role denies even status',no_role)
 check('unknown grant status is generic not_found',lambda:kind(receipt(),'not_found'))
 for fn in ['read_generation_recipe_receipt','revoke_generation_recipe_grant']:
  for column in ['p_case','p_email','p_grant']:
   def null_target(fn=fn,column=column):
    grant();params=dict(p_grant=G,p_actor=A,**target());params[column]=None;kind(rpc(fn,params),'not_found');assert sql(f"SELECT revoked_at IS NULL FROM public.generation_recipe_grants WHERE id='{G}';")=='t'
   check(fn+' rejects NULL '+column,null_target)
 check('private target validator returns false on missing identifiers',lambda:sql(f"SELECT public.generation_recipe_target_valid(NULL,'{E}') IS FALSE AND public.generation_recipe_target_valid('{C}',NULL) IS FALSE;")== 't')
 def target_mismatch():kind(grant(g=G,c=C,e=E2),'forbidden');assert count('generation_recipe_grants')==0
 check('grant rejects mismatched canonical case and email',target_mismatch)
 check('canonical unique thread rejects second case',lambda:sql(f"INSERT INTO public.quote_cases VALUES('{uid()}','{T}','{A}');",error='23505'))
 def concurrent_claims():grant();a=uid();rows=parallel(range(24),lambda _:claim(a));assert sum(x['kind']=='started' for x in rows)==1;assert count('generation_recipe_attempts')==1
 check('24 same-key claims admit exactly one worker',concurrent_claims)
 def changed_keys():grant();rows=parallel(range(24),lambda _:claim(uid()));assert sum(x['kind']=='started' for x in rows)==1;assert count('generation_recipe_attempts')==1
 check('24 changed keys share one stable server grant',changed_keys)
 def recovery():grant();a,k=uid(),uid();claim(a,k);finish(a,k);kind(claim(uid()),'replay');r=receipt();assert r['state']=='completed' and r['attempt_id']==a and count('email_drafts')==1
 check('lost ACK with changed client key replays original completed draft',recovery)
 def pending():grant();a,k=uid(),uid();claim(a,k);uncertain(a,k);kind(claim(uid()),'unresolved');kind(lease(),'unresolved');revoke();kind(lease(),'unresolved');assert count('email_drafts')==0
 check('uncertain email survives policy-equivalent grant revocation',pending)
 def intent_conflict():grant();kind(register_same(h='b'*64),'conflict');assert count('generation_recipe_grants')==1
 check('same server grant cannot change semantic intent',intent_conflict)
 def no_renewal():
  grant();w=windows[G];kind(rpc('register_generation_recipe_grant',dict(p_grant=G,p_actor=A,**target(),p_hash=H,p_starts=w[0],p_expires=(datetime.datetime.fromisoformat(w[1])+datetime.timedelta(minutes=1)).isoformat())),'conflict')
 check('same server grant cannot renew its immutable window',no_renewal)
 def no_ttl_escape():
  kind(grant(seconds=.8),'registered');a,k=uid(),uid();kind(claim(a,k),'started');sql('SELECT pg_sleep(1);');kind(claim(uid()),'unresolved');kind(finish(a,k),'unresolved');revoke();kind(grant(g=G2),'unresolved');kind(lease(),'unresolved');assert receipt()['state']=='uncertain' and count('email_drafts')==0
 check('expiry revoke new grant and new nonce never reclaim unresolved work',no_ttl_escape)
 def complete_concurrent():grant();a,k=uid(),uid();claim(a,k);rows=parallel(range(24),lambda _:finish(a,k));assert all(x['kind']=='completed' for x in rows);assert count('email_drafts')==1
 check('24 finish calls create one draft and receipt',complete_concurrent)
 def wrong_fence():grant();a,k=uid(),uid();claim(a,k);kind(finish(a,None),'forbidden');kind(finish(a,uid()),'forbidden');assert count('email_drafts')==0
 check('NULL and wrong fences cannot finish',wrong_fence)
 def crossed():grant();a,k=uid(),uid();claim(a,k);finish(a,k);kind(receipt(actor=B),'not_found');kind(claim(uid(),actor=B),'forbidden')
 check('shared workspace never exposes another actor receipt',crossed)
 for column,value in [('actor_id',B),('case_id',C2),('email_id',E2),('intent_hash','b'*64),('starts_at','2025-01-01'),('expires_at','2027-01-01')]:
  def immutable(column=column,value=value):grant();sql(f'UPDATE public.generation_recipe_grants SET {column}={lit(value)} WHERE id={lit(G)};',error='RECIPE_GRANT_IMMUTABLE')
  check('grant binding immutable: '+column,immutable)
 def monotone():grant();revoke();sql(f"UPDATE public.generation_recipe_grants SET revoked_at=NULL WHERE id='{G}';",error='RECIPE_GRANT_IMMUTABLE')
 check('revocation cannot be undone',monotone)
 def no_delete():grant();sql(f"DELETE FROM public.generation_recipe_grants WHERE id='{G}';",error='RECIPE_GRANT_IMMUTABLE')
 check('grant evidence cannot be purged',no_delete)
 def preserve_deleted():grant();a,k=uid(),uid();claim(a,k);finish(a,k);d=receipt()['draft_id'];assert sql('SELECT count(*) FROM public.email_drafts;','authenticated',A)=='1';assert sql('SELECT count(*) FROM public.email_drafts;','authenticated',B)=='0';sql(f"DELETE FROM public.email_drafts WHERE id='{d}';",'authenticated',A);kind(claim(uid()),'replay');assert receipt()['draft_id']==d and count('email_drafts')==0
 check('canonical owner RLS/delete preserved; deleted draft never regenerates',preserve_deleted)
 def status_readonly():grant();a,k=uid(),uid();claim(a,k);finish(a,k);revoke();before=sql("SELECT md5(string_agg(row_to_json(t)::text,'|' ORDER BY id)) FROM public.generation_recipe_attempts t;");r=receipt();assert r['revoked'] and r['state']=='completed';assert before==sql("SELECT md5(string_agg(row_to_json(t)::text,'|' ORDER BY id)) FROM public.generation_recipe_attempts t;")
 check('revoked completed receipt remains readonly and owner bound',status_readonly)
 for stage in ['draft','receipt']:
  def failure(stage=stage):
   grant();a,k=uid(),uid();claim(a,k)
   table='email_drafts' if stage=='draft' else 'generation_recipe_attempts';event='INSERT' if stage=='draft' else 'UPDATE';trigger='synthetic_failure' if stage=='draft' else 'synthetic_receipt_failure'
   sql(f"CREATE OR REPLACE FUNCTION public.{trigger}() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'SYNTHETIC_FAILURE'; END$$; CREATE TRIGGER {trigger} BEFORE {event} ON public.{table} FOR EACH ROW EXECUTE FUNCTION public.{trigger}();")
   finish(a,k,error='SYNTHETIC_FAILURE');assert count('email_drafts')==0 and receipt()['state']=='running'
  check('atomic rollback on '+stage+' failure',failure)
 def norm_first():i,k=uid(),uid();kind(lease(i,k),'started');kind(grant(),'unresolved');endlease(i,k);kind(grant(),'registered');kind(lease(),'unresolved')
 check('normal lease and recipe reservation exclude each other atomically',norm_first)
 def fenced_normal_finish():
  i,k=uid(),uid();kind(lease(i,k),'started')
  endlease(i,k,actor=B);endlease(i,uid());assert sql(f"SELECT state FROM public.generation_recipe_email_leases WHERE id='{i}';")=='active'
  kind(lease(actor=B),'unresolved');endlease(i,k);assert sql(f"SELECT state FROM public.generation_recipe_email_leases WHERE id='{i}';")=='finished'
  newer,token=uid(),uid();kind(lease(newer,token,actor=B),'started');endlease(i,k)
  assert sql(f"SELECT state FROM public.generation_recipe_email_leases WHERE id='{newer}';")=='active'
 check('finished normal failure cannot release another actor or a newer lease',fenced_normal_finish)
 def normal_race():
  rows=parallel(range(24),lambda n:lease() if n%2 else grant(g=uid()));kinds={x['kind'] for x in rows};assert not({'registered','started'}<=kinds),rows;assert 'registered' in kinds or 'started' in kinds
 check('24 normal-v2 races cannot admit both categories',normal_race)
 def sticky_lease():i,k=uid(),uid();lease(i,k);sql(f"DELETE FROM public.generation_recipe_email_leases WHERE id='{i}';",error='RECIPE_LEASE_UNRESOLVED');kind(grant(),'unresolved');endlease(i,k);kind(grant(),'registered')
 check('normal lease has no TTL or deletion escape',sticky_lease)
 def quarantine():sql(f"INSERT INTO public.generation_recipe_quarantines(email_id,case_id,created_by,reason) VALUES('{E}','{C}','{B}','legacy_unconfirmed');");kind(lease(),'unresolved');kind(grant(),'unresolved');sql(f"DELETE FROM public.generation_recipe_quarantines WHERE email_id='{E}';",error='RECIPE_QUARANTINE_IMMUTABLE')
 check('legacy administrative quarantine blocks both paths durably',quarantine)
 def safe_disable():grant();a,k=uid(),uid();claim(a,k);sql((repo/'supabase/rollbacks/20261105140000_generation_recipe_ledger.sql').read_text(encoding='utf8'));kind(receipt(),'receipt');kind(lease(),'unresolved');claim(uid(),error='permission denied');sql('GRANT EXECUTE ON FUNCTION public.register_generation_recipe_grant(uuid,uuid,uuid,uuid,text,timestamptz,timestamptz),public.claim_generation_recipe_attempt(uuid,uuid,uuid,text,uuid) TO service_role;')
 check('disable script retains records, status and durable reservations',safe_disable)
 # Concurrency revocation is synchronized by an actual advisory waiter in THIS
 # isolated PG instance, not an application/private runtime log.
 def revoke_while_waiting(operation,what):
  grant();a,k,tag=uid(),uid(),'ledger_wait_'+uuid.uuid4().hex[:8]
  if operation=='finish':claim(a,k)
  key=('recipe-email:'+E) if operation=='finish' else ('recipe-attempt:'+a)
  holder=subprocess.Popen(['docker','exec','-i',cid,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8',bufsize=1)
  holder.stdin.write(f"BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('{key}',0)); SELECT 'LOCKED';\n");holder.stdin.flush()
  while holder.stdout.readline().strip()!='LOCKED':
   if holder.poll() is not None:raise RuntimeError('Synthetic blocker failed')
  params=dict(p_attempt=a,p_actor=A,p_fence=k,p_subject='[RECETTE AUTH] Synthetic',p_body='[RECETTE AUTH — NE PAS ENVOYER] Synthetic',p_to='sender@example.invalid',p_engine_verified=True) if operation=='finish' else dict(p_grant=G,p_attempt=a,p_actor=A,p_hash=H,p_fence=k)
  fn='finish_generation_recipe_attempt' if operation=='finish' else 'claim_generation_recipe_attempt';call='SELECT public.'+fn+'('+','.join(x+'=>'+lit(v) for x,v in params.items())+');'
  with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
   def waiting_call():
    r=run(['docker','exec','-i',cid,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],f"SET application_name='{tag}';SET ROLE service_role;SET request.jwt.claims='{{\"role\":\"service_role\"}}';"+call)
    return r
   future=pool.submit(waiting_call)
   try:
    for _ in range(60):
     if sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{tag}' AND wait_event='advisory';")=='1':break
     time.sleep(.02)
    else:raise AssertionError('Synthetic waiter missing')
    revoke_sql=f"UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='{A}';" if what=='ban' else f"DELETE FROM public.app_roles WHERE user_id='{A}';" if what=='roles' else f"UPDATE public.generation_recipe_grants SET revoked_at=clock_timestamp() WHERE id='{G}';"
    sql("SET statement_timeout='2s';"+revoke_sql)
   finally:holder.stdin.write('COMMIT;\n\\q\n');holder.stdin.flush();holder.stdin.close();holder.wait(timeout=5)
   r=future.result(timeout=10)
   if what=='grant':assert r.returncode==0 and json.loads(r.stdout.strip())['kind']=='forbidden',r.stderr
   else:assert r.returncode!=0 and 'RECIPE_WORKSPACE_REQUIRED' in r.stderr,r.stderr
   assert count('email_drafts')==0
 for operation in ['claim','finish']:
  for what in ['ban','roles','grant']:check(operation+' revalidates concurrent '+what,lambda operation=operation,what=what:revoke_while_waiting(operation,what))
 def stable_target(table):
  grant();a,k,tag=uid(),uid(),'target_wait_'+uuid.uuid4().hex[:8];claim(a,k)
  sql("CREATE OR REPLACE FUNCTION public.synthetic_draft_gate() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN PERFORM pg_advisory_xact_lock(hashtextextended('synthetic-draft-gate',0)); RETURN NEW; END$$; CREATE TRIGGER synthetic_draft_gate BEFORE INSERT ON public.email_drafts FOR EACH ROW EXECUTE FUNCTION public.synthetic_draft_gate();")
  holder=subprocess.Popen(['docker','exec','-i',cid,'psql','-X','-qAt','-U','postgres','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf8',bufsize=1)
  holder.stdin.write("BEGIN; SELECT pg_advisory_xact_lock(hashtextextended('synthetic-draft-gate',0)); SELECT 'LOCKED';\n");holder.stdin.flush()
  while holder.stdout.readline().strip()!='LOCKED':
   if holder.poll() is not None:raise RuntimeError('Synthetic gate holder failed')
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
   final=pool.submit(finish,a,k)
   try:
    for _ in range(100):
     if sql("SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%finish_generation_recipe_attempt%' AND wait_event='advisory';")=='1':break
     time.sleep(.02)
    else:raise AssertionError('Finalizer did not reach synthetic insert gate')
    column='thread_ref' if table=='emails' else 'thread_id';row=E if table=='emails' else C
    def mutate():return sql(f"SET application_name='{tag}';UPDATE public.{table} SET {column}='{uid()}' WHERE id='{row}';")
    mutation=pool.submit(mutate)
    for _ in range(100):
     if sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{tag}' AND wait_event_type='Lock';")=='1':break
     time.sleep(.02)
    else:raise AssertionError('Canonical attachment changed before draft commit')
    assert not mutation.done()
   finally:holder.stdin.write('COMMIT;\n\\q\n');holder.stdin.flush();holder.stdin.close();holder.wait(timeout=5)
   kind(final.result(timeout=10),'completed');mutation.result(timeout=10);assert count('email_drafts')==1
 for table in ['emails','quote_cases']:check('terminal transaction stabilizes '+table+' canonical thread',lambda table=table:stable_target(table))
 if not args.skip_handler:
  reset();env=os.environ.copy();env['RECIPE_SQL_TEST_CONTAINER']=cid
  command=['deno','test','--import-map=scripts/deno-ci-imports.json','--allow-env','--allow-read','--allow-run=docker','--no-check','--no-lock','--node-modules-dir=none','--filter','ledger SQL pipeline','scripts/generation-recipe-handler-sql_test.ts']
  r=subprocess.run(command,cwd=repo,env=env,capture_output=True,text=True,encoding='utf8');(out/'handler-sql.log').write_text(r.stdout+r.stderr,encoding='utf8');handler_result={'exit_code':r.returncode,'command':command};assert r.returncode==0,r.stdout+r.stderr
 status='PASS_POSTGRESQL_ROLES_RLS_AND_LEDGER'
except Exception:status='FAIL';errors.append(traceback.format_exc());print(errors[-1],flush=True)
finally:
 if cid:
  info=run(['docker','inspect','--format','{{index .Config.Labels "dcq.local.test"}}',cid]);assert info.returncode==0 and info.stdout.strip()==label
  cleanup=run(['docker','rm','-f',cid]);assert cleanup.returncode==0,cleanup.stderr
 result={'status':status,'started':started,'ended':datetime.datetime.now(datetime.timezone.utc).isoformat(),'tests':checks,'passed':len(checks),'errors':errors,'handler_pipeline':handler_result,'container':cid,'own_container_removed':bool(cid),'network':'none; pull never; no host ports/volumes','migration_sha256':hashlib.sha256((repo/'supabase/migrations/20261105140000_generation_recipe_ledger.sql').read_bytes()).hexdigest(),'fixture':'Canonical app_roles DDL with current role constraint; canonical workspace function and draft owner policies; focused emails/cases/users schemas. PostgREST JWT claims simulated, no provider cryptography or Cloud proof.'}
 (out/'sql-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps({'status':status,'passed':len(checks),'handler':handler_result,'own_container_removed':bool(cid)}),flush=True)
 if status=='FAIL':raise SystemExit(1)
