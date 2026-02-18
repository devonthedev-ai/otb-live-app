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
