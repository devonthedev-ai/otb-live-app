// utils/calculations.ts - Stockout and reorder calculations

import { Product, InventoryItem, SaleRecord, ReorderRecommendation } from '../types';

const SAFETY_BUFFER_DAYS = 14;

export function calculateRecommendations(
  products: Product[],
  inventory: InventoryItem[],
  sales: SaleRecord[]
): ReorderRecommendation[] {
  const recommendations: ReorderRecommendation[] = [];
  
  // Calculate actual date range from sales data
  const dates = sales.map(s => new Date(s.date)).filter(d => !isNaN(d.getTime()));
  const daysInPeriod = dates.length > 1 
    ? Math.max(1, Math.ceil((Math.max(...dates.map(d => d.getTime())) - Math.min(...dates.map(d => d.getTime()))) / (1000 * 60 * 60 * 24)))
    : 30; // fallback to 30 days if no valid dates
  
  // Calculate velocity per SKU from sales data
  const velocityMap = new Map<string, number>();
  const skuSales = new Map<string, number>();
  
  // Aggregate sales by SKU
  for (const sale of sales) {
    const key = `${sale.style}-${sale.color}-${sale.size}`;
    skuSales.set(key, (skuSales.get(key) || 0) + sale.units);
  }
  
  // Calculate daily velocity using actual date range
  skuSales.forEach((units, key) => {
    velocityMap.set(key, units / daysInPeriod);
  });
  
  // Process each inventory item
  for (const inv of inventory) {
    const key = `${inv.style}-${inv.color}-${inv.size}`;
    const product = products.find(p => 
      p.style === inv.style && p.color === inv.color && p.size === inv.size
    );
    
    if (!product) continue;
    
    // Only recommend for Core items
    const isCore = product.season === 'Core';
    const leadTimeDays = product.leadTimeDays || 90;
    const totalCoverageDays = leadTimeDays + SAFETY_BUFFER_DAYS;
    
    const dailyVelocity = velocityMap.get(key) || 0;
    const availableStock = inv.onHand - inv.reservedQty + inv.incomingQty;
    
    // Days until stockout
    const daysUntilStockout = dailyVelocity > 0 
      ? availableStock / dailyVelocity 
      : Infinity;
    
    // Calculate suggested reorder quantity
    let suggestedQty = 0;
    let reason = '';
    
    if (isCore && dailyVelocity > 0) {
      // Need to cover lead time + buffer
      const projectedDemand = Math.ceil(dailyVelocity * totalCoverageDays);
      
      if (availableStock < projectedDemand) {
        suggestedQty = projectedDemand - availableStock;
        
        if (daysUntilStockout < leadTimeDays) {
          reason = `Stockout in ${Math.floor(daysUntilStockout)} days - CRITICAL`;
        } else if (daysUntilStockout < totalCoverageDays) {
          reason = `Below safety stock (${Math.floor(daysUntilStockout)} days supply)`;
        } else {
          reason = 'Below optimal level';
        }
      }
    }
    
    recommendations.push({
      style: inv.style,
      color: inv.color,
      size: inv.size,
      currentStock: availableStock,
      dailyVelocity,
      daysUntilStockout: Math.floor(daysUntilStockout),
      suggestedQty,
      reason,
      isCore
    });
  }
  
  // Sort: Core items with stockout risk first, then by days until stockout
  return recommendations.sort((a, b) => {
    // Core items with suggestions first
    if (a.isCore && a.suggestedQty > 0 && (!b.isCore || b.suggestedQty === 0)) return -1;
    if (b.isCore && b.suggestedQty > 0 && (!a.isCore || a.suggestedQty === 0)) return 1;
    
    // Then by days until stockout (ascending)
    return a.daysUntilStockout - b.daysUntilStockout;
  });
}

export function getStockoutRiskClass(daysUntilStockout: number): string {
  if (daysUntilStockout < 60) return 'bg-red-100 text-red-800';
  if (daysUntilStockout < 104) return 'bg-yellow-100 text-yellow-800';
  return 'bg-green-100 text-green-800';
}
