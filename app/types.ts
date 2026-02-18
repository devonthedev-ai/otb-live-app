// types.ts - Data structures for OTB Live

export interface Product {
  style: string;
  color: string;
  size: string;
  season: string; // "Core" or "AW26", etc.
  leadTimeDays: number;
  cost: number;
  vendor?: string;
}

export interface InventoryItem {
  style: string;
  color: string;
  size: string;
  onHand: number;
  incomingQty: number;
  reservedQty: number;
}

export interface SaleRecord {
  style: string;
  color: string;
  size: string;
  units: number;
  date: string;
  netSales: number;
}

export interface VelocityCalc {
  style: string;
  color: string;
  size: string;
  dailyVelocity: number;
  daysOfSupply: number;
  stockoutDate: Date | null;
  stockoutRisk: 'critical' | 'warning' | 'ok';
}

export interface ReorderRecommendation {
  style: string;
  color: string;
  size: string;
  currentStock: number;
  dailyVelocity: number;
  daysUntilStockout: number;
  suggestedQty: number;
  reason: string;
  isCore: boolean;
}

// Phase 2 Features
export interface SizeCurve {
  size: string;
  ratio: number; // e.g., 0.25 = 25% of total
  count: number;
}

export interface StyleSizeProfile {
  style: string;
  totalSold: number;
  sizeDistribution: SizeCurve[];
}

export interface VendorSummary {
  vendor: string;
  styles: string[];
  totalQty: number;
  totalCost: number;
  items: ReorderRecommendation[];
}

export interface PODraft {
  poNumber: string;
  vendor: string;
  date: string;
  items: {
    style: string;
    color: string;
    size: string;
    qty: number;
    cost: number;
  }[];
  totalQty: number;
  totalCost: number;
}

export interface InventoryHealth {
  totalSKUs: number;
  coreSKUs: number;
  criticalCount: number;
  reorderCount: number;
  okCount: number;
  deadStockCount: number; // 90+ days, 0 sales
  avgWeeksOfSupply: number;
  totalInventoryValue: number;
}
