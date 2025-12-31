export interface PackingItem {
  id: string;
  description: string;
  length: number;
  width: number;
  height: number;
  weight: number;
  quantity: number;
  stackable?: boolean;
}

export interface TruckSpec {
  name: string;
  length: number;
  width: number;
  height: number;
  max_weight: number;
}

export interface Placement {
  item_id: string;
  truck_index: number;
  position: { x: number; y: number; z: number };
  rotated: boolean;
}

export interface OptimizationMetrics {
  trucks_used: number;
  fill_rate: number;
  weight_utilization: number;
  items_placed: number;
  items_total: number;
}

export interface OptimizationResult {
  placements: Placement[];
  metrics: OptimizationMetrics;
  visualization_base64?: string;
}

export type Algorithm = 'simple' | 'genetic';
export type WorkflowStep = 1 | 2 | 3;

// Fleet suggestion types

// Detailed truck info with pre-assigned items from suggest-fleet API
export interface TruckDetails {
  type: string;
  items: {
    id: string;
    name: string;
    length: number;
    width: number;
    height: number;
    weight: number;
    quantity?: number;
  }[];
  volume_capacity: number;
  weight_capacity: number;
}

export interface TruckAllocation {
  truck_type: string;
  count: number;
  fill_rate: number;
  weight_utilization: number;
  items_assigned: number;
  trucks_details?: TruckDetails[]; // Pre-assigned items per truck from backend
}

export interface FleetScenario {
  name: string;
  description: string;
  trucks: TruckAllocation[];
  total_cost: number;
  total_trucks: number;
  is_recommended: boolean;
}

export interface FleetSuggestionResult {
  scenarios: FleetScenario[];
  recommended_scenario: string;
  total_weight: number;
  total_volume: number;
  items_count: number;
}
