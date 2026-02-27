// supabase/functions/_shared/json-parser.ts

type ExpectRoot = "object" | "array";

export type ExtractAndParseOptions = {
  label?: string;
  maxLogChars?: number;
  expectRoot?: ExpectRoot;
};

function truncate(s: string, n: number) {
  if (!s) return "";
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function stripCodeFences(text: string): string {
  let t = (text ?? "").trim();
  if (!t.startsWith("```")) return t;

  // Remove opening fence line: ``` or ```json etc.
  const firstNl = t.indexOf("\n");
  if (firstNl !== -1) t = t.slice(firstNl + 1);

  // Remove last fence if present
  const lastFence = t.lastIndexOf("```");
  if (lastFence !== -1) t = t.slice(0, lastFence);

  return t.trim();
}

function findFirstJsonStart(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{" || c === "[") return i;
  }
  return -1;
}

function findJsonEndFromStart(textFromStart: string): number {
  const first = textFromStart[0];
  if (first !== "{" && first !== "[") return -1;

  const stack: string[] = [first === "{" ? "}" : "]"];
  let inString = false;
  let escaped = false;

  for (let i = 1; i < textFromStart.length; i++) {
    const c = textFromStart[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = false;
      }
      continue;
    }

    if (c === '"') {
      inString = true;
      continue;
    }

    if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === "}" || c === "]") {
      const expected = stack.pop();
      if (expected !== c) return -1; // mismatch => give up
      if (stack.length === 0) return i; // end of root JSON
    }
  }

  return -1;
}

function extractFirstJson(text: string): string {
  const start = findFirstJsonStart(text);
  if (start === -1) return text.trim(); // fallback: try whole string
  const sub = text.slice(start);
  const end = findJsonEndFromStart(sub);
  if (end === -1) return sub.trim(); // fallback: try until end
  return sub.slice(0, end + 1).trim();
}

export function extractAndParseJSON<T>(raw: string, opts: ExtractAndParseOptions = {}): T {
  const label = opts.label ?? "llm-json";
  const maxLogChars = opts.maxLogChars ?? 800;

  const cleaned = stripCodeFences(raw ?? "");
  const jsonStr = extractFirstJson(cleaned);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error(`[${label}] JSON parse failed`);
    console.error(`[${label}] raw:`, truncate(raw ?? "", maxLogChars));
    console.error(`[${label}] extracted:`, truncate(jsonStr ?? "", maxLogChars));
    throw new Error(`Erreur IA: JSON invalide (${(e as Error).message})`);
  }

  if (opts.expectRoot === "array" && !Array.isArray(parsed)) {
    throw new Error(`Erreur IA: JSON racine attendu=tableau`);
  }
  if (opts.expectRoot === "object") {
    const ok = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
    if (!ok) throw new Error(`Erreur IA: JSON racine attendu=objet`);
  }

  return parsed as T;
}