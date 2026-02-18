// utils/calculations.ts - Stockout and reorder calculations

import { Product, InventoryItem, SaleRecord, ReorderRecommendation } from '../types';

const LEAD_TIME_DAYS = 90;
const SAFETY_BUFFER_DAYS = 14;
const TOTAL_COVERAGE_DAYS = LEAD_TIME_DAYS + SAFETY_BUFFER_DAYS; // 104 days

export function calculateRecommendations(
  products: Product[],
  inventory: InventoryItem[],
  sales: SaleRecord[]
): ReorderRecommendation[] {
  const recommendations: ReorderRecommendation[] = [];
  
  // Calculate velocity per SKU from sales data
  const velocityMap = new Map<string, number>(); // key: style-color-size, value: daily velocity
  const skuSales = new Map<string, number>();
  
  // Aggregate sales by SKU
  for (const sale of sales) {
    const key = `${sale.style}-${sale.color}-${sale.size}`;
    skuSales.set(key, (skuSales.get(key) || 0) + sale.units);
  }
  
  // Calculate daily velocity (assuming 30 days of sales data)
  const DAYS_IN_PERIOD = 30;
  skuSales.forEach((units, key) => {
    velocityMap.set(key, units / DAYS_IN_PERIOD);
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
      const projectedDemand = Math.ceil(dailyVelocity * TOTAL_COVERAGE_DAYS);
      
      if (availableStock < projectedDemand) {
        suggestedQty = projectedDemand - availableStock;
        
        if (daysUntilStockout < LEAD_TIME_DAYS) {
          reason = `Stockout in ${Math.floor(daysUntilStockout)} days - CRITICAL`;
        } else if (daysUntilStockout < TOTAL_COVERAGE_DAYS) {
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
  if (daysUntilStockout < 60) return 'bg-red-100 text-red-800'; // Critical - less than 2 months
  if (daysUntilStockout < 104) return 'bg-yellow-100 text-yellow-800'; // Warning - below coverage
  return 'bg-green-100 text-green-800'; // OK
}
