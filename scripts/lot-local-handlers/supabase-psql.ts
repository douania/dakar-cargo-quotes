// LOCAL TEST DOUBLE of `jsr:@supabase/supabase-js@2` (MULTI-LOT-TERMINAL-1 harness only).
// Each PostgREST-style call is translated to one SQL statement executed with psql inside the
// offline Docker PostgreSQL named by DCQ_LOCAL_CONTAINER / DCQ_LOCAL_DB (autocommit, like
// PostgREST). Service clients run as the table owner (RLS bypassed, like the service role);
// clients created with the synthetic operator JWT run as `authenticated` with JWT claims.
// Authentication accepts only that token. Unsupported builder features throw loudly.
const CONTAINER = Deno.env.get("DCQ_LOCAL_CONTAINER") ?? "";
const DATABASE = Deno.env.get("DCQ_LOCAL_DB") ?? "";
if (!/^dcq-[a-z0-9-]+$/.test(CONTAINER) || !/^mlt1_[a-z0-9_]+$/.test(DATABASE)) throw new Error("Local harness only: DCQ_LOCAL_CONTAINER / DCQ_LOCAL_DB");
export const SYNTHETIC_TOKEN = "synthetic-operator-token";
export const SYNTHETIC_ACTOR = Deno.env.get("DCQ_LOCAL_ACTOR") ?? "00000000-0000-4000-8000-0000000a0001";
/** RPC names forced to fail (persistence-failure scenarios). */
export const failingRpcs = new Set<string>();
export const stats = { statements: 0 };

type PgError = { message: string; code: string; details?: string };
/** Caller clients (created with the synthetic operator JWT) run as `authenticated` with JWT claims, so RLS
 * and auth.uid() behave as through PostgREST; service clients run as the table owner (service role). */
export async function runSql(text: string, asUser = false): Promise<{ out: string; error: PgError | null }> {
  stats.statements++;
  const child = new Deno.Command("docker", {
    args: ["exec", "-i", CONTAINER, "psql", "-X", "-qAt", "-U", "postgres", "-d", DATABASE, "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"],
    stdin: "piped", stdout: "piped", stderr: "piped", env: { MSYS_NO_PATHCONV: "1" },
  }).spawn();
  const w = child.stdin.getWriter();
  const who = asUser
    ? `select set_config('request.jwt.claims', ${quote(JSON.stringify({ sub: SYNTHETIC_ACTOR, role: "authenticated" }))}, false);\nset role authenticated;\n` : "";
  await w.write(new TextEncoder().encode(`set search_path = public, extensions;\n${who}${text}\n`));
  await w.close();
  const out = await child.output();
  if (out.success) return { out: new TextDecoder().decode(out.stdout).trim(), error: null };
  const err = new TextDecoder().decode(out.stderr);
  const m = err.match(/ERROR:\s+([0-9A-Z]{5}):\s+([^\n]*)/);
  return { out: "", error: { message: m?.[2]?.trim() ?? err.trim().slice(0, 300), code: m?.[1] ?? "XX000" } };
}

