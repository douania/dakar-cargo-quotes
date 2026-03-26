/**
 * C1.1 — Types extraits de CaseView.tsx
 */

/** P2 — Pricing precheck type (mirror run-pricing coherence checks) */
export type PricingPrecheck = {
  code: "HS_CODE_REQUIRED" | "REGIME_REQUIRED_FOR_EXEMPTION" | "FREIGHT_REQUIRED_FOR_FOB" | "CARGO_VALUE_REQUIRED" | "SERVICE_PACKAGE_REQUIRED";
  key: string;
  label: string;
};
