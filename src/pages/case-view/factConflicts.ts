const ISSUE_FACT_KEYS: Readonly<Record<string, readonly string[]>> = {
  PAD_GROUP_WEIGHT_CONFLICT: ["cargo.weight_kg", "cargo.weight_per_container_kg"],
};

export function factKeysForExplicitIssues(issueCodes: readonly string[]): ReadonlySet<string> {
  return new Set(issueCodes.flatMap((code) => ISSUE_FACT_KEYS[code] ?? []));
}