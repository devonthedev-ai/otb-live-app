// utils/smartProjections.ts - ML-style forecasting with trend detection

import { SaleRecord, SmartProjection, ProjectionInput, ReorderRecommendation } from '../types';

/**
 * Calculate trend over time
 * Returns: positive = accelerating, negative = decelerating, near 0 = stable
 */
export function calculateTrend(sales: SaleRecord[]): number {
  if (sales.length < 7) return 0; // Need at least a week of data
  
  // Group by date
  const dailySales = new Map<string, number>();
  for (const sale of sales) {
    const existing = dailySales.get(sale.date) || 0;
    dailySales.set(sale.date, existing + sale.units);
  }
  
  const dates = Array.from(dailySales.keys()).sort();
  if (dates.length < 4) return 0;
  
  // Split into first half and second half
  const mid = Math.floor(dates.length / 2);
  const firstHalf = dates.slice(0, mid);
  const secondHalf = dates.slice(mid);
  
  const firstAvg = firstHalf.reduce((sum, d) => sum + (dailySales.get(d) || 0), 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, d) => sum + (dailySales.get(d) || 0), 0) / secondHalf.length;
  
  if (firstAvg === 0) return 0;
  
  // Return percentage change
  return (secondAvg - firstAvg) / firstAvg;
}

/**
 * Calculate volatility (coefficient of variation)
 * Higher = more unpredictable
 */
export function calculateVolatility(sales: SaleRecord[]): number {
  if (sales.length < 7) return 0.5; // Default medium volatility
  
  const dailySales = new Map<string, number>();
  for (const sale of sales) {
    const existing = dailySales.get(sale.date) || 0;
    dailySales.set(sale.date, existing + sale.units);
  }
  
  const values = Array.from(dailySales.values());
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  
  if (mean === 0) return 0.5;
  
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);
  
  return stdDev / mean; // Coefficient of variation
}

/**
 * Calculate channel-specific metrics
 */
export function calculateChannelMetrics(
  style: string,
  color: string,
  size: string,
  sales: SaleRecord[]
) {
  const itemSales = sales.filter(s => 
    s.style === style && s.color === color && s.size === size
  );
  
  const channels = ['online', 'wholesale', 'retail'] as const;
  const result: Record<string, { velocity: number; trend: number; sampleSize: number }> = {};
  
  for (const channel of channels) {
    const channelSales = itemSales.filter(s => s.channel === channel);
    
    if (channelSales.length === 0) {
      result[channel] = { velocity: 0, trend: 0, sampleSize: 0 };
      continue;
    }
    
    // Calculate velocity for this channel
    const days = new Set(channelSales.map(s => s.date)).size || 1;
    const total = channelSales.reduce((sum, s) => sum + s.units, 0);
    const velocity = total / days;
    
    // Calculate trend for this channel
    const trend = calculateTrend(channelSales);
    
    result[channel] = {
      velocity,
      trend,
      sampleSize: channelSales.length
    };
  }
  
  return result;
}

/**
 * Generate smart projection for a SKU
 */
