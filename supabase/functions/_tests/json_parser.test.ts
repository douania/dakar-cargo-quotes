import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { extractAndParseJSON } from "../_shared/json-parser.ts";

Deno.test("extractAndParseJSON - markdown + bruit", () => {
  const input = `
Voici le résultat:
\`\`\`json
{ "items": ["a","b"], "total": 2 }
\`\`\`
fin.
`;
  const r = extractAndParseJSON<{ items: string[]; total: number }>(input, {
    expectRoot: "object",
    maxLogChars: 500,
  });
  assertEquals(r.total, 2);
  assertEquals(r.items.length, 2);
});

Deno.test("extractAndParseJSON - tableau pollué", () => {
  const input = `Intro [ {"id": 1}, {"id": 2} ] Outro`;
  const r = extractAndParseJSON<Array<{ id: number }>>(input, {
    expectRoot: "array",
    maxLogChars: 500,
  });
  assertEquals(r[1].id, 2);
});

Deno.test("extractAndParseJSON - accolades dans string", () => {
  const input = `prefix {"msg":"brace } inside", "ok":true} suffix`;
  const r = extractAndParseJSON<{ msg: string; ok: boolean }>(input, {
    expectRoot: "object",
    maxLogChars: 500,
  });
  assertEquals(r.ok, true);
});