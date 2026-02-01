/**
 * Quotation Domain Types — Phase 4F.1
 * 
 * Contrat métier canonique pour le moteur de calcul.
 * Types immuables, readonly, sans dépendance UI.
 */

export type Money = number;
export type Quantity = number;
export type WeightKg = number;
export type VolumeM3 = number;
export type EntityId = string;

export interface CargoLineDomain {
  readonly id: EntityId;
  readonly quantity?: Quantity | null;
  readonly weight_kg?: WeightKg | null;
  readonly volume_m3?: VolumeM3 | null;
  readonly description?: string | null;
  readonly meta?: Readonly<Record<string, unknown>> | null;
}

export interface ServiceLineDomain {
  readonly id: EntityId;
  readonly description?: string | null;
  readonly quantity?: Quantity | null;
  readonly unit_price?: Money | null;
  readonly service_code?: string | null;
  readonly meta?: Readonly<Record<string, unknown>> | null;
}

export interface QuotationInput {
  readonly cargoLines: ReadonlyArray<CargoLineDomain>;
  readonly serviceLines: ReadonlyArray<ServiceLineDomain>;
  readonly context?: Readonly<{
    readonly currency?: string;
    readonly tax_rate?: number;
    readonly rounding?: 'none' | 'integer';
  }> | null;
}

export interface QuotationTotals {
  readonly subtotal_services: Money;
  readonly subtotal_cargo_metrics: {
    readonly total_weight_kg: WeightKg;
    readonly total_volume_m3: VolumeM3;
    readonly total_quantity: Quantity;
  };
  readonly total_ht: Money;
  readonly total_tax: Money;
  readonly total_ttc: Money;
}

export type QuoteIssueCode =
  | 'EMPTY_LINES_IGNORED'
  | 'NEGATIVE_VALUES_COERCED'
  | 'MISSING_REQUIRED_VALUES'
  | 'NON_FINITE_NUMBER'
  | 'ROUNDING_APPLIED';

export interface QuoteIssue {
  readonly code: QuoteIssueCode;
  readonly message: string;
  readonly path?: string;
}

export interface QuotationSnapshot {
  readonly totals: QuotationTotals;
  readonly issues: ReadonlyArray<QuoteIssue>;
}

export interface QuotationEngineResult {
  readonly input: QuotationInput;
  readonly snapshot: QuotationSnapshot;
}

// Phase 5D : Statut workflow devis (Phase 6D.1: ajout 'generated')
export type QuotationStatus = 'draft' | 'generated' | 'sent' | 'accepted' | 'rejected' | 'expired';

/**
 * Phase 6D.1: Snapshot figé d'un devis généré
 * Structure immuable après génération
 */
export interface GeneratedSnapshot {
  readonly meta: {
    readonly quotation_id: string;  // TOUJOURS un ID existant, jamais généré côté client
    readonly version: number;
    readonly generated_at: string;  // ISO 8601
    readonly currency: string;
  };
  readonly client: {
    readonly name: string | null;
    readonly company: string | null;
    readonly email?: string | null;
    readonly project_name: string | null;
    readonly incoterm: string | null;
    readonly route_origin: string | null;
    readonly route_destination: string | null;  // nullable per CTO review
  };
  readonly cargo_lines: ReadonlyArray<{
    readonly id: string;
    readonly description: string | null;
    readonly cargo_type: string;
    readonly container_type?: string | null;
    readonly container_count?: number | null;
    readonly weight_kg?: number | null;
    readonly volume_cbm?: number | null;
  }>;
  readonly service_lines: ReadonlyArray<{
    readonly id: string;
    readonly service: string;
    readonly description: string | null;
    readonly quantity: number;
    readonly rate: number;
    readonly currency: string;
    readonly unit: string | null;
  }>;
  readonly totals: {
    readonly subtotal: number;
    readonly total: number;
    readonly currency: string;
  };
}