export function generateSmartProjection(
  _input: ProjectionInput
): SmartProjection {
  const { historicalSales, currentInventory, leadTimeDays: _leadTimeDays, channel: _channel } = _input;
  
  // Base velocity (simple average)
  const days = new Set(historicalSales.map(s => s.date)).size || 30;
  const totalUnits = historicalSales.reduce((sum, s) => sum + s.units, 0);
  const baseVelocity = totalUnits / days;
  
  // Calculate trend
  const trendValue = calculateTrend(historicalSales);
  
  // Calculate volatility
  const volatilityValue = calculateVolatility(historicalSales);
  
  // Apply trend adjustment (cap at ±50% to avoid extreme projections)
  const trendFactor = Math.max(-0.5, Math.min(0.5, trendValue));
  const adjustedVelocity = baseVelocity * (1 + trendFactor);
  
  // Calculate confidence based on sample size and volatility
  const sampleSize = historicalSales.length;
  let confidence = 50; // Base confidence
  
  // More data = higher confidence
  if (sampleSize > 100) confidence += 20;
  else if (sampleSize > 50) confidence += 10;
  else if (sampleSize < 20) confidence -= 20;
  
  // Lower volatility = higher confidence
  if (volatilityValue < 0.3) confidence += 15;
  else if (volatilityValue > 1.0) confidence -= 15;
  
  // Cap confidence
  confidence = Math.max(20, Math.min(95, confidence));
  
  // Calculate recommended safety stock based on volatility
  // Higher volatility = higher safety stock
  const safetyStockMultiplier = 1 + (volatilityValue * 0.5);
  const recommendedSafetyStock = Math.ceil(adjustedVelocity * 14 * safetyStockMultiplier);
  
  // Project stockout date
  let projectedStockoutDate = new Date();
  if (adjustedVelocity > 0) {
    const daysUntilStockout = currentInventory / adjustedVelocity;
    projectedStockoutDate.setDate(projectedStockoutDate.getDate() + daysUntilStockout);
  } else {
    projectedStockoutDate = new Date('2099-12-31'); // Never
  }
  
  return {
    baseVelocity,
    adjustedVelocity,
    confidence,
    factors: {
      trend: trendFactor,
      seasonality: 0, // Placeholder
      weather: 0, // Placeholder
      channelMix: 0 // Placeholder
    },
    recommendedSafetyStock,
    projectedStockoutDate
  };
}

/**
 * Determine trend direction label
 */
export function getTrendLabel(trendValue: number): 'accelerating' | 'decelerating' | 'stable' {
  if (trendValue > 0.15) return 'accelerating';
  if (trendValue < -0.15) return 'decelerating';
  return 'stable';
}

/**
 * Determine volatility label
 */
export function getVolatilityLabel(volatilityValue: number): 'low' | 'medium' | 'high' {
  if (volatilityValue < 0.5) return 'low';
  if (volatilityValue > 1.0) return 'high';
  return 'medium';
}

/**
 * Enhance recommendations with smart projections
 */
export function enhanceWithSmartProjections(
  recommendations: ReorderRecommendation[],
  sales: SaleRecord[]
): ReorderRecommendation[] {
  return recommendations.map(rec => {
    const itemSales = sales.filter(s => 
      s.style === rec.style && s.color === rec.color && s.size === rec.size
    );
    
    if (itemSales.length === 0) {
      return {
        ...rec,
        confidence: 30,
        volatility: 'high',
        trend: 'stable'
      };
    }
    
    const trendValue = calculateTrend(itemSales);
    const volatilityValue = calculateVolatility(itemSales);
    
    // Calculate channel breakdown if we have channel data
    const channelBreakdown: Record<string, { velocity: number; trend: number }> = {};
    const channels = ['online', 'wholesale', 'retail'];
    let hasChannelData = false;
    
    for (const ch of channels) {
      const chSales = itemSales.filter(s => s.channel === ch);
      if (chSales.length > 0) {
        hasChannelData = true;
        const chDays = new Set(chSales.map(s => s.date)).size || 1;
        const chTotal = chSales.reduce((sum, s) => sum + s.units, 0);
        channelBreakdown[ch] = {
          velocity: chTotal / chDays,
          trend: calculateTrend(chSales)
        };
      }
    }
    
    return {
      ...rec,
      confidence: calculateConfidence(itemSales.length, volatilityValue),
      volatility: getVolatilityLabel(volatilityValue),
      trend: getTrendLabel(trendValue),
      channelBreakdown: hasChannelData ? channelBreakdown : undefined
    };
  });
}

function calculateConfidence(sampleSize: number, volatility: number): number {
  let confidence = 50;
  
  if (sampleSize > 100) confidence += 20;
  else if (sampleSize > 50) confidence += 10;
  else if (sampleSize < 20) confidence -= 20;
  
  if (volatility < 0.3) confidence += 15;
  else if (volatility > 1.0) confidence -= 15;
  
  return Math.max(20, Math.min(95, confidence));
}
