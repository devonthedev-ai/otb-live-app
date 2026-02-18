// utils/advancedCalculations.ts - Size curves, vendor grouping, inventory health

import { SaleRecord, ReorderRecommendation, StyleSizeProfile, VendorSummary, InventoryHealth, Product } from '../types';

// Calculate historical size distribution for a style
export function calculateSizeProfile(
  style: string,
  sales: SaleRecord[]
): StyleSizeProfile | null {
  const styleSales = sales.filter(s => s.style === style);
  if (styleSales.length === 0) return null;
  
  const sizeCounts = new Map<string, number>();
  let totalSold = 0;
  
  for (const sale of styleSales) {
    const count = sizeCounts.get(sale.size) || 0;
    sizeCounts.set(sale.size, count + sale.units);
    totalSold += sale.units;
  }
  
  const sizeDistribution = Array.from(sizeCounts.entries())
    .map(([size, count]) => ({
      size,
      count,
      ratio: count / totalSold
    }))
    .sort((a, b) => b.count - a.count); // Most popular first
  
  return {
    style,
    totalSold,
    sizeDistribution
  };
}

// Apply size curve to suggested reorder quantity
export function applySizeCurve(
  style: string,
  totalSuggestedQty: number,
  sales: SaleRecord[],
  packSize: number = 1
): { size: string; qty: number }[] {
  const profile = calculateSizeProfile(style, sales);
  if (!profile || profile.sizeDistribution.length === 0) {
    // No history — return equal distribution
    return [{ size: 'OS', qty: Math.ceil(totalSuggestedQty / packSize) * packSize }];
  }
  
  const result: { size: string; qty: number }[] = [];
  let remainingQty = totalSuggestedQty;
  
  // Apply ratios to get size breakdown
  for (let i = 0; i < profile.sizeDistribution.length; i++) {
    const { size, ratio } = profile.sizeDistribution[i];
    
    if (i === profile.sizeDistribution.length - 1) {
      // Last size gets remaining qty (rounding fix)
      let qty = Math.max(0, remainingQty);
      if (packSize > 1) {
        qty = Math.ceil(qty / packSize) * packSize;
      }
      result.push({ size, qty });
    } else {
      let qty = Math.floor(totalSuggestedQty * ratio);
      if (packSize > 1) {
        qty = Math.ceil(qty / packSize) * packSize;
      }
      result.push({ size, qty });
      remainingQty -= qty;
    }
  }
  
  return result.filter(r => r.qty > 0);
}

// Group reorder recommendations by vendor
export function groupByVendor(
  recommendations: ReorderRecommendation[],
  products: Product[]
): VendorSummary[] {
  const vendorMap = new Map<string, VendorSummary>();
  
  for (const rec of recommendations.filter(r => r.isCore && r.suggestedQty > 0)) {
    const product = products.find(p => 
      p.style === rec.style && p.color === rec.color && p.size === rec.size
    );
    
    const vendor = product?.vendor || 'Unknown';
    const cost = product?.cost || 0;
    
    if (!vendorMap.has(vendor)) {
      vendorMap.set(vendor, {
        vendor,
        styles: [],
        totalQty: 0,
        totalCost: 0,
        items: []
      });
    }
    
    const summary = vendorMap.get(vendor)!;
    if (!summary.styles.includes(rec.style)) {
      summary.styles.push(rec.style);
    }
    summary.totalQty += rec.suggestedQty;
    summary.totalCost += rec.suggestedQty * cost;
    summary.items.push(rec);
  }
  
  return Array.from(vendorMap.values())
    .sort((a, b) => b.totalCost - a.totalCost); // Highest value first
}

// Calculate inventory health metrics
export function calculateInventoryHealth(
  recommendations: ReorderRecommendation[],
  products: Product[]
): InventoryHealth {
  const criticalCount = recommendations.filter(r => r.isCore && r.suggestedQty > 0 && r.daysUntilStockout < 60).length;
  const reorderCount = recommendations.filter(r => r.isCore && r.suggestedQty > 0).length;
  const coreSKUs = recommendations.filter(r => r.isCore).length;
  
  // Dead stock = 90+ days supply, 0 velocity (actually Infinity days)
  const deadStockCount = recommendations.filter(r => 
    r.isCore && r.daysUntilStockout === Infinity && r.currentStock > 0
  ).length;
  
  // Average weeks of supply (only for items with velocity)
  const itemsWithVelocity = recommendations.filter(r => r.isCore && r.daysUntilStockout !== Infinity);
  const avgWeeksOfSupply = itemsWithVelocity.length > 0
    ? itemsWithVelocity.reduce((sum, r) => sum + (r.daysUntilStockout / 7), 0) / itemsWithVelocity.length
    : 0;
  
  // Total inventory value
  const totalInventoryValue = recommendations.reduce((sum, r) => {
    const product = products.find(p => 
      p.style === r.style && p.color === r.color && p.size === r.size
    );
    return sum + (r.currentStock * (product?.cost || 0));
  }, 0);
  
  return {
    totalSKUs: recommendations.length,
    coreSKUs,
    criticalCount,
    reorderCount,
    okCount: coreSKUs - reorderCount,
    deadStockCount,
    avgWeeksOfSupply: Math.round(avgWeeksOfSupply * 10) / 10,
    totalInventoryValue: Math.round(totalInventoryValue * 100) / 100
  };
}

// Check if size run is broken (missing core sizes)
export function checkSizeRunHealth(
  style: string,
  color: string,
  inventory: { size: string; onHand: number }[],
  sales: SaleRecord[]
): { 
  isHealthy: boolean; 
  missingSizes: string[]; 
  lowStockSizes: string[];
  recommendation: string;
} {
  const profile = calculateSizeProfile(style, sales);
  if (!profile) {
    return { isHealthy: true, missingSizes: [], lowStockSizes: [], recommendation: '' };
  }
  
  // Core sizes are those that represent >10% of historical sales
  const coreSizes = profile.sizeDistribution
    .filter(s => s.ratio >= 0.10)
    .map(s => s.size);
  
  const missingSizes: string[] = [];
  const lowStockSizes: string[] = [];
  
  for (const size of coreSizes) {
    const stock = inventory.find(i => i.size === size)?.onHand || 0;
    if (stock === 0) {
      missingSizes.push(size);
    } else if (stock < 3) {
      lowStockSizes.push(size);
    }
  }
  
  const isHealthy = missingSizes.length === 0 && lowStockSizes.length === 0;
  
  let recommendation = '';
  if (missingSizes.length > 0) {
    recommendation = `Broken size run — missing ${missingSizes.join(', ')}`;
  } else if (lowStockSizes.length > 0) {
    recommendation = `Low stock in sizes: ${lowStockSizes.join(', ')}`;
  }
  
  return { isHealthy, missingSizes, lowStockSizes, recommendation };
}