const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
function lit(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "string") return quote(v);
  return quote(JSON.stringify(v));
}
function ident(s: string): string {
  const t = s.trim();
  if (!/^[a-z_][a-z0-9_]*$/.test(t)) throw new Error(`HARNESS_UNSUPPORTED identifier: ${s}`);
  return `"${t}"`;
}
function splitTop(s: string): string[] {
  const parts: string[] = []; let depth = 0; let cur = "";
  for (const ch of s) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
const fkCache = new Map<string, { kind: "one" | "many"; local: string; remote: string } | null>();
async function relation(table: string, rel: string) {
  const key = `${table}->${rel}`;
  if (!fkCache.has(key)) {
    const r = await runSql(`select c.conrelid::regclass::text, a.attname, c.confrelid::regclass::text, af.attname from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = c.confkey[1]
      where c.contype = 'f' and array_length(c.conkey, 1) = 1 and (
        (c.conrelid = ${lit(`public.${table}`)}::regclass and c.confrelid = ${lit(`public.${rel}`)}::regclass) or
        (c.conrelid = ${lit(`public.${rel}`)}::regclass and c.confrelid = ${lit(`public.${table}`)}::regclass));`);
    const rows = r.error || !r.out ? [] : r.out.split("\n").map(l => l.split("|"));
    if (rows.length !== 1) fkCache.set(key, null);
    else {
      const [from, fromCol, , toCol] = rows[0];
      fkCache.set(key, from.replace(/^public\./, "") === table ? { kind: "one", local: fromCol, remote: toCol } : { kind: "many", local: toCol, remote: fromCol });
    }
  }
  const found = fkCache.get(key);
  if (!found) throw new Error(`HARNESS_UNSUPPORTED embedding ${table} -> ${rel}`);
  return found;
}
async function columns(cols: string, table: string): Promise<string> {
  const t = cols.replace(/\s+/g, " ").trim();
  if (t === "" || t === "*") return "tgt.*";
  const out: string[] = [];
  for (const item of splitTop(t)) {
    const m = item.match(/^(?:([a-z_][a-z0-9_]*):)?([a-z_][a-z0-9_]*)(?:!inner)?\((.*)\)$/);
    if (!m) { out.push(item === "*" ? "tgt.*" : `tgt.${ident(item)}`); continue; }
    const [, alias, rel, inner] = m;
    if (inner.includes("(")) throw new Error(`HARNESS_UNSUPPORTED nested embedding: ${item}`);
    const r = await relation(table, rel);
    const innerCols = inner.trim() === "*" || inner.trim() === "" ? "e.*" : inner.split(",").map(c => `e.${ident(c)}`).join(", ");
    const src = `(select ${innerCols} from public.${ident(rel)} e where e.${ident(r.remote)} = tgt.${ident(r.local)})`;
    out.push(r.kind === "one"
      ? `(select row_to_json(x) from ${src} x limit 1) as ${ident(alias ?? rel)}`
      : `(select coalesce(json_agg(row_to_json(x)), '[]') from ${src} x) as ${ident(alias ?? rel)}`);
  }
  return out.join(", ");
}
function listValues(v: unknown): string {
  const arr = Array.isArray(v) ? v : String(v).replace(/^\(|\)$/g, "").split(",").map(x => x.trim().replace(/^"|"$/g, ""));
  return arr.length ? `(${arr.map(lit).join(", ")})` : "(NULL)";
}
const OPS: Record<string, string> = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=", like: "like", ilike: "ilike" };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- local double: PostgREST payloads are untyped, as in supabase-js
type Result = { data: any; error: PgError | null; count?: number | null; status: number };
class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "update" | "delete" | "upsert" | null = null;
  private cols = "*"; private countExact = false; private head = false;
  private filters: string[] = []; private orders: string[] = []; private lim: number | null = null;
  private values: unknown = null; private returning: string | null = null; private mode: "many" | "single" | "maybe" = "many";
  private onConflict: string | null = null;
  constructor(private table: string, private asUser = false) { ident(table); }
  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    if (this.op === null || this.op === "select") { this.op = "select"; this.cols = cols; this.countExact = opts?.count === "exact"; this.head = !!opts?.head; }
    else this.returning = cols;
    return this;
  }
  insert(v: unknown) { this.op = "insert"; this.values = v; return this; }
  upsert(v: unknown, opts?: { onConflict?: string }) { this.op = "upsert"; this.values = v; this.onConflict = opts?.onConflict ?? null; return this; }
  update(v: unknown) { this.op = "update"; this.values = v; return this; }
  delete() { this.op = "delete"; return this; }
  private where(c: string, sql: string) { this.filters.push(`tgt.${ident(c)} ${sql}`); return this; }
  eq(c: string, v: unknown) { return v === null ? this.where(c, "is null") : this.where(c, `= ${lit(v)}`); }
  neq(c: string, v: unknown) { return this.where(c, `is distinct from ${lit(v)}`); }
  gt(c: string, v: unknown) { return this.where(c, `> ${lit(v)}`); }
  gte(c: string, v: unknown) { return this.where(c, `>= ${lit(v)}`); }
  lt(c: string, v: unknown) { return this.where(c, `< ${lit(v)}`); }
  lte(c: string, v: unknown) { return this.where(c, `<= ${lit(v)}`); }
  like(c: string, v: string) { return this.where(c, `like ${lit(v)}`); }
  ilike(c: string, v: string) { return this.where(c, `ilike ${lit(v)}`); }
  is(c: string, v: unknown) { return this.where(c, v === null ? "is null" : v === true ? "is true" : "is false"); }
  in(c: string, v: unknown[]) { return this.where(c, `in ${listValues(v)}`); }
  not(c: string, op: string, v: unknown) {
    if (op === "is") return this.where(c, v === null ? "is not null" : `is not ${v ? "true" : "false"}`);
    if (op === "in") return this.where(c, `not in ${listValues(v)}`);
    if (op === "eq") return this.where(c, `is distinct from ${lit(v)}`);
    if (OPS[op]) { this.filters.push(`not (tgt.${ident(c)} ${OPS[op]} ${lit(v)})`); return this; }
    throw new Error(`HARNESS_UNSUPPORTED not(${op})`);
  }
  filter(c: string, op: string, v: unknown) {
    if (op === "in") return this.in(c, listValues(v).slice(1, -1).split(", "));
    if (op === "is") return this.is(c, v === "null" ? null : v);
    if (!OPS[op]) throw new Error(`HARNESS_UNSUPPORTED filter(${op})`);
    return this.where(c, `${OPS[op]} ${lit(v)}`);
  }
  match(obj: Record<string, unknown>) { for (const [k, v] of Object.entries(obj)) this.eq(k, v); return this; }
  /** PostgREST `or=(col.op.value,...)` subset: eq/neq/gt/gte/lt/lte/like/ilike/is/cs/in. */
  or(expr: string) {
    const terms = splitTop(expr).map(term => {
      const m = term.match(/^([a-z_][a-z0-9_]*)\.(eq|neq|gt|gte|lt|lte|like|ilike|is|cs|in)\.(.*)$/);
      if (!m) throw new Error(`HARNESS_UNSUPPORTED or term: ${term}`);
      const [, col, op, raw] = m;
      const c = `tgt.${ident(col)}`;
      if (op === "is") return `${c} is ${raw === "null" ? "null" : raw === "true" ? "true" : "false"}`;
      if (op === "cs") return `${c} @> ${lit(raw)}`;
      if (op === "in") return `${c} in ${listValues(raw)}`;
      const value = op === "like" || op === "ilike" ? raw.replaceAll("*", "%") : raw;
      return `${c} ${OPS[op]} ${lit(value)}`;
    });
    this.filters.push(`(${terms.join(" or ")})`);
    return this;
  }
  order(c: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.orders.push(`tgt.${ident(c)} ${opts?.ascending === false ? "desc" : "asc"}${opts?.nullsFirst === undefined ? "" : opts.nullsFirst ? " nulls first" : " nulls last"}`);
    return this;
  }
  limit(n: number) { this.lim = n; return this; }
  range(from: number, to: number) { this.lim = to - from + 1; if (from) throw new Error("HARNESS_UNSUPPORTED range offset"); return this; }
  single() { this.mode = "single"; return this; }
  maybeSingle() { this.mode = "maybe"; return this; }
  abortSignal() { return this; }
  then<A = Result, B = never>(ok?: ((r: Result) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return this.exec().then(ok, ko);
  }
  private tail() {
    return `${this.filters.length ? " where " + this.filters.join(" and ") : ""}${this.orders.length ? " order by " + this.orders.join(", ") : ""}${this.lim !== null ? " limit " + this.lim : ""}`;
  }
  private async exec(): Promise<Result> {
    const t = `public.${ident(this.table)}`;
    let rowsSql: string; let countSql: string | null = null;
    if (this.op === "select") {
      if (this.countExact || this.head) countSql = `select count(*) from ${t} tgt${this.filters.length ? " where " + this.filters.join(" and ") : ""};`;
      rowsSql = `select coalesce(json_agg(row_to_json(x)), '[]')::text from (select ${await columns(this.cols, this.table)} from ${t} tgt${this.tail()}) x;`;
    } else if (this.op === "insert" || this.op === "upsert") {
      const arr = (Array.isArray(this.values) ? this.values : [this.values]) as Record<string, unknown>[];
      const keys = [...new Set(arr.flatMap(r => Object.keys(r).filter(k => r[k] !== undefined)))];
      const cols = keys.map(ident).join(", ");
      const conflict = this.op === "upsert"
        ? ` on conflict (${(this.onConflict ?? "id").split(",").map(ident).join(", ")}) do update set ${keys.map(k => `${ident(k)} = excluded.${ident(k)}`).join(", ")}` : "";
      rowsSql = `with w as (insert into ${t} (${cols}) select ${cols} from jsonb_populate_recordset(null::${t}, ${lit(arr)}::jsonb)${conflict} returning *)
        select coalesce(json_agg(row_to_json(tgt)), '[]')::text from (select ${await columns(this.returning ?? "*", this.table)} from w tgt) tgt;`;
    } else if (this.op === "update") {
      const keys = Object.keys(this.values as object).filter(k => (this.values as Record<string, unknown>)[k] !== undefined);
      rowsSql = `with w as (update ${t} tgt set ${keys.map(k => `${ident(k)} = src.${ident(k)}`).join(", ")}
        from jsonb_populate_record(null::${t}, ${lit(this.values)}::jsonb) src${this.filters.length ? " where " + this.filters.join(" and ") : ""} returning tgt.*)
        select coalesce(json_agg(row_to_json(tgt)), '[]')::text from (select ${await columns(this.returning ?? "*", this.table)} from w tgt) tgt;`;
    } else if (this.op === "delete") {
      rowsSql = `with w as (delete from ${t} tgt${this.filters.length ? " where " + this.filters.join(" and ") : ""} returning tgt.*)
        select coalesce(json_agg(row_to_json(tgt)), '[]')::text from (select ${await columns(this.returning ?? "*", this.table)} from w tgt) tgt;`;
    } else throw new Error("HARNESS_UNSUPPORTED empty query");
    let count: number | null = null;
    if (countSql) {
      const c = await runSql(countSql, this.asUser);
      if (c.error) return { data: null, error: c.error, count: null, status: 400 };
      count = Number(c.out);
      if (this.head) return { data: null, error: null, count, status: 200 };
    }
    const r = await runSql(rowsSql, this.asUser);
    if (r.error) return { data: null, error: r.error, count: null, status: 400 };
    const rows = JSON.parse(r.out || "[]") as unknown[];
    const mutating = this.op !== "select";
    if (this.mode === "single") {
      return rows.length === 1 ? { data: rows[0], error: null, count, status: 200 }
        : { data: null, error: { code: "PGRST116", message: `JSON object requested, ${rows.length} rows returned` }, count, status: 406 };
    }
    if (this.mode === "maybe") {
      return rows.length <= 1 ? { data: rows[0] ?? null, error: null, count, status: 200 }
        : { data: null, error: { code: "PGRST116", message: "multiple rows" }, count, status: 406 };
    }
    return { data: mutating && this.returning === null ? null : rows, error: null, count, status: 200 };
  }
}

