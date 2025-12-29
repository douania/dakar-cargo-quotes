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
export type WorkflowStep = 1 | 2 | 3 | 4;
