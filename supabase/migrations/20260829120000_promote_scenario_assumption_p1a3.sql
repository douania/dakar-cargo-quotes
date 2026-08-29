-- Phase P1-A3 — Promotion EXPLICITE et ATOMIQUE d'UNE hypothèse opérateur
-- vers public.quote_facts, via la RPC service_role-only
-- public.promote_scenario_assumption + le registre append-only
-- public.quote_fact_promotions.
--
-- PORTÉE STRICTE
--   * table créée : public.quote_fact_promotions (registre d'idempotence et de
--     preuve de promotion, deny-all) ;
--   * seules écritures métier : (a) un fait via la fonction EXISTANTE et
--     INCHANGÉE public.supersede_fact, (b) la transition terminale de l'unique
--     hypothèse promue, (c) une ligne de registre, (d) un événement de timeline ;
--   * AUCUNE écriture dans quote_gaps / client_gap_requests / quote_scenarios /
--     quote_scenario_links / quote_scenario_selections / quote_request_lines /
--     quotation_versions / pricing_runs / tarifs ;
--   * AUCUN calcul de prix, AUCUN montant, AUCUNE donnée tarifaire : l'allowlist
--     de clés promouvables est FERMÉE et exclut par construction toute clé
--     monétaire ou tarifaire (arbitrage CTO n°1) ;
--   * AUCUNE dé-promotion : la transition est terminale et sans retour
--     (arbitrage CTO n°6) ;
--   * AUCUN batch : une seule hypothèse par appel (arbitrage CTO n°4) ;
--   * aucune extension d'enum partagé : la timeline réutilise
--     `fact_injected_manual`, déjà autorisé par le CHECK courant de
--     case_timeline_events (20260325163446) et déjà écrit par set-case-fact
--     (arbitrage CTO n°8).
--
-- ADDITIVE ET NON DESTRUCTIVE
--   * création pure : aucun DROP, aucun ALTER d'objet existant, aucun DELETE ;
--   * public.supersede_fact, public.manage_scenario_assumption,
--     public.manage_quote_scenario, toutes les policies, tous les rôles et tous
--     les GRANT existants sont laissés EXACTEMENT en l'état ;
--   * chaque bloc est gardé (IF NOT EXISTS / pg_constraint / pg_trigger) :
--     la migration est rejouable sans effet de bord.
--
-- ARBITRAGES INSCRITS DANS LE SCHÉMA
--   1. Une promotion n'est JAMAIS automatique : elle exige une clé cible
--      explicite, une base de promotion d'un vocabulaire FERMÉ, une attestation
--      booléenne vraie, et l'écho exact de ce que l'opérateur a vu (valeur du
--      registre d'hypothèses, fait courant remplacé, périmètre de scénario).
--   2. La VALEUR ÉCRITE est lue du ledger `quote_scenario_assumptions`, jamais
--      du payload. Le payload ne porte qu'un ÉCHO servant d'assertion d'égalité :
--      s'il diverge, la requête échoue au lieu d'être devinée.
--   3. Le fait produit porte source_type = 'manual_input' et confidence = 1.0
--      (arbitrages CTO n°9 et n°3) : il hérite ainsi de la protection existante
--      de build-case-puzzle, qui ne désactive jamais un fait manuel.
--   4. Le registre est APPEND-ONLY et deny-all : ni SELECT authenticated, ni
--      UPDATE, ni DELETE, aucune policy, aucun GRANT hors EXECUTE de la RPC.

-- =====================================================================
-- 1. Garde monétaire — jetons comparés TOKEN À TOKEN
--
--    public.quote_scenario_monetary_token (P1-A2) découpe sur `_` seulement :
--    sur une CLÉ DE FAIT pointée (`cargo.caf_value`, `cargo.freight_cost`), le
--    premier segment resterait `cargo.caf` et la clé passerait. On découpe donc
--    ici sur `.` ET `_`, et on ajoute les jetons propres au domaine des faits
--    (`value`, `freight`, `exchange`, incoterms de valorisation…).
--
--    Comparaison EXACTE de jeton, jamais en sous-chaîne : `chargeable` n'est pas
--    `charge`, `container` n'est pas `contain`. Sans cela l'allowlist légitime
--    `cargo.chargeable_weight_kg` serait rejetée.
-- =====================================================================
create or replace function public.quote_fact_promotion_monetary_token(p_key text)
returns boolean
language sql
immutable
strict
parallel safe
as $$
  select exists (
    select 1
      from unnest(regexp_split_to_array(lower(p_key), '[._]')) as t(token)
     where t.token in (
       -- valeur et prix
       'value','values','valeur','valeurs',
       'price','prices','pricing','prix',
       'tarif','tarifs','tariff','taux',
       'rate','rates',
       'amount','amounts','montant','montants',
       'total','totals','subtotal','sum',
       'cost','costs','cout','couts',
       'fee','fees','frais',
       'charge','charges',
       -- devises et monnaie
       'currency','currencies','devise','devises',
       'money','monnaie','invoice','facture','billing',
       'exchange','change',
       'usd','eur','xof','fcfa','cfa',
       -- marge, remise, majoration
       'margin','marge','discount','remise','surcharge',
       -- fiscalité et douane chiffrée
       'tax','taxes','taxe','duty','duties','droit','droits','vat','tva',
       -- bases de valorisation à l'import/export
       'caf','cif','fob','exw','ddp','dap',
       -- coût de transport
       'freight','fret'
     )
  );
$$;

-- =====================================================================
-- 2. ALLOWLIST FERMÉE des clés promouvables
--
--    Ce n'est PAS l'allowlist de set-case-fact. Celle-ci en est un
--    sous-ensemble strict, amputé de tout ce qui est monétaire, tarifaire ou
--    déjà couvert par un workflow dédié :
--
--      * exclues comme monétaires/tarifaires (arbitrage CTO n°1) :
--        cargo.value, cargo.caf_value, cargo.freight_cost,
--        cargo.pad_rate_fcfa_per_ton, cargo.freight_exchange_rate ;
--      * exclues car porteuses de montants imbriqués :
--        cargo.articles_detail, cargo.containers, service.overrides — un
--        `value` / `unit_price` / `line_total` y voyagerait à l'intérieur d'un
--        json, hors de portée d'un contrôle par clé ;
--      * exclues car relevant d'un workflow de classification dédié :
--        cargo.hs_code et cargo.pad_category passent par
--        commodity_classification_candidates →
--        propagate_classification_candidate_to_fact. Les promouvoir ici
--        court-circuiterait ce chemin ;
--      * exclue car réglementairement chiffrante : regulatory.exemption_title
--        (une exonération modifie directement droits et taxes) ;
--      * exclue car identité de tiers, non hypothèse de périmètre : client.code.
--
--    Ne restent que des dimensions de PÉRIMÈTRE, exactement le vocabulaire que
--    P1-A2 a déjà déclaré non monétaire dans scope_snapshot.
--
--    Les types promouvables sont volontairement bornés à `text` et `number` :
--    aucun `json` ne peut donc entrer dans quote_facts par cette voie, ce qui
--    ferme définitivement le passage d'une clé monétaire imbriquée.
-- =====================================================================
create or replace function public.quote_fact_promotion_allowlist()
returns table (
  fact_key      text,
  fact_category text,
  value_type    text,
  allowed_values text[],
  min_value     numeric,
  max_value     numeric,
  integer_only  boolean
)
language sql
immutable
parallel safe
as $$
  select *
    from (values
      -- Cargo : mesures et description, aucune valorisation.
      ('cargo.weight_kg',                'cargo',   'number', null::text[], 0.001::numeric, 1000000000::numeric, false),
      ('cargo.chargeable_weight_kg',     'cargo',   'number', null::text[], 0.001::numeric, 1000000000::numeric, false),
      ('cargo.weight_per_container_kg',  'cargo',   'number', null::text[], 0.001::numeric, 1000000000::numeric, false),
      ('cargo.volume_cbm',               'cargo',   'number', null::text[], 0.001::numeric, 1000000::numeric,    false),
      ('cargo.pieces_count',             'cargo',   'number', null::text[], 1::numeric, 100000::numeric,     true),
      ('cargo.container_count',          'cargo',   'number', null::text[], 1::numeric, 500::numeric,        true),
      ('cargo.container_type',           'cargo',   'text',   array[
        '20DV','20DC','20GP','20ST','20RF','20OT','20FR',
        '40DV','40DC','40GP','40ST','40HC','40HQ','40RF','40OT','40FR',
        '45HC','45HQ'
      ], null::numeric, null::numeric, false),
      ('cargo.description',              'cargo',   'text',   null::text[], null::numeric, null::numeric,    false),
      -- Routing : itinéraire et mode, aucune condition de vente chiffrée.
      ('routing.transport_mode',         'routing', 'text',   array['AIR','MARITIME','ROUTE','MULTIMODAL'], null::numeric, null::numeric, false),
      ('routing.incoterm',               'routing', 'text',   array['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP'], null::numeric, null::numeric, false),
      ('routing.origin_port',            'routing', 'text',   null::text[], null::numeric, null::numeric,    false),
      ('routing.origin_country',         'routing', 'text',   null::text[], null::numeric, null::numeric,    false),
      ('routing.destination_port',       'routing', 'text',   null::text[], null::numeric, null::numeric,    false),
      ('routing.destination_country',    'routing', 'text',   null::text[], null::numeric, null::numeric,    false),
      ('routing.destination_city',       'routing', 'text',   null::text[], null::numeric, null::numeric,    false),
      -- TERMINAL-GAP : quel terminal opère l'envoi. Dimension de périmètre déjà
      -- déclarée dans le scope_snapshot P1-A2 ; vocabulaire canonique fermé.
      ('routing.terminal_operation_mode','routing', 'text',   array['LOLO','RORO','CONRO'], null::numeric, null::numeric, false),
      -- Douane : le RÉGIME, pas son chiffrage.
      ('customs.regime_code',            'customs', 'text',   null::text[], null::numeric, null::numeric,    false)
    ) as t(fact_key, fact_category, value_type, allowed_values, min_value, max_value, integer_only);
$$;

-- ASSERTION DE MIGRATION, fail-closed : aucune clé de l'allowlist ne peut être
-- monétaire, et chacune doit être une catégorie acceptée par le CHECK courant de
-- quote_facts. Une dérive future de l'allowlist fait échouer la migration au
-- lieu d'ouvrir silencieusement un passage vers un montant.
do $$
declare
  v_bad text;
begin
  select string_agg(a.fact_key, ', ' order by a.fact_key) into v_bad
    from public.quote_fact_promotion_allowlist() a
   where public.quote_fact_promotion_monetary_token(a.fact_key);
  if v_bad is not null then
    raise exception using
      errcode = '23514',
      message = 'P1-A3 — l''allowlist de promotion contient une clé monétaire ou tarifaire.',
      detail  = v_bad,
      hint    = 'Arbitrage CTO n°1 : les clés monétaires et tarifaires sont exclues de la promotion.';
  end if;

  select string_agg(a.fact_key, ', ' order by a.fact_key) into v_bad
    from public.quote_fact_promotion_allowlist() a
   where a.value_type not in ('text','number')
      or a.fact_category not in (
        'cargo','routing','timing','pricing','documents','contacts',
        'other','service','regulatory','carrier','survey','customs','transport');
  if v_bad is not null then
    raise exception using
      errcode = '23514',
      message = 'P1-A3 — l''allowlist de promotion déclare un type ou une catégorie non supportés.',
      detail  = v_bad;
  end if;
end $$;

-- =====================================================================
-- 3. Validateur de couple (clé, type, valeur)
--
--    Renvoie NULL si le couple est promouvable, sinon un motif STABLE repris
--    tel quel par l'erreur de la RPC et par le CHECK du registre.
--
--    Fonction TOTALE : évaluée par un CHECK dont PostgreSQL ne spécifie pas
--    l'ordre d'évaluation, elle ne lève jamais, quelle que soit l'entrée.
-- =====================================================================
create or replace function public.quote_fact_promotion_violation(
  p_fact_key text,
  p_value_type text,
  p_value jsonb
)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  v_row  record;
  v_text text;
  v_num  numeric;
begin
  if p_fact_key is null then
    return 'missing:fact_key';
  end if;

  select * into v_row
    from public.quote_fact_promotion_allowlist() a
   where a.fact_key = p_fact_key;
  if not found then
    return 'fact_key_not_promotable:' || p_fact_key;
  end if;

  -- Défense en profondeur : même si l'allowlist dérivait, une clé monétaire ne
  -- peut pas être promue.
  if public.quote_fact_promotion_monetary_token(p_fact_key) then
    return 'monetary_key:' || p_fact_key;
  end if;

  if p_value_type is distinct from v_row.value_type then
    return 'value_type_mismatch:' || p_fact_key || ':attendu=' || v_row.value_type
        || ':fourni=' || coalesce(p_value_type, 'null');
  end if;

  if p_value is null then
    return 'missing:value';
  end if;

  if v_row.value_type = 'text' then
    if jsonb_typeof(p_value) <> 'string' then
      return 'invalid_value_shape:' || p_fact_key || ':string attendu';
    end if;
    v_text := btrim(p_value #>> '{}');
    if v_text = '' then
      return 'empty_value:' || p_fact_key;
    end if;
    if length(v_text) > (case
        when p_fact_key = 'cargo.description' then 500
        when p_fact_key = 'routing.destination_city' then 120
        else 200
      end) then
      return 'value_too_long:' || p_fact_key;
    end if;
    -- Un caractère de contrôle rendrait l'excerpt d'audit et l'affichage
    -- opérateur non fidèles à ce qui est écrit dans quote_facts.
    if v_text ~ '[\x01-\x1F\x7F]' then
      return 'control_character:' || p_fact_key;
    end if;
    if v_row.allowed_values is not null and not (v_text = any (v_row.allowed_values)) then
      return 'value_not_allowed:' || p_fact_key || ':' || v_text;
    end if;
    if p_fact_key in ('routing.origin_port','routing.destination_port')
       and v_text !~ '^[A-Z]{2}[A-Z2-9]{3}$' then
      return 'invalid_unlocode:' || p_fact_key;
    end if;
    if p_fact_key in ('routing.origin_country','routing.destination_country')
       and v_text !~ '^[A-Z]{2}$' then
      return 'invalid_country_code:' || p_fact_key;
    end if;
    if p_fact_key = 'customs.regime_code'
       and v_text !~ '^[A-Z0-9][A-Z0-9._/-]{0,31}$' then
      return 'invalid_regime_code:' || p_fact_key;
    end if;
    return null;
  end if;

  -- value_type = 'number'
  if jsonb_typeof(p_value) <> 'number' then
    return 'invalid_value_shape:' || p_fact_key || ':number attendu';
  end if;
  v_num := (p_value #>> '{}')::numeric;
  if v_row.integer_only and v_num <> trunc(v_num) then
    return 'non_integer_value:' || p_fact_key;
  end if;
  if not v_row.integer_only and v_num <> round(v_num, 3) then
    return 'too_many_decimals:' || p_fact_key;
  end if;
  if v_row.min_value is not null and v_num < v_row.min_value then
    return 'value_out_of_range:' || p_fact_key || ':' || v_num::text;
  end if;
  if v_row.max_value is not null and v_num > v_row.max_value then
    return 'value_out_of_range:' || p_fact_key || ':' || v_num::text;
  end if;
  return null;
exception when others then
  -- Totalité garantie : un CHECK ne doit jamais remplacer une violation lisible
  -- par une erreur brute.
  return 'unevaluable:' || coalesce(p_fact_key, 'null');
end;
$$;

-- =====================================================================
-- 4. quote_fact_promotions — registre APPEND-ONLY, deny-all
--
--    L'idempotence est une propriété de la REQUÊTE. La promotion, elle, est
--    UNIQUE par hypothèse : une hypothèse promue est terminale et P1-A3 ne
--    dé-promeut jamais (arbitrage CTO n°6). Les deux unicités sont donc posées.
-- =====================================================================
create table if not exists public.quote_fact_promotions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.quote_cases(id) on delete cascade,
  assumption_id uuid not null references public.quote_scenario_assumptions(id),

  -- Le fait produit, et celui qu'il remplace (null si aucun fait courant).
  promoted_fact_id uuid not null references public.quote_facts(id),
  superseded_fact_id uuid null references public.quote_facts(id),

  fact_key text not null,
  fact_category text not null,
  value_type text not null
    constraint quote_fact_promotions_value_type_check
      check (value_type in ('text','number')),

  -- Copie EXACTE de la valeur écrite, telle que lue du ledger. C'est ce qui
  -- rend le registre auto-suffisant pour une contre-revue : on n'a pas à
  -- reconstituer l'état de quote_scenario_assumptions au moment du geste.
  promoted_value jsonb not null,

  -- INVARIANT NON CONTOURNABLE : aucune ligne ne peut être enregistrée pour un
  -- couple (clé, type, valeur) hors de l'allowlist FERMÉE et non monétaire.
  -- Le registre étant écrit dans la même transaction que le fait, cette
  -- contrainte protège aussi quote_facts : une promotion hors allowlist ne peut
  -- pas commiter.
  constraint quote_fact_promotions_value_promotable
    check (public.quote_fact_promotion_violation(fact_key, value_type, promoted_value) is null),

  -- Statut de l'hypothèse AU MOMENT du geste (arbitrage CTO n°2).
  assumption_status_before text not null
    constraint quote_fact_promotions_source_status_check
      check (assumption_status_before in ('active','client_confirmed')),

  -- Base de promotion OBLIGATOIRE et FERMÉE (arbitrage CTO n°2).
  promotion_basis text not null
    constraint quote_fact_promotions_basis_check
      check (promotion_basis in (
        'client_written_confirmation',
        'document_evidence',
        'partner_confirmation',
        'regulatory_reference',
        'operator_expertise'
      )),

  -- Attestation explicite de l'opérateur. `false` n'est pas représentable :
  -- une ligne de registre atteste, ou n'existe pas.
  attested boolean not null
    constraint quote_fact_promotions_attested_true check (attested),

  -- Contexte de scénario éventuel, figé à sa révision exacte.
  scenario_id uuid null references public.quote_scenarios(id),
  scenario_scope_hash text null
    constraint quote_fact_promotions_scope_hash_sha256
      check (scenario_scope_hash is null or scenario_scope_hash ~ '^[0-9a-f]{64}$'),
  constraint quote_fact_promotions_scenario_hash_paired
    check ((scenario_id is null) = (scenario_scope_hash is null)),

  idempotency_key text not null
    constraint quote_fact_promotions_key_len
      check (length(idempotency_key) between 8 and 128),
  request_fingerprint text not null
    constraint quote_fact_promotions_fingerprint_sha256
      check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),

  constraint quote_fact_promotions_no_self_supersede
    check (superseded_fact_id is null or superseded_fact_id <> promoted_fact_id)
);

-- Idempotence forte : une clé ne désigne qu'une seule requête par dossier.
create unique index if not exists uq_quote_fact_promotions_idem
  on public.quote_fact_promotions (case_id, idempotency_key);
-- Une hypothèse n'est promue qu'UNE FOIS, définitivement.
create unique index if not exists uq_quote_fact_promotions_assumption
  on public.quote_fact_promotions (assumption_id);
-- Un fait n'est produit que par une seule promotion.
create unique index if not exists uq_quote_fact_promotions_fact
  on public.quote_fact_promotions (promoted_fact_id);
create index if not exists idx_quote_fact_promotions_case
  on public.quote_fact_promotions (case_id, created_at desc);

-- Registre d'audit interne : aucun accès Data API. RLS activée SANS policy
-- (deny-all pour anon/authenticated) et aucun GRANT (arbitrage CTO n°7).
alter table public.quote_fact_promotions enable row level security;

-- =====================================================================
-- 5. Gardes : append-only strict + cohérence inter-dossiers
--    Aucun CHECK ne peut interroger une autre table : c'est un trigger.
-- =====================================================================
create or replace function public.quote_fact_promotions_enforce_invariants()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case uuid;
  v_key  text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'CONFLICT_INVALID_STATE: le registre de promotion est append-only (UPDATE refusé). Aucune dé-promotion en P1-A3.'
      using errcode = '23514';
  end if;

  select case_id into v_case from quote_scenario_assumptions where id = new.assumption_id;
  if v_case is not null and v_case <> new.case_id then
    raise exception 'FORBIDDEN_CROSS_CASE: hypothèse % appartient au dossier %, pas au dossier %',
      new.assumption_id, v_case, new.case_id using errcode = '23514';
  end if;

  select case_id, fact_key into v_case, v_key from quote_facts where id = new.promoted_fact_id;
  if v_case is not null and v_case <> new.case_id then
    raise exception 'FORBIDDEN_CROSS_CASE: fait promu % appartient au dossier %, pas au dossier %',
      new.promoted_fact_id, v_case, new.case_id using errcode = '23514';
  end if;
  -- Le registre ne peut pas mentir sur la clé réellement écrite.
  if v_key is not null and v_key <> new.fact_key then
    raise exception 'VALIDATION_FAILED: le fait % porte la clé %, pas %',
      new.promoted_fact_id, v_key, new.fact_key using errcode = '23514';
  end if;

  if new.superseded_fact_id is not null then
    select case_id, fact_key into v_case, v_key from quote_facts where id = new.superseded_fact_id;
    if v_case is not null and v_case <> new.case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: fait remplacé % appartient au dossier %, pas au dossier %',
        new.superseded_fact_id, v_case, new.case_id using errcode = '23514';
    end if;
    -- Une promotion remplace le fait courant DE LA MÊME CLÉ, jamais un autre.
    if v_key is not null and v_key <> new.fact_key then
      raise exception 'VALIDATION_FAILED: le fait remplacé % porte la clé %, pas %',
        new.superseded_fact_id, v_key, new.fact_key using errcode = '23514';
    end if;
  end if;

  if new.scenario_id is not null then
    select case_id into v_case from quote_scenarios where id = new.scenario_id;
    if v_case is not null and v_case <> new.case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: scénario % appartient au dossier %, pas au dossier %',
        new.scenario_id, v_case, new.case_id using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'quote_fact_promotions_invariants'
      and tgrelid = 'public.quote_fact_promotions'::regclass
  ) then
    create trigger quote_fact_promotions_invariants
      before insert or update on public.quote_fact_promotions
      for each row execute function public.quote_fact_promotions_enforce_invariants();
  end if;