const returnKinds = new Map<string, { void: boolean; set: boolean }>();
async function rpc(name: string, args: Record<string, unknown> = {}, asUser = false): Promise<Result> {
  ident(name);
  if (failingRpcs.has(name)) return { data: null, error: { code: "P0001", message: `HARNESS_FORCED_FAILURE ${name}` }, status: 400 };
  if (!returnKinds.has(name)) {
    const k = await runSql(`select coalesce(bool_and(prorettype = 'void'::regtype), false), coalesce(bool_or(proretset), false), count(*) from pg_proc where proname = ${lit(name)} and pronamespace = 'public'::regnamespace;`);
    const [isVoid, isSet, n] = k.out.split("|");
    if (k.error || n === "0") return { data: null, error: { code: "PGRST202", message: `function ${name} not found` }, status: 404 };
    returnKinds.set(name, { void: isVoid === "t", set: isSet === "t" });
  }
  const kind = returnKinds.get(name)!;
  const call = `public.${ident(name)}(${Object.entries(args).filter(([, v]) => v !== undefined).map(([k, v]) => `${ident(k)} => ${lit(v)}`).join(", ")})`;
  const sql = kind.void ? `select ${call}; select 'null';` : kind.set
    ? `select coalesce(json_agg(to_jsonb(r)), '[]')::text from ${call} r;` : `select coalesce(to_jsonb(${call}), 'null'::jsonb)::text;`;
  const r = await runSql(sql, asUser);
  if (r.error) return { data: null, error: r.error, status: 400 };
  return { data: JSON.parse(r.out.split("\n").pop() || "null"), error: null, status: 200 };
}
function rpcBuilder(name: string, args?: Record<string, unknown>, asUser = false) {
  const p = rpc(name, args, asUser);
  return Object.assign(p, {
    single: () => p.then(r => r.error ? r : Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r),
    maybeSingle: () => p.then(r => r.error ? r : Array.isArray(r.data) ? { ...r, data: r.data[0] ?? null } : r),
  });
}

export function createClient(_url: string, _key: string, options?: { global?: { headers?: Record<string, string> } }) {
  const asUser = options?.global?.headers?.Authorization === `Bearer ${SYNTHETIC_TOKEN}`;
  return {
    from: (table: string) => new Query(table, asUser),
    rpc: (name: string, args?: Record<string, unknown>) => rpcBuilder(name, args, asUser),
    auth: {
      getUser: (token?: string) => Promise.resolve(token === SYNTHETIC_TOKEN
        ? { data: { user: { id: SYNTHETIC_ACTOR, email: "operator@example.invalid" } }, error: null }
        : { data: { user: null }, error: { message: "invalid token" } }),
    },
    storage: { from: () => { throw new Error("HARNESS_UNSUPPORTED storage"); } },
    functions: { invoke: () => { throw new Error("HARNESS_UNSUPPORTED functions.invoke"); } },
  };
}
export type User = { id: string; email?: string };
export type SupabaseClient = ReturnType<typeof createClient>;
