// utils/seasonalRecommendations.ts - Smart recommendations with seasonal awareness

import { DbProduct, DbRecommendation, DbSale, DbInventory } from '../types/database';
import { 
  analyzeSeasonalPatterns, 
  getSeasonalMultiplier, 
  detectYoYTrend,
  daysUntilPeakSeason,
  getSeasonName 
} from './seasonalAnalysis';

export interface SeasonalRecommendation extends DbRecommendation {
  seasonalAdjustment: {
    baseVelocity: number;
    adjustedVelocity: number;
    multiplier: number;
    peakMonths: number[];
    daysUntilPeak: number;
  };
  classification: {
    type: 'core' | 'seasonal' | 'holiday' | 'declining' | 'emerging';
    confidence: number;
    reason: string;
  };
  timing: {
    optimalReorderMonth: number;
    latestReorderDate: Date;
    rationale: string;
  };
}

/**
 * Generate recommendations with seasonal intelligence
 */
export function generateSeasonalRecommendations(
  products: DbProduct[],
  inventory: DbInventory[],
  sales: DbSale[],
  targetDate: Date = new Date()
): SeasonalRecommendation[] {
  const recommendations: SeasonalRecommendation[] = [];
  const currentMonth = targetDate.getMonth();

  // Group sales by product
  const salesByProduct = groupByProduct(sales);

  for (const product of products) {
    const inv = inventory.find(i => i.product_id === product.id);
    if (!inv) continue;

    const productSales = salesByProduct.get(product.id) || [];
    
    // Convert DbSale to SaleData format for seasonal analysis
    const saleDataForAnalysis = productSales.map(s => ({
      units: s.units,
      date: s.sale_date,
    }));
    
    // Get base recommendation (existing logic)
    const baseRec = calculateBaseRecommendation(product, inv, productSales);
    
    // Analyze seasonality
    const seasonalAnalysis = analyzeSeasonalPatterns(
      product.style,
      saleDataForAnalysis,
      60 // Need 2 months minimum
    );

    // Detect YoY trend (also needs conversion)
    const yoyTrend = detectYoYTrend(saleDataForAnalysis);

    // Determine classification
    const classification = determineClassification(
      product,
      seasonalAnalysis,
      yoyTrend,
      productSales.length
    );

    // Calculate seasonal adjustments
    let multiplier = 1.0;
    let adjustedVelocity = baseRec.daily_velocity || 0;
    
    if (seasonalAnalysis && seasonalAnalysis.isSeasonal) {
      multiplier = getSeasonalMultiplier(seasonalAnalysis, currentMonth);
      adjustedVelocity = (baseRec.daily_velocity || 0) * multiplier;
    }

    // Apply YoY trend adjustment
    if (yoyTrend.confidence > 50) {
      const trendMultiplier = 1 + (yoyTrend.rate * 0.5); // Conservative application
      adjustedVelocity *= trendMultiplier;
    }

    // Calculate timing
    const timing = calculateOptimalTiming(
      inv,
      adjustedVelocity,
      product.lead_time_days || 90,
      seasonalAnalysis,
      targetDate
    );

    // Recalculate suggested qty with seasonal adjustments
    const availableStock = inv.on_hand + inv.incoming_qty - inv.reserved_qty;
    const safetyStock = adjustedVelocity * 14;
    const demandDuringLead = adjustedVelocity * (product.lead_time_days || 90);
    const suggestedQty = Math.max(0, Math.ceil(demandDuringLead + safetyStock - availableStock));

    recommendations.push({
      ...baseRec as DbRecommendation,
      id: baseRec.id || '',
      suggested_qty: suggestedQty,
      daily_velocity: adjustedVelocity,
      reason: generateReason(classification, timing, seasonalAnalysis, multiplier),
      seasonalAdjustment: {
        baseVelocity: baseRec.daily_velocity || 0,
        adjustedVelocity,
        multiplier,
        peakMonths: seasonalAnalysis?.peakMonths || [],
        daysUntilPeak: seasonalAnalysis 
          ? daysUntilPeakSeason(seasonalAnalysis.peakMonths, targetDate)
          : 365,
      },
      classification,
      timing,
    });
  }

  return recommendations.sort((a, b) => {
    // Prioritize: 
    // 1. Critical seasonal items approaching peak
    // 2. Critical core items
    // 3. Everything else by days until stockout
    
    const aPriority = getPriorityScore(a);
    const bPriority = getPriorityScore(b);
    
    return bPriority - aPriority;
  });
}

/**
 * Determine product classification
 */
function determineClassification(
  product: DbProduct,
  seasonalAnalysis: ReturnType<typeof analyzeSeasonalPatterns>,
  yoyTrend: ReturnType<typeof detectYoYTrend>,
  dataPoints: number
): SeasonalRecommendation['classification'] {
  // Declining detection
  if (yoyTrend.confidence > 60 && !yoyTrend.isGrowing && yoyTrend.rate < -0.2) {
    return {
      type: 'declining',
      confidence: yoyTrend.confidence,
      reason: `Sales declining ${(Math.abs(yoyTrend.rate) * 100).toFixed(0)}% YoY`,
    };
  }

  // Emerging detection (new product accelerating)
  if (dataPoints < 90 && yoyTrend.isGrowing && yoyTrend.rate > 0.5) {
    return {
      type: 'emerging',
      confidence: Math.min(80, yoyTrend.confidence),
      reason: 'New product showing strong growth trajectory',
    };
  }

  // Seasonal classification
  if (seasonalAnalysis && seasonalAnalysis.confidence > 60) {
    if (seasonalAnalysis.seasonalityScore > 2.0) {
      return {
        type: 'holiday',
        confidence: seasonalAnalysis.confidence,
        reason: `Highly seasonal - peaks in ${seasonalAnalysis.peakMonths.map(getSeasonName).join(', ')}`,
      };
    }
    
    if (seasonalAnalysis.isSeasonal) {
      return {
        type: 'seasonal',
        confidence: seasonalAnalysis.confidence,
        reason: `Seasonal pattern detected - strongest in ${seasonalAnalysis.peakMonths.map(getSeasonName).join(', ')}`,
      };
    }
  }

  // Default to core
  return {
    type: 'core',
    confidence: dataPoints > 180 ? 90 : 60,
    reason: dataPoints > 180 
      ? 'Stable year-round demand pattern' 
      : 'Insufficient data for seasonal classification',
  };
}