end $$;

-- =====================================================================
-- 6. RPC ATOMIQUE — seule voie de promotion
--
--    UNE hypothèse par appel. Aucun batch, aucun « promouvoir tout »
--    (arbitrage CTO n°4). Codes d'erreur en préfixe stable, consommés par
--    l'Edge Function.
--
--    Les trois échos (valeur, fait courant, périmètre de scénario) sont des
--    ASSERTIONS D'ÉGALITÉ, jamais des sources d'écriture : ce qui est écrit
--    dans quote_facts vient EXCLUSIVEMENT de la ligne verrouillée du ledger.
-- =====================================================================
create or replace function public.promote_scenario_assumption(
  p_case_id uuid,
  p_assumption_id uuid,
  p_actor_user_id uuid,
  p_idempotency_key text,
  p_request_fingerprint text,
  p_fact_key text,
  p_promotion_basis text,
  p_attested boolean,
  p_expected_assumption_status text,
  p_expected_value_type text,
  p_expected_value jsonb,
  p_expect_no_current_fact boolean,
  p_expected_current_fact_id uuid default null,
  p_scenario_id uuid default null,
  p_expected_scope_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_replay      public.quote_fact_promotions%rowtype;
  v_target      public.quote_scenario_assumptions%rowtype;
  v_scenario    public.quote_scenarios%rowtype;
  v_allow       record;
  v_key         text;
  v_violation   text;
  v_current_id  uuid;
  v_new_fact_id uuid;
  v_superseded  uuid;
  v_value_text  text;
  v_value_num   numeric;
  v_case_exists boolean;
  v_actor_ok    boolean;
  v_live_links  integer;
  v_linked      boolean;
begin
  -- ── 0. Refus explicites et non contournables ────────────────────────
  -- P1-A3 promeut UNE hypothèse. Toute demande de masse, de dé-promotion ou de
  -- pricing est refusée avec un code dédié plutôt que d'être « interprétée ».
  if lower(coalesce(p_promotion_basis, '')) in (
       'auto','auto_promote','promote_all','bulk','batch','cascade','on_confirm'
     ) then
    raise exception 'AUTO_PROMOTION_NOT_ALLOWED: la promotion est unitaire, explicite et attestée ; aucun automatisme ni traitement de masse'
      using errcode = '22023';
  end if;

  if p_attested is not true then
    raise exception 'ATTESTATION_REQUIRED: la promotion exige une attestation explicite de l''opérateur'
      using errcode = '22023';
  end if;

  -- ── 1. Identité et dossier ──────────────────────────────────────────
  if p_case_id is null then
    raise exception 'VALIDATION_FAILED: p_case_id est obligatoire' using errcode = '22023';
  end if;
  if p_assumption_id is null then
    raise exception 'VALIDATION_FAILED: p_assumption_id est obligatoire' using errcode = '22023';
  end if;
  if p_actor_user_id is null then
    raise exception 'VALIDATION_FAILED: p_actor_user_id est obligatoire' using errcode = '22023';
  end if;

  select exists (select 1 from quote_cases where id = p_case_id) into v_case_exists;
  if not v_case_exists then
    raise exception 'NOT_FOUND: dossier % introuvable', p_case_id using errcode = '22023';
  end if;

  -- Identité non forgeable : l'Edge Function ne transmet que auth.user.id ;
  -- cette vérification empêche qu'un appelant service_role fautif fabrique un
  -- auteur de promotion arbitraire.
  select exists (select 1 from auth.users where id = p_actor_user_id) into v_actor_ok;
  if not v_actor_ok then
    raise exception 'FORBIDDEN_IDENTITY: utilisateur % inconnu', p_actor_user_id using errcode = '22023';
  end if;

  -- ── 2. Estampille d'idempotence ─────────────────────────────────────
  v_key := btrim(coalesce(p_idempotency_key, ''));
  if length(v_key) < 8 or length(v_key) > 128 then
    raise exception 'VALIDATION_FAILED: p_idempotency_key doit faire 8 à 128 caractères' using errcode = '22023';
  end if;
  if p_request_fingerprint is null or p_request_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_FAILED: p_request_fingerprint doit être un SHA-256 hexadécimal minuscule' using errcode = '22023';
  end if;

  -- ── 3. Base de promotion : obligatoire et fermée ────────────────────
  if p_promotion_basis is null or p_promotion_basis not in (
       'client_written_confirmation','document_evidence','partner_confirmation',
       'regulatory_reference','operator_expertise') then
    raise exception 'VALIDATION_FAILED: promotion_basis invalide (%). Autorisées: client_written_confirmation, document_evidence, partner_confirmation, regulatory_reference, operator_expertise',
      coalesce(p_promotion_basis, 'null') using errcode = '22023';
  end if;

  -- ── 4. Clé cible : allowlist FERMÉE, non monétaire ──────────────────
  if public.quote_fact_promotion_monetary_token(coalesce(p_fact_key, '')) then
    raise exception 'MONETARY_KEY_NOT_PROMOTABLE: la clé % est monétaire ou tarifaire',
      coalesce(p_fact_key, 'null') using errcode = '22023';
  end if;

  select * into v_allow
    from public.quote_fact_promotion_allowlist() a
   where a.fact_key = p_fact_key;
  if not found then
    raise exception 'FACT_KEY_NOT_PROMOTABLE: la clé % n''est pas promouvable. Les clés monétaires, tarifaires et les classifications à workflow dédié (HS, PAD) en sont exclues.',
      coalesce(p_fact_key, 'null') using errcode = '22023';
  end if;

  -- ── 5. Sérialisation par dossier (concurrence) ──────────────────────
  -- Verrou pris AVANT celui de supersede_fact, toujours dans cet ordre : aucun
  -- cycle possible avec le chemin set-case-fact, qui ne prend que le second.
  perform pg_advisory_xact_lock(hashtext('quote_fact_promotion_' || p_case_id::text));

  -- ── 6. Rejeu idempotent ─────────────────────────────────────────────
  select * into v_replay
    from quote_fact_promotions
   where case_id = p_case_id and idempotency_key = v_key;

  if found then
    if v_replay.request_fingerprint is distinct from p_request_fingerprint then
      raise exception 'IDEMPOTENCY_CONFLICT: la clé % a déjà été utilisée avec un contenu différent', v_key
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'promotion_id',      v_replay.id,
      'assumption_id',     v_replay.assumption_id,
      'promoted_fact_id',  v_replay.promoted_fact_id,
      'superseded_fact_id',v_replay.superseded_fact_id,
      'fact_key',          v_replay.fact_key,
      'promotion_basis',   v_replay.promotion_basis,
      'idempotent_replay', true
    );
  end if;

  -- ── 7. Hypothèse cible : dossier, état, valeur ──────────────────────
  select * into v_target from quote_scenario_assumptions where id = p_assumption_id for update;
  if not found then
    raise exception 'NOT_FOUND: hypothèse % introuvable', p_assumption_id using errcode = '22023';
  end if;
  if v_target.case_id <> p_case_id then
    raise exception 'FORBIDDEN_CROSS_CASE: hypothèse % appartient au dossier %, pas au dossier %',
      p_assumption_id, v_target.case_id, p_case_id using errcode = '23514';
  end if;

  -- Arbitrage CTO n°2 : promotion depuis `active` OU `client_confirmed`
  -- exclusivement. `refuted`, `superseded` et `promoted_to_fact` sont terminaux.
  if v_target.status not in ('active','client_confirmed') then
    if v_target.status = 'promoted_to_fact' then
      raise exception 'CONFLICT_INVALID_STATE: hypothèse % déjà promue (fait %). P1-A3 ne dé-promeut jamais.',
        p_assumption_id, v_target.promoted_fact_id using errcode = '23514';
    end if;
    raise exception 'CONFLICT_INVALID_STATE: seule une hypothèse active ou client_confirmed est promouvable (statut courant: %)',
      v_target.status using errcode = '23514';
  end if;

  -- STALE STATE : l'opérateur a agi sur l'état qu'il a vu, pas sur un autre.
  if p_expected_assumption_status is distinct from v_target.status then
    raise exception 'CONFLICT_STALE_ASSUMPTION: l''hypothèse est en statut % alors que % était affiché ; recharger avant de promouvoir',
      v_target.status, coalesce(p_expected_assumption_status, 'null') using errcode = '23514';
  end if;

  -- STALE VALUE : écho EXACT de la valeur affichée. Comparaison jsonb, donc
  -- sémantique et indépendante de toute canonicalisation côté client.
  -- Ce n'est qu'une ASSERTION : la valeur écrite plus bas est celle du ledger.
  if p_expected_value_type is distinct from v_target.assumed_value_type
     or p_expected_value is null
     or v_target.assumed_value is null
     or p_expected_value <> v_target.assumed_value then
    raise exception 'CONFLICT_STALE_VALUE: la valeur de l''hypothèse a changé depuis l''affichage ; recharger avant de promouvoir'
      using errcode = '23514';
  end if;

  -- ── 8. Couple (clé, type, valeur) promouvable ───────────────────────
  -- La valeur validée est celle du LEDGER, pas l'écho.
  v_violation := public.quote_fact_promotion_violation(
    p_fact_key, v_target.assumed_value_type, v_target.assumed_value);
  if v_violation is not null then
    raise exception 'PROMOTION_REJECTED: valeur non promouvable pour % (%)', p_fact_key, v_violation
      using errcode = '22023';
  end if;

  -- Cohérence de l'intention : P1-A3 ne devine jamais la cible. L'hypothèse
  -- doit nommer le fait anticipé, et la promotion doit viser exactement celui-ci.
  if nullif(btrim(v_target.assumed_fact_key), '') is null then
    raise exception 'ASSUMPTION_HAS_NO_FACT_KEY: l''hypothèse % ne nomme aucun fait cible ; la réviser avant promotion',
      p_assumption_id using errcode = '23514';
  end if;
  if btrim(v_target.assumed_fact_key) <> p_fact_key then
    raise exception 'VALIDATION_FAILED: l''hypothèse anticipe le fait %, pas % ; réviser l''hypothèse plutôt que détourner sa cible',
      v_target.assumed_fact_key, p_fact_key using errcode = '23514';
  end if;

  -- ── 9. Contexte de scénario (stale scenario) ────────────────────────
  -- Une hypothèse liée à un scénario VIVANT ne se promeut pas « hors contexte » :
  -- l'opérateur doit désigner le scénario ET sa révision exacte. Le lien n'est
  -- ni créé, ni modifié, ni supprimé ici — il est seulement LU.
  select count(*) into v_live_links
    from quote_scenario_links l
    join quote_scenarios s on s.id = l.scenario_id
   where l.assumption_id = p_assumption_id
     and l.case_id = p_case_id
     and s.status <> 'superseded';

  if v_live_links > 1 then
    raise exception 'SCENARIO_CONTEXT_AMBIGUOUS: cette hypothèse est liée à % scénarios vivants ; sélectionner un contexte unique avant promotion',
      v_live_links using errcode = '23514';
  end if;

  if p_scenario_id is null then
    if v_live_links > 0 then
      raise exception 'SCENARIO_CONTEXT_REQUIRED: cette hypothèse est liée à % scénario(s) vivant(s) ; désigner le scénario et son empreinte de périmètre',
        v_live_links using errcode = '23514';
    end if;
    if p_expected_scope_hash is not null then
      raise exception 'VALIDATION_FAILED: expected_scope_hash sans scenario_id' using errcode = '22023';
    end if;
  else
    select * into v_scenario from quote_scenarios where id = p_scenario_id;
    if not found then
      raise exception 'NOT_FOUND: scénario % introuvable', p_scenario_id using errcode = '22023';
    end if;
    if v_scenario.case_id <> p_case_id then
      raise exception 'FORBIDDEN_CROSS_CASE: scénario % appartient au dossier %, pas au dossier %',
        p_scenario_id, v_scenario.case_id, p_case_id using errcode = '23514';
    end if;
    if v_scenario.status = 'superseded' then
      raise exception 'CONFLICT_STALE_SCENARIO: le scénario % est supersédé par % ; recharger avant de promouvoir',
        p_scenario_id, v_scenario.superseded_by_scenario_id using errcode = '23514';
    end if;
    if p_expected_scope_hash is distinct from v_scenario.scope_hash then
      raise exception 'CONFLICT_STALE_SCENARIO: le périmètre du scénario a changé depuis l''affichage ; recharger avant de promouvoir'
        using errcode = '23514';
    end if;
    select exists (
      select 1 from quote_scenario_links
       where scenario_id = p_scenario_id and assumption_id = p_assumption_id
    ) into v_linked;
    if not v_linked then
      raise exception 'VALIDATION_FAILED: l''hypothèse % n''est pas liée au scénario %',
        p_assumption_id, p_scenario_id using errcode = '23514';
    end if;
  end if;

  -- ── 10. Fait courant (stale fact) ───────────────────────────────────
  -- L'opérateur atteste EXPLICITEMENT ce qu'il remplace : soit un fait courant
  -- précis, soit l'absence de fait. Les deux formes s'excluent, pour qu'une
  -- omission ne puisse pas se lire comme « je n'ai rien vu ».
  if (p_expect_no_current_fact is true) = (p_expected_current_fact_id is not null) then
    raise exception 'VALIDATION_FAILED: déclarer EXACTEMENT soit expect_no_current_fact=true, soit expected_current_fact_id'
      using errcode = '22023';
  end if;

  -- ORDRE DE VERROUILLAGE, impératif. `supersede_fact` prend
  -- pg_advisory_xact_lock(hashtext(case_id || fact_key)) PUIS verrouille la
  -- ligne courante de quote_facts. On prend donc ce MÊME verrou AVANT notre
  -- propre SELECT ... FOR UPDATE : sans cela, une promotion (ligne puis verrou)
  -- et un set-case-fact concurrent (verrou puis ligne) s'interbloqueraient.
  -- Les verrous consultatifs sont réentrants : la reprise par supersede_fact
  -- est un no-op.
  perform pg_advisory_xact_lock(hashtext(p_case_id::text || p_fact_key));

  select id into v_current_id
    from quote_facts
   where case_id = p_case_id and fact_key = p_fact_key and is_current = true
   for update;

  if p_expect_no_current_fact is true then
    if v_current_id is not null then
      raise exception 'CONFLICT_STALE_FACT: un fait courant % existe déjà pour % ; recharger avant de promouvoir',
        v_current_id, p_fact_key using errcode = '23514';
    end if;
  elsif v_current_id is distinct from p_expected_current_fact_id then
    raise exception 'CONFLICT_STALE_FACT: le fait courant de % a changé depuis l''affichage (attendu %, courant %) ; recharger avant de promouvoir',
      p_fact_key, p_expected_current_fact_id, coalesce(v_current_id::text, 'aucun') using errcode = '23514';
  end if;

  -- ── 11. Écriture du fait — valeur LUE DU LEDGER ─────────────────────
  if v_allow.value_type = 'text' then
    v_value_text := btrim(v_target.assumed_value #>> '{}');
    v_value_num  := null;
  else
    v_value_text := null;
    v_value_num  := (v_target.assumed_value #>> '{}')::numeric;
  end if;

  -- supersede_fact est appelée TELLE QUELLE (aucune modification de son code) :
  -- elle désactive le fait courant et insère le successeur atomiquement, dans
  -- CETTE transaction. source_type='manual_input' fait hériter le fait de la
  -- protection existante de build-case-puzzle ; confidence=1.0 est fixée
  -- côté serveur et n'est jamais fournie par l'appelant.
  select public.supersede_fact(
    p_case_id       := p_case_id,
    p_fact_key      := p_fact_key,
    p_fact_category := v_allow.fact_category,
    p_value_text    := v_value_text,
    p_value_number  := v_value_num,
    p_source_type   := 'manual_input',
    p_source_excerpt := '[promote-scenario-assumption] Hypothese ' || p_assumption_id::text
                        || ' promue explicitement (base: ' || p_promotion_basis || ')',
    p_confidence    := 1.0
  ) into v_new_fact_id;

  if v_new_fact_id is null then
    raise exception 'UPSTREAM_DB_ERROR: supersede_fact n''a produit aucun fait' using errcode = 'XX000';
  end if;

  select supersedes_fact_id into v_superseded from quote_facts where id = v_new_fact_id;

  -- ── 12. Transition terminale de l'hypothèse ─────────────────────────
  -- promoted_fact_id + resolved_* sont exigés ensemble par les CHECK de
  -- 20260624120000 et 20260828120000. Le trigger same_case revalide que le fait
  -- désigné appartient bien à ce dossier.
  update quote_scenario_assumptions
     set status = 'promoted_to_fact',
         promoted_fact_id = v_new_fact_id,
         resolved_at = now(),
         resolved_by = p_actor_user_id
   where id = v_target.id;

  -- ── 13. Registre append-only (même transaction) ─────────────────────
  insert into quote_fact_promotions (
    case_id, assumption_id, promoted_fact_id, superseded_fact_id,
    fact_key, fact_category, value_type, promoted_value,
    assumption_status_before, promotion_basis, attested,
    scenario_id, scenario_scope_hash,
    idempotency_key, request_fingerprint, actor_user_id
  ) values (
    p_case_id, v_target.id, v_new_fact_id, v_superseded,
    p_fact_key, v_allow.fact_category, v_allow.value_type, v_target.assumed_value,
    v_target.status, p_promotion_basis, true,
    p_scenario_id, case when p_scenario_id is null then null else v_scenario.scope_hash end,
    v_key, p_request_fingerprint, p_actor_user_id
  )
  returning * into v_replay;

  -- ── 14. Journalisation transactionnelle ─────────────────────────────
  -- `fact_injected_manual` est DÉJÀ autorisé par le CHECK courant de
  -- case_timeline_events (20260325163446) et déjà écrit par set-case-fact :
  -- aucune extension d'enum partagé n'est nécessaire (arbitrage CTO n°8).
  insert into case_timeline_events (
    case_id, event_type, actor_type, actor_user_id, related_fact_id, event_data
  ) values (
    p_case_id, 'fact_injected_manual', 'operator', p_actor_user_id, v_new_fact_id,
    jsonb_build_object(
      'source',                   'promote-scenario-assumption',
      'promotion_id',             v_replay.id,
      'assumption_id',            v_target.id,
      'assumption_status_before', v_target.status,
      'fact_key',                 p_fact_key,
      'fact_category',            v_allow.fact_category,
      'value_type',               v_allow.value_type,
      'promoted_fact_id',         v_new_fact_id,
      'superseded_fact_id',       v_superseded,
      'promotion_basis',          p_promotion_basis,
      'attested',                 true,
      'scenario_id',              p_scenario_id,
      'idempotency_key',          v_key,
      'request_fingerprint',      p_request_fingerprint,
      'priced',                   false,
      'gap_written',              false
    )
  );

  return jsonb_build_object(
    'promotion_id',       v_replay.id,
    'assumption_id',      v_target.id,
    'promoted_fact_id',   v_new_fact_id,
    'superseded_fact_id', v_superseded,
    'fact_key',           p_fact_key,
    'fact_category',      v_allow.fact_category,
    'promotion_basis',    p_promotion_basis,
    'idempotent_replay',  false
  );
end;
$$;

-- =====================================================================
-- 7. PRIVILÈGES MINIMAUX
--    Aucun GRANT existant n'est touché : seuls les objets créés ici sont
--    verrouillés.
-- =====================================================================

-- Registre : strictement interne, aucune surface Data API (arbitrage CTO n°7).
revoke all on table public.quote_fact_promotions from public;
revoke all on table public.quote_fact_promotions from anon;
revoke all on table public.quote_fact_promotions from authenticated;
revoke all on table public.quote_fact_promotions from service_role;

-- RPC : service_role exclusivement.
revoke all on function public.promote_scenario_assumption(uuid, uuid, uuid, text, text, text, text, boolean, text, text, jsonb, boolean, uuid, uuid, text) from public;
revoke all on function public.promote_scenario_assumption(uuid, uuid, uuid, text, text, text, text, boolean, text, text, jsonb, boolean, uuid, uuid, text) from anon;
revoke all on function public.promote_scenario_assumption(uuid, uuid, uuid, text, text, text, text, boolean, text, text, jsonb, boolean, uuid, uuid, text) from authenticated;
grant execute on function public.promote_scenario_assumption(uuid, uuid, uuid, text, text, text, text, boolean, text, text, jsonb, boolean, uuid, uuid, text) to service_role;

-- Trigger de garde : jamais appelable directement.
revoke all on function public.quote_fact_promotions_enforce_invariants() from public;
revoke all on function public.quote_fact_promotions_enforce_invariants() from anon;
revoke all on function public.quote_fact_promotions_enforce_invariants() from authenticated;

-- Allowlist et validateurs : évalués par des CHECK sous l'identité du
-- propriétaire. Ils décrivent la règle, ils ne sont pas une API.
revoke all on function public.quote_fact_promotion_allowlist() from public;
revoke all on function public.quote_fact_promotion_allowlist() from anon;
revoke all on function public.quote_fact_promotion_allowlist() from authenticated;
revoke all on function public.quote_fact_promotion_violation(text, text, jsonb) from public;
revoke all on function public.quote_fact_promotion_violation(text, text, jsonb) from anon;
revoke all on function public.quote_fact_promotion_violation(text, text, jsonb) from authenticated;
revoke all on function public.quote_fact_promotion_monetary_token(text) from public;
revoke all on function public.quote_fact_promotion_monetary_token(text) from anon;
revoke all on function public.quote_fact_promotion_monetary_token(text) from authenticated;

-- =====================================================================
-- 8. Documentation catalogue
-- =====================================================================
comment on table public.quote_fact_promotions is
  'P1-A3. Registre APPEND-ONLY des promotions explicites hypothese -> quote_facts. Une ligne par promotion, une promotion par hypothese, un fait par promotion. service_role only, RLS activee sans policy, aucun GRANT ni UPDATE applicatif. Le DELETE direct est inaccessible ; le cascade quote_cases reste possible pour la retention et les nettoyages sandbox. Aucune de-promotion en P1-A3.';
comment on column public.quote_fact_promotions.promoted_value is
  'Copie EXACTE de la valeur ecrite, lue du ledger quote_scenario_assumptions. Un CHECK impose que le couple (fact_key, value_type, promoted_value) soit dans l allowlist FERMEE et non monetaire : aucune promotion hors allowlist ne peut commiter.';
comment on column public.quote_fact_promotions.promotion_basis is
  'Base de promotion OBLIGATOIRE et FERMEE : client_written_confirmation | document_evidence | partner_confirmation | regulatory_reference | operator_expertise.';
comment on column public.quote_fact_promotions.attested is
  'Attestation explicite de l operateur. Contrainte CHECK (attested) : false n est pas representable.';
comment on function public.quote_fact_promotion_allowlist() is
  'P1-A3. Allowlist FERMEE des clés promouvables. Sous-ensemble strict de set-case-fact, ampute de toute clé monetaire/tarifaire (arbitrage CTO n1), des clés a montants imbriques (articles_detail, containers, service.overrides), des classifications a workflow dedie (cargo.hs_code, cargo.pad_category) et de regulatory.exemption_title. Types bornes a text et number : aucun json ne peut entrer dans quote_facts par cette voie.';
comment on function public.quote_fact_promotion_violation(text, text, jsonb) is
  'P1-A3. Miroir SQL de promotionViolation (domain.ts). Renvoie NULL si le couple est promouvable, sinon un motif stable. Fonction TOTALE : ne leve jamais, car evaluee par un CHECK dont l ordre n est pas specifie.';
comment on function public.promote_scenario_assumption(uuid, uuid, uuid, text, text, text, text, boolean, text, text, jsonb, boolean, uuid, uuid, text) is
  'P1-A3. Seule voie de promotion d une hypothese vers quote_facts. service_role only. UNE hypothese par appel, jamais automatique : attestation, base de promotion fermee, echo du statut, de la valeur, du fait courant remplace et du perimetre de scenario. La valeur ecrite est LUE DU LEDGER, jamais du payload. Ecrit un fait via supersede_fact (source_type=manual_input, confidence=1.0), la transition terminale de l hypothese, le registre et la timeline dans la MEME transaction. N ecrit jamais dans quote_gaps, client_gap_requests, quote_scenarios, quote_request_lines, quotation_versions ni aucune donnee tarifaire. Aucune de-promotion.';

-- =====================================================================
-- 9. ASSERTIONS D'INTÉGRITÉ — exécutables telles quelles, HORS migration
--
--     Ces assertions ne sont pas jouées par la migration : elles la VÉRIFIENT.
--     Le bloc A est pur ; le bloc B écrit puis ROLLBACK, et ne laisse rien.
--
--     Exécution (base locale) :
--       docker exec -i supabase_db_<ref> psql -U postgres -d postgres \
--         -v ON_ERROR_STOP=1 -f - < ce_bloc.sql
--     Un ASSERT en échec fait échouer la commande : le silence vaut succès.
--
--     Retirer les deux lignes de délimitation de commentaire ci-dessous.
-- =====================================================================
/*
-- ── A. Allowlist et validateur (aucune écriture) ──────────────────────
do $$
begin
  -- A1. Aucune clé monétaire ou tarifaire n'est promouvable.
  assert not exists (
    select 1 from public.quote_fact_promotion_allowlist() a
     where public.quote_fact_promotion_monetary_token(a.fact_key)),
    'A1 : une clé monétaire figure dans l allowlist';
  assert public.quote_fact_promotion_violation('cargo.value', 'number', '1000'::jsonb)
       = 'fact_key_not_promotable:cargo.value', 'A1 : cargo.value promouvable';
  assert public.quote_fact_promotion_violation('cargo.caf_value', 'number', '1000'::jsonb)
       = 'fact_key_not_promotable:cargo.caf_value', 'A1 : cargo.caf_value promouvable';
  assert public.quote_fact_promotion_violation('cargo.freight_cost', 'number', '1000'::jsonb)
       = 'fact_key_not_promotable:cargo.freight_cost', 'A1 : cargo.freight_cost promouvable';
  assert public.quote_fact_promotion_violation('cargo.pad_rate_fcfa_per_ton', 'number', '1000'::jsonb)
       = 'fact_key_not_promotable:cargo.pad_rate_fcfa_per_ton', 'A1 : tarif PAD promouvable';
  -- Workflows de classification dédiés : non promouvables ici.
  assert public.quote_fact_promotion_violation('cargo.hs_code', 'text', '"8702.90"'::jsonb)
       = 'fact_key_not_promotable:cargo.hs_code', 'A1 : HS promouvable hors workflow dédié';
  assert public.quote_fact_promotion_violation('cargo.pad_category', 'text', '"C400"'::jsonb)
       = 'fact_key_not_promotable:cargo.pad_category', 'A1 : PAD promouvable hors workflow dédié';
  -- Montants imbriqués : le json n'est pas un type promouvable.
  assert public.quote_fact_promotion_violation('cargo.articles_detail', 'json', '[]'::jsonb)
       = 'fact_key_not_promotable:cargo.articles_detail', 'A1 : articles_detail promouvable';

  -- A2. Le token monétaire est EXACT, jamais une sous-chaîne.
  assert not public.quote_fact_promotion_monetary_token('cargo.chargeable_weight_kg'),
    'A2 : chargeable pris pour charge';
  assert not public.quote_fact_promotion_monetary_token('cargo.container_count'),
    'A2 : container_count pris pour un montant';
  assert public.quote_fact_promotion_monetary_token('cargo.caf_value'), 'A2 : caf_value non détecté';
  assert public.quote_fact_promotion_monetary_token('cargo.freight_exchange_rate'),
    'A2 : freight_exchange_rate non détecté';

  -- A3. Couples valides, types, bornes et vocabulaires.
  assert public.quote_fact_promotion_violation('cargo.weight_kg', 'number', '12000'::jsonb) is null,
    'A3 : poids valide refusé';
  assert public.quote_fact_promotion_violation('cargo.weight_kg', 'text', '"12000"'::jsonb)
       = 'value_type_mismatch:cargo.weight_kg:attendu=number:fourni=text', 'A3 : type non contrôlé';
  assert public.quote_fact_promotion_violation('cargo.container_count', 'number', '2.5'::jsonb)
       = 'non_integer_value:cargo.container_count', 'A3 : compte fractionnaire accepté';
  assert public.quote_fact_promotion_violation('cargo.weight_kg', 'number', '-1'::jsonb)
       = 'value_out_of_range:cargo.weight_kg:-1', 'A3 : poids négatif accepté';
  assert public.quote_fact_promotion_violation('routing.terminal_operation_mode', 'text', '"LOLO"'::jsonb) is null,
    'A3 : mode terminal canonique refusé';
  assert public.quote_fact_promotion_violation('routing.terminal_operation_mode', 'text', '"RO-RO"'::jsonb)
       = 'value_not_allowed:routing.terminal_operation_mode:RO-RO', 'A3 : mode terminal hors vocabulaire accepté';
  assert public.quote_fact_promotion_violation('cargo.description', 'text', '"  "'::jsonb)
       = 'empty_value:cargo.description', 'A3 : description vide acceptée';

  raise notice 'A : allowlist et validateur — OK';
end $$;

-- ── B. Voies d'écriture (tout est annulé par le ROLLBACK final) ───────
begin;
do $$
declare
  v_case  uuid;
  v_actor uuid;
  v_assum uuid;
  v_res   jsonb;
  v_row   public.quote_scenario_assumptions%rowtype;
begin
  select id into v_case from public.quote_cases limit 1;
  select id into v_actor from auth.users limit 1;
  if v_case is null or v_actor is null then
    raise notice 'B : ignore (aucun dossier ou aucun utilisateur local)';
    return;
  end if;

  insert into public.quote_scenario_assumptions (
    case_id, scope_key, status, assumption_type, assumed_fact_key, statement,
    assumed_value_type, assumed_value, created_by)
  values (v_case, 'case', 'active', 'weight', 'cargo.weight_kg',
    'Assertion P1-A3', 'number', '12000'::jsonb, v_actor)
  returning id into v_assum;

  -- B1. Attestation absente : refus.
  begin
    perform public.promote_scenario_assumption(
      p_case_id => v_case, p_assumption_id => v_assum, p_actor_user_id => v_actor,
      p_idempotency_key => 'assert-no-attest-1', p_request_fingerprint => repeat('a', 64),
      p_fact_key => 'cargo.weight_kg', p_promotion_basis => 'operator_expertise',
      p_attested => false, p_expected_assumption_status => 'active',
      p_expected_value_type => 'number', p_expected_value => '12000'::jsonb,
      p_expect_no_current_fact => true);
    raise exception 'B1 ECHEC : promotion sans attestation acceptée';
  exception when others then
    if sqlerrm not like 'ATTESTATION_REQUIRED%' then raise; end if;
  end;

  -- B2. Clé monétaire : refus, même en service_role direct.
  begin
    perform public.promote_scenario_assumption(
      p_case_id => v_case, p_assumption_id => v_assum, p_actor_user_id => v_actor,
      p_idempotency_key => 'assert-monetary-1', p_request_fingerprint => repeat('b', 64),
      p_fact_key => 'cargo.value', p_promotion_basis => 'operator_expertise',
      p_attested => true, p_expected_assumption_status => 'active',
      p_expected_value_type => 'number', p_expected_value => '12000'::jsonb,
      p_expect_no_current_fact => true);
    raise exception 'B2 ECHEC : promotion vers une clé monétaire acceptée';
  exception when others then
    if sqlerrm not like 'MONETARY_KEY_NOT_PROMOTABLE%' then raise; end if;
  end;

  -- B3. Valeur périmée : refus.
  begin
    perform public.promote_scenario_assumption(
      p_case_id => v_case, p_assumption_id => v_assum, p_actor_user_id => v_actor,
      p_idempotency_key => 'assert-stale-val-1', p_request_fingerprint => repeat('c', 64),
      p_fact_key => 'cargo.weight_kg', p_promotion_basis => 'operator_expertise',
      p_attested => true, p_expected_assumption_status => 'active',
      p_expected_value_type => 'number', p_expected_value => '9999'::jsonb,
      p_expect_no_current_fact => true);
    raise exception 'B3 ECHEC : valeur périmée acceptée';
  exception when others then
    if sqlerrm not like 'CONFLICT_STALE_VALUE%' then raise; end if;
  end;

  -- B4. Promotion nominale : fait écrit, hypothèse terminale, registre peuplé.
  v_res := public.promote_scenario_assumption(
    p_case_id => v_case, p_assumption_id => v_assum, p_actor_user_id => v_actor,
    p_idempotency_key => 'assert-promote-ok1', p_request_fingerprint => repeat('d', 64),
    p_fact_key => 'cargo.weight_kg', p_promotion_basis => 'document_evidence',
    p_attested => true, p_expected_assumption_status => 'active',
    p_expected_value_type => 'number', p_expected_value => '12000'::jsonb,
    p_expect_no_current_fact => not exists (
      select 1 from public.quote_facts
       where case_id = v_case and fact_key = 'cargo.weight_kg' and is_current),
    p_expected_current_fact_id => (
      select id from public.quote_facts
       where case_id = v_case and fact_key = 'cargo.weight_kg' and is_current));

  assert (v_res ->> 'idempotent_replay') = 'false', 'B4 : rejeu inattendu';
  assert exists (
    select 1 from public.quote_facts
     where id = (v_res ->> 'promoted_fact_id')::uuid
       and source_type = 'manual_input' and confidence = 1.0
       and value_number = 12000 and is_current), 'B4 : fait promu non conforme';
  select * into v_row from public.quote_scenario_assumptions where id = v_assum;
  assert v_row.status = 'promoted_to_fact', 'B4 : hypothèse non terminale';
  assert v_row.promoted_fact_id = (v_res ->> 'promoted_fact_id')::uuid, 'B4 : lien fait manquant';
  assert exists (select 1 from public.quote_fact_promotions
                  where assumption_id = v_assum), 'B4 : registre non peuplé';

  -- B5. Rejeu strict de la même requête : aucun second fait.
  v_res := public.promote_scenario_assumption(
    p_case_id => v_case, p_assumption_id => v_assum, p_actor_user_id => v_actor,
    p_idempotency_key => 'assert-promote-ok1', p_request_fingerprint => repeat('d', 64),
    p_fact_key => 'cargo.weight_kg', p_promotion_basis => 'document_evidence',
    p_attested => true, p_expected_assumption_status => 'active',
    p_expected_value_type => 'number', p_expected_value => '12000'::jsonb,
    p_expect_no_current_fact => true);
  assert (v_res ->> 'idempotent_replay') = 'true', 'B5 : rejeu non reconnu';
  assert (select count(*) from public.quote_fact_promotions where assumption_id = v_assum) = 1,
    'B5 : le rejeu a créé une seconde promotion';

  -- B6. Aucune dé-promotion : UPDATE refusé et aucune permission de mutation
  -- directe pour les rôles applicatifs. Le DELETE propriétaire reste possible
  -- uniquement pour permettre le cascade de rétention/nettoyage du dossier.
  begin
    update public.quote_fact_promotions set promotion_basis = 'operator_expertise'
     where assumption_id = v_assum;
    raise exception 'B6 ECHEC : le registre de promotion a été modifié';
  exception when others then
    if sqlerrm not like 'CONFLICT_INVALID_STATE%' then raise; end if;
  end;
  assert not has_table_privilege('anon', 'public.quote_fact_promotions', 'INSERT,UPDATE,DELETE'),
    'B6 : anon peut muter le registre';
  assert not has_table_privilege('authenticated', 'public.quote_fact_promotions', 'INSERT,UPDATE,DELETE'),
    'B6 : authenticated peut muter le registre';
  assert not has_table_privilege('service_role', 'public.quote_fact_promotions', 'INSERT,UPDATE,DELETE'),
    'B6 : service_role peut muter directement le registre';

  raise notice 'B : voies d ecriture — OK';
end $$;
rollback;
*/
