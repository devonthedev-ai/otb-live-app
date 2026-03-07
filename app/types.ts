// types.ts - Data structures for OTB Live

// === Core Data Models ===

export interface Product {
  style: string;
  color: string;
  size: string;
  season: string; // "Core" or "AW26", etc.
  category?: string; // Shirts, Pants, Outerwear, Accessories
  subcategory?: string; // SS Shirts, LS Shirts, etc.
  leadTimeDays: number;
  cost: number;
  vendor?: string;
  weatherSensitive?: boolean; // True for outerwear, shorts, etc.
}

export interface InventoryItem {
  style: string;
  color: string;
  size: string;
  onHand: number;
  incomingQty: number;
  reservedQty: number;
  channel?: 'online' | 'wholesale' | 'retail';
}

export interface SaleRecord {
  style: string;
  color: string;
  size: string;
  units: number;
  date: string;
  netSales: number;
  channel?: 'online' | 'wholesale' | 'retail';
}

// === Recommendation Models ===

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
  confidence?: number; // 0-100, based on data quality
  volatility?: 'low' | 'medium' | 'high'; // How much sales fluctuate
  trend?: 'accelerating' | 'decelerating' | 'stable';
  
  // Smart projection data
  channelBreakdown?: Record<string, { velocity: number; trend: number }>;
}

// === Size Curve Models ===

export interface SizeCurveItem {
  size: string;
  ratio: number; // e.g., 0.25 = 25% of total
  count: number;
  suggestedQty?: number; // Calculated from total suggested × ratio
}

export interface StyleSizeProfile {
  style: string;
  totalSold: number;
  sizeDistribution: SizeCurveItem[];
  reliability?: 'high' | 'medium' | 'low'; // Based on sample size
}

// === Category Models ===

export interface CategorySummary {
  category: string;
  subcategories: string[];
  totalStyles: number;
  totalSKUs: number;
  criticalCount: number;
  reorderCount: number;
  avgWeeksOfSupply: number;
  totalValue: number;
  velocityTrend: 'up' | 'down' | 'stable';
  items: ReorderRecommendation[];
}

// === Vendor & PO Models ===

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
  deliveryDate: string;
  items: POItem[];
  totalQty: number;
  totalCost: number;
  notes?: string;
}

export interface POItem {
  style: string;
  color: string;
  size: string;
  qty: number;
  cost: number;
  extendedCost: number;
}

// === Health & Analytics ===

export interface InventoryHealth {
  totalSKUs: number;
  coreSKUs: number;
  criticalCount: number;
  reorderCount: number;
  okCount: number;
  deadStockCount: number;
  avgWeeksOfSupply: number;
  totalInventoryValue: number;
  
  // Channel breakdown
  channelHealth?: {
    online: { velocity: number; trend: number; critical: number };
    wholesale: { velocity: number; trend: number; critical: number };
    retail: { velocity: number; trend: number; critical: number };
  };
}

// === Alert Models ===

export interface Alert {
  id: string;
  type: 'critical' | 'reorder' | 'trend_change' | 'size_run_broken';
  style: string;
  color: string;
  size: string;
  message: string;
  severity: 'high' | 'medium' | 'low';
  createdAt: string;
  read: boolean;
}

export interface DailyDigest {
  date: string;
  newCritical: number;
  newReorder: number;
  alerts: Alert[];
  topActions: ReorderRecommendation[];
}

// === Smart Projection Models ===

export interface ProjectionInput {
  historicalSales: SaleRecord[];
  currentInventory: number;
  leadTimeDays: number;
  channel?: 'online' | 'wholesale' | 'retail';
  category?: string;
  weatherData?: WeatherData;
}

export interface WeatherData {
  avgTemp14Day: number;
  tempTrend: 'warming' | 'cooling' | 'stable';
  precipitation: number;
}

export interface SmartProjection {
  baseVelocity: number; // Simple 30-day average
  adjustedVelocity: number; // ML-adjusted
  confidence: number; // 0-100
  factors: {
    trend: number; // +20% if accelerating, -20% if decelerating
    seasonality: number; // Based on category patterns
    weather?: number; // If weather-sensitive
    channelMix: number; // Based on channel reliability
  };
  recommendedSafetyStock: number;
  projectedStockoutDate: Date;
}