/**
 * Calculate optimal reorder timing
 */
function calculateOptimalTiming(
  inv: DbInventory,
  adjustedVelocity: number,
  leadTimeDays: number,
  seasonalAnalysis: ReturnType<typeof analyzeSeasonalPatterns>,
  targetDate: Date
): SeasonalRecommendation['timing'] {
  const daysUntilStockout = adjustedVelocity > 0 
    ? (inv.on_hand + inv.incoming_qty - inv.reserved_qty) / adjustedVelocity
    : 999;

  const latestReorderDate = new Date(targetDate);
  latestReorderDate.setDate(latestReorderDate.getDate() + Math.max(0, daysUntilStockout - leadTimeDays - 14));

  let optimalMonth = targetDate.getMonth();
  let rationale = 'Standard reorder timing';

  if (seasonalAnalysis && seasonalAnalysis.isSeasonal) {
    // If approaching peak season, order earlier
    const daysToPeak = daysUntilPeakSeason(seasonalAnalysis.peakMonths, targetDate);
    
    if (daysToPeak < leadTimeDays + 45) {
      // We're within ordering window for peak
      optimalMonth = targetDate.getMonth();
      rationale = `Order now to arrive before ${getSeasonName(seasonalAnalysis.peakMonths[0])} peak`;
    } else if (daysUntilStockout > daysToPeak - leadTimeDays) {
      // Will stock out before peak - urgent
      optimalMonth = targetDate.getMonth();
      rationale = `URGENT: Stockout before peak season. Order immediately.`;
    }
  }

  return {
    optimalReorderMonth: optimalMonth,
    latestReorderDate,
    rationale,
  };
}

/**
 * Generate human-readable reason
 */
function generateReason(
  classification: SeasonalRecommendation['classification'],
  timing: SeasonalRecommendation['timing'],
  seasonalAnalysis: ReturnType<typeof analyzeSeasonalPatterns>,
  multiplier: number
): string {
  const parts: string[] = [];

  // Classification context
  parts.push(classification.reason);

  // Seasonal adjustment
  if (multiplier !== 1.0) {
    const direction = multiplier > 1 ? 'boosted' : 'reduced';
    parts.push(`Velocity ${direction} ${((Math.abs(multiplier - 1) * 100)).toFixed(0)}% for seasonality`);
  }

  // Timing
  parts.push(timing.rationale);

  return parts.join('. ') + '.';
}

/**
 * Get priority score for sorting
 */
function getPriorityScore(rec: SeasonalRecommendation): number {
  let score = 0;

  // Critical items get high priority
  if (rec.days_until_stockout < 30) score += 100;
  else if (rec.days_until_stockout < 60) score += 50;

  // Seasonal items approaching peak get extra priority
  if (rec.classification.type === 'seasonal' || rec.classification.type === 'holiday') {
    const threshold = rec.suggested_qty > 0 ? 60 : 30;
    if (rec.seasonalAdjustment.daysUntilPeak < threshold) {
      score += 75;
    }
  }

  // Declining items get lower priority
  if (rec.classification.type === 'declining') {
    score -= 25;
  }

  // Emerging items get medium-high priority
  if (rec.classification.type === 'emerging') {
    score += 40;
  }

  return score;
}

/**
 * Group sales by product
 */
function groupByProduct(sales: DbSale[]): Map<string, DbSale[]> {
  const map = new Map<string, DbSale[]>();
  
  for (const sale of sales) {
    const existing = map.get(sale.product_id) || [];
    existing.push(sale);
    map.set(sale.product_id, existing);
  }
  
  return map;
}

/**
 * Calculate base recommendation (existing logic)
 */
function calculateBaseRecommendation(
  product: DbProduct,
  inv: DbInventory,
  sales: DbSale[]
): Partial<DbRecommendation> {
  const days = 30;
  const recentSales = sales.filter(s => {
    const saleDate = new Date(s.sale_date);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return saleDate >= cutoff;
  });

  const totalUnits = recentSales.reduce((sum, s) => sum + s.units, 0);
  const dailyVelocity = totalUnits / days;

  const availableStock = inv.on_hand + inv.incoming_qty - inv.reserved_qty;
  const daysUntilStockout = dailyVelocity > 0 
    ? Math.floor(availableStock / dailyVelocity)
    : 999;

  return {
    workspace_id: product.workspace_id,
    product_id: product.id,
    current_stock: availableStock,
    daily_velocity: dailyVelocity,
    days_until_stockout: daysUntilStockout,
    is_core: product.season === 'Core',
    confidence: sales.length > 50 ? 70 : 50,
    calculated_at: new Date().toISOString(),
  };
}
