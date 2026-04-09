/**
 * COCKPIT-11D — Extract synthetic cargo keys from cargo.containers JSON.
 *
 * The database stores container info as value_json on fact_key "cargo.containers",
 * e.g. [{"type":"40HC","quantity":5}]. The email template expects flat keys:
 *   cargo.container_type, cargo.container_count, cargo.fcl_lcl
 *
 * This helper derives those from the JSON array and injects them into a fact map.
 * It also ensures value_number is used when value_text is null (weight_kg, volume_cbm).
 */

interface ContainerEntry {
  type?: string;
  quantity?: number;
}

/**
 * Given the raw facts from a Supabase query (with value_text, value_number, value_json),
 * build a complete string map usable by buildPartnerEmailBody.
 */
export function buildFactMapWithSynthetics(
  rows: Array<{
    fact_key: string;
    value_text?: string | null;
    value_number?: number | null;
    value_json?: unknown;
  }>,
): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  let containersJson: ContainerEntry[] | null = null;

  for (const row of rows) {
    // Standard mapping: value_text first, fallback to value_number
    map[row.fact_key] = row.value_text || (row.value_number != null ? String(row.value_number) : null);

    // Capture containers JSON for synthetic extraction
    if (row.fact_key === "cargo.containers" && row.value_json) {
      containersJson = row.value_json as ContainerEntry[];
    }
  }

  // Derive synthetic keys from cargo.containers JSON
  if (Array.isArray(containersJson) && containersJson.length > 0) {
    // Aggregate by type: { "40HC": 5, "20GP": 2 }
    const typeAgg: Record<string, number> = {};
    for (const entry of containersJson) {
      const t = (entry.type ?? "").trim();
      const q = typeof entry.quantity === "number" ? entry.quantity : 0;
      if (t && q > 0) {
        typeAgg[t] = (typeAgg[t] || 0) + q;
      }
    }

    const types = Object.keys(typeAgg);
    const totalQuantity = Object.values(typeAgg).reduce((a, b) => a + b, 0);

    if (totalQuantity > 0) {
      // container_type: single type or aggregated string
      if (types.length === 1) {
        map["cargo.container_type"] = map["cargo.container_type"] || types[0];
      } else if (types.length > 1) {
        const parts = types.map((t) => `${typeAgg[t]}x ${t}`);
        map["cargo.container_type"] = map["cargo.container_type"] || parts.join(" + ");
      }

      // container_count: total
      map["cargo.container_count"] = map["cargo.container_count"] || String(totalQuantity);

      // fcl_lcl: FCL if containers present
      map["cargo.fcl_lcl"] = map["cargo.fcl_lcl"] || "FCL";
    }
  }

  return map;
}
