/** Read-only PAD import/container catalogue contract, shared by proposal and pricing.
 * PER_TONNE is the stored unit; legacy synonyms remain supported. No tariff conversion.
 * Currency is implicit XOF in this catalogue (no currency column), not in arbitrary tariffs.
 */
export function isApplicableScenarioPadTariff(t: Record<string, unknown>, category: unknown, today: string): boolean {
  return typeof category === "string" && t.classification === category &&
    t.provider === "PAD" && t.category === "DROIT_PASSAGE" && t.operation_type === "IMPORT" &&
    t.cargo_type === "CONTENEUR" && t.is_active === true && (t.currency === undefined || t.currency === "XOF") &&
    ["official", "validated_internal"].includes(String(t.evidence_level)) &&
    typeof t.id === "string" && t.id.trim().length > 0 &&
    typeof t.source_document === "string" && t.source_document.trim().length > 0 &&
    ["per_tonne", "t", "ton", "tonne", "tonnes"].includes(String(t.unit).trim().toLowerCase()) &&
    typeof t.amount === "number" && Number.isFinite(t.amount) && t.amount > 0 &&
    typeof t.effective_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.effective_date) && t.effective_date <= today &&
    (t.expiry_date === null || (typeof t.expiry_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.expiry_date) && t.expiry_date >= today));
}
