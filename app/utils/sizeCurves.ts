// utils/sizeCurves.ts - Size distribution calculations and recommendations

import { SaleRecord, StyleSizeProfile, SizeCurveItem, ReorderRecommendation } from '../types';

/**
 * Calculate historical size distribution for a style
 * Returns null if insufficient data (less than 20 units sold total)
 */
export function calculateSizeProfile(
  style: string,
  sales: SaleRecord[]
): StyleSizeProfile | null {
  const styleSales = sales.filter(s => s.style === style);
  
  if (styleSales.length === 0) return null;
  
  // Aggregate by size
  const sizeCounts = new Map<string, number>();
  let totalSold = 0;
  
  for (const sale of styleSales) {
    const count = sizeCounts.get(sale.size) || 0;
    sizeCounts.set(sale.size, count + sale.units);
    totalSold += sale.units;
  }
  
  // Need minimum sample size for reliable curve
  if (totalSold < 20) {
    return {
      style,
      totalSold,
      sizeDistribution: [],
      reliability: 'low'
    };
  }
  
  // Calculate ratios and sort by count (descending)
  const sizeDistribution: SizeCurveItem[] = Array.from(sizeCounts.entries())
    .map(([size, count]) => ({
      size,
      count,
      ratio: count / totalSold,
      suggestedQty: 0 // Will be calculated later
    }))
    .sort((a, b) => b.count - a.count);
  
  // Determine reliability
  let reliability: 'high' | 'medium' | 'low' = 'low';
  if (totalSold >= 100) reliability = 'high';
  else if (totalSold >= 50) reliability = 'medium';
  
  return {
    style,
    totalSold,
    sizeDistribution,
    reliability
  };
}

/**
 * Apply size curve to a reorder recommendation
 * Takes total suggested quantity and distributes by historical size ratios
 */
export function applySizeCurve(
  recommendation: ReorderRecommendation,
  sales: SaleRecord[]
): SizeCurveItem[] {
  const profile = calculateSizeProfile(recommendation.style, sales);
  
  if (!profile || profile.sizeDistribution.length === 0 || profile.reliability === 'low') {
    // No reliable curve - return single item
    return [{
      size: recommendation.size,
      ratio: 1,
      count: 0,
      suggestedQty: recommendation.suggestedQty
    }];
  }
  
  const totalSuggested = recommendation.suggestedQty;
  const result: SizeCurveItem[] = [];
  let allocated = 0;
  
  // Calculate qty for each size
  for (let i = 0; i < profile.sizeDistribution.length; i++) {
    const { size, ratio } = profile.sizeDistribution[i];
    
    if (i === profile.sizeDistribution.length - 1) {
      // Last size gets remainder (handles rounding)
      result.push({
        size,
        ratio,
        count: profile.sizeDistribution[i].count,
        suggestedQty: totalSuggested - allocated
      });
    } else {
      const qty = Math.floor(totalSuggested * ratio);
      result.push({
        size,
        ratio,
        count: profile.sizeDistribution[i].count,
        suggestedQty: qty
      });
      allocated += qty;
    }
  }
  
  return result.filter(r => (r.suggestedQty || 0) > 0);
}

/**
 * Check if a style has a "broken size run"
 * (missing core sizes that represent >10% of sales)
 */
export function checkSizeRunHealth(
  style: string,
  color: string,
  inventory: { size: string; onHand: number }[],
  sales: SaleRecord[]
): {
  isHealthy: boolean;
  missingCoreSizes: string[];
  lowStockSizes: string[];
  message: string;
} {
  const profile = calculateSizeProfile(style, sales);
  
  if (!profile || profile.sizeDistribution.length === 0) {
    return { isHealthy: true, missingCoreSizes: [], lowStockSizes: [], message: '' };
  }
  
  // Core sizes = those representing >10% of historical sales
  const coreSizes = profile.sizeDistribution
    .filter(s => s.ratio >= 0.10)
    .map(s => s.size);
  
  const missingCoreSizes: string[] = [];
  const lowStockSizes: string[] = [];
  
  for (const size of coreSizes) {
    const stock = inventory.find(i => i.size === size)?.onHand || 0;
    if (stock === 0) {
      missingCoreSizes.push(size);
    } else if (stock < 3) {
      lowStockSizes.push(size);
    }
  }
  
  const isHealthy = missingCoreSizes.length === 0 && lowStockSizes.length === 0;
  
  let message = '';
  if (missingCoreSizes.length > 0) {
    message = `Broken run — missing ${missingCoreSizes.join(', ')}`;
  } else if (lowStockSizes.length > 0) {
    message = `Low stock in ${lowStockSizes.join(', ')}`;
  }
  
  return { isHealthy, missingCoreSizes, lowStockSizes, message };
}

/**
 * Generate size curve for all sizes of a style-color
 * Used when viewing size breakdown modal
 */
export function generateStyleColorSizeCurve(
  style: string,
  color: string,
  totalSuggestedQty: number,
  sales: SaleRecord[]
): SizeCurveItem[] {
  // Filter sales to this style (all colors to get full picture)
  const styleSales = sales.filter(s => s.style === style);
  
  const sizeCounts = new Map<string, number>();
  let totalSold = 0;
  
  for (const sale of styleSales) {
    const count = sizeCounts.get(sale.size) || 0;
    sizeCounts.set(sale.size, count + sale.units);
    totalSold += sale.units;
  }
  
  if (totalSold === 0) {
    return [];
  }
  
  // Standard apparel size order
  const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', '28', '29', '30', '31', '32', '33', '34', '35', '36', '38', '40', '42'];
  
  const result: SizeCurveItem[] = [];
  let allocated = 0;
  
  // Sort by standard size order
  const sortedSizes = Array.from(sizeCounts.entries())
    .sort((a, b) => {
      const idxA = sizeOrder.indexOf(a[0]);
      const idxB = sizeOrder.indexOf(b[0]);
      if (idxA === -1 && idxB === -1) return a[0].localeCompare(b[0]);
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
  
  for (let i = 0; i < sortedSizes.length; i++) {
    const [size, count] = sortedSizes[i];
    const ratio = count / totalSold;
    
    if (i === sortedSizes.length - 1) {
      result.push({ size, ratio, count, suggestedQty: totalSuggestedQty - allocated });
    } else {
      const qty = Math.round(totalSuggestedQty * ratio);
      result.push({ size, ratio, count, suggestedQty: qty });
      allocated += qty;
    }
  }
  
  return result.filter(r => (r.suggestedQty || 0) > 0 || r.count > 0);
}

/**
 * Get recommended pack size for a style
 * Based on common apparel industry standards
 */
export function getRecommendedPackSize(style: string, category?: string): number {
  // Outerwear often comes in 6-packs
  if (category?.toLowerCase().includes('outerwear') || 
      category?.toLowerCase().includes('jacket')) {
    return 6;
  }
  
  // Tops often come in 12-packs (2-3-4-3 or similar)
  if (category?.toLowerCase().includes('shirt') || 
      category?.toLowerCase().includes('tee')) {
    return 12;
  }
  
  // Accessories often individual or 6-pack
  if (category?.toLowerCase().includes('accessory') ||
      category?.toLowerCase().includes('hat') ||
      category?.toLowerCase().includes('belt')) {
    return 6;
  }
  
  // Default
  return 12;
}

/**
 * Round quantity to nearest pack multiple
 */
export function roundToPackSize(qty: number, packSize: number): number {
  return Math.ceil(qty / packSize) * packSize;
}
