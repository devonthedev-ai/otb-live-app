// utils/categoryAnalysis.ts - Aggregate seasonal patterns by category

import { DbProduct, DbSale } from '../types/database';
import { analyzeSeasonalPatterns, SeasonalAnalysis } from './seasonalAnalysis';

export interface CategorySeasonalProfile {
  category: string;
  subcategories: string[];
  totalStyles: number;
  totalSKUs: number;
  
  // Aggregate metrics
  seasonalityProfile: 'stable' | 'seasonal' | 'highly_seasonal';
  peakMonths: number[];
  offPeakMonths: number[];
  
  // Breakdown by classification
  itemBreakdown: {
    core: number;
    seasonal: number;
    holiday: number;
    declining: number;
    emerging: number;
  };
  
  // Insights
  insights: string[];
}

/**
 * Analyze seasonal patterns at category level
 */
export function analyzeCategoryPatterns(
  category: string,
  products: DbProduct[],
  sales: DbSale[]
): CategorySeasonalProfile {
  // Group products by style (to avoid double-counting sizes)
  const uniqueStyles = Array.from(new Set(products.map(p => p.style)));
  const subcategories = Array.from(new Set(products.map(p => p.subcategory).filter((s): s is string => typeof s === 'string')));
  
  // Analyze each style
  const styleAnalyses: (SeasonalAnalysis | null)[] = [];
  
  for (const style of uniqueStyles) {
    const styleProducts = products.filter(p => p.style === style);
    const styleProductIds = new Set(styleProducts.map(p => p.id));
    const styleSales = sales.filter(s => styleProductIds.has(s.product_id));
    
    const analysis = analyzeSeasonalPatterns(
      style,
      styleSales.map(s => ({ units: s.units, date: s.sale_date })),
      60
    );
    
    styleAnalyses.push(analysis);
  }
  
  // Aggregate patterns
  const validAnalyses = styleAnalyses.filter(a => a !== null) as SeasonalAnalysis[];
  
  // Count by classification
  const breakdown = {
    core: validAnalyses.filter(a => a.recommendedClassification === 'core').length,
    seasonal: validAnalyses.filter(a => a.recommendedClassification === 'seasonal').length,
    holiday: validAnalyses.filter(a => a.recommendedClassification === 'holiday').length,
    declining: 0, // Would need YoY data
    emerging: 0,  // Would need launch date tracking
  };
  
  // Find category-wide peak months
  const monthScores: number[] = new Array(12).fill(0);
  
  for (const analysis of validAnalyses) {
    for (const month of analysis.peakMonths) {
      monthScores[month]++;
    }
  }
  
  // Peak months are those with >30% of styles peaking
  const threshold = uniqueStyles.length * 0.3;
  const peakMonths = monthScores
    .map((score, month) => ({ score, month }))
    .filter(m => m.score > threshold)
    .map(m => m.month);
  
  const offPeakMonths = monthScores
    .map((score, month) => ({ score, month }))
    .filter(m => m.score < threshold / 2)
    .map(m => m.month);
  
  // Determine profile
  let seasonalityProfile: 'stable' | 'seasonal' | 'highly_seasonal' = 'stable';
  const seasonalRatio = (breakdown.seasonal + breakdown.holiday) / validAnalyses.length;
  
  if (seasonalRatio > 0.5) seasonalityProfile = 'highly_seasonal';
  else if (seasonalRatio > 0.2) seasonalityProfile = 'seasonal';
  
  // Generate insights
  const insights: string[] = [];
  
  if (breakdown.seasonal > breakdown.core) {
    insights.push(`${category} is a seasonal category - ${Math.round(seasonalRatio * 100)}% of styles are seasonal`);
  }
  
  if (peakMonths.length > 0) {
    insights.push(`Peak selling months: ${peakMonths.map(getMonthName).join(', ')}`);
  }
  
  if (breakdown.declining > 0) {
    insights.push(`${breakdown.declining} styles showing declining sales - consider markdowns`);
  }
  
  if (breakdown.emerging > 0) {
    insights.push(`${breakdown.emerging} emerging styles - increase inventory`);
  }
  
  return {
    category,
    subcategories,
    totalStyles: uniqueStyles.length,
    totalSKUs: products.length,
    seasonalityProfile,
    peakMonths,
    offPeakMonths,
    itemBreakdown: breakdown,
    insights,
  };
}

/**
 * Compare category performance to previous year
 */
export function compareCategoryYoY(
  category: string,
  thisYearSales: DbSale[],
  lastYearSales: DbSale[]
): {
  category: string;
  growth: number;
  acceleration: boolean;
  insights: string[];
} {
  const thisYearTotal = thisYearSales.reduce((sum, s) => sum + s.units, 0);
  const lastYearTotal = lastYearSales.reduce((sum, s) => sum + s.units, 0);
  
  const growth = lastYearTotal > 0 
    ? (thisYearTotal - lastYearTotal) / lastYearTotal 
    : 0;
  
  // Compare by month to detect acceleration/deceleration
  const monthlyGrowth: number[] = [];
  
  for (let month = 0; month < 12; month++) {
    const thisMonth = thisYearSales
      .filter(s => new Date(s.sale_date).getMonth() === month)
      .reduce((sum, s) => sum + s.units, 0);
    const lastMonth = lastYearSales
      .filter(s => new Date(s.sale_date).getMonth() === month)
      .reduce((sum, s) => sum + s.units, 0);
    
    if (lastMonth > 0) {
      monthlyGrowth.push((thisMonth - lastMonth) / lastMonth);
    }
  }
  
  // Acceleration = recent months growing faster than earlier months
  const firstHalf = monthlyGrowth.slice(0, 6).filter(g => !isNaN(g));
  const secondHalf = monthlyGrowth.slice(6).filter(g => !isNaN(g));
  
  const firstAvg = firstHalf.length > 0 
    ? firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length 
    : 0;
  const secondAvg = secondHalf.length > 0 
    ? secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length 
    : 0;
  
  const acceleration = secondAvg > firstAvg;
  
  const insights: string[] = [];
  
  if (growth > 0.2) {
    insights.push(`${category} growing ${(growth * 100).toFixed(0)}% YoY - increase buys`);
  } else if (growth < -0.2) {
    insights.push(`${category} declining ${(Math.abs(growth) * 100).toFixed(0)}% YoY - reduce inventory`);
  }
  
  if (acceleration && growth > 0) {
    insights.push(`Momentum building - recent months outpacing earlier`);
  }
  
  return {
    category,
    growth,
    acceleration,
    insights,
  };
}

/**
 * Get inventory recommendations by category
 */
export function getCategoryInventoryStrategy(
  profile: CategorySeasonalProfile,
  currentMonth: number
): {
  strategy: 'aggressive' | 'normal' | 'conservative' | 'clearance';
  actions: string[];
  targetWeeksOfSupply: number;
} {
  const isPeak = profile.peakMonths.includes(currentMonth);
  const isOffPeak = profile.offPeakMonths.includes(currentMonth);
  const isApproachingPeak = profile.peakMonths.some(m => {
    const monthsUntil = (m - currentMonth + 12) % 12;
    return monthsUntil > 0 && monthsUntil <= 2;
  });
  
  const actions: string[] = [];
  let strategy: 'aggressive' | 'normal' | 'conservative' | 'clearance' = 'normal';
  let targetWeeks = 12;
  
  switch (profile.seasonalityProfile) {
    case 'highly_seasonal':
      if (isApproachingPeak) {
        strategy = 'aggressive';
        targetWeeks = 16;
        actions.push('Increase inventory 30% before peak hits');
        actions.push('Secure vendor capacity now');
      } else if (isPeak) {
        strategy = 'normal';
        targetWeeks = 10;
        actions.push('Maintain stock levels, watch sell-through');
      } else if (isOffPeak) {
        strategy = 'clearance';
        targetWeeks = 4;
        actions.push('Markdown remaining inventory');
        actions.push('Plan next season buys');
      }
      break;
      
    case 'seasonal':
      if (isApproachingPeak) {
        strategy = 'aggressive';
        targetWeeks = 14;
        actions.push('Build inventory for upcoming season');
      } else if (isOffPeak) {
        strategy = 'conservative';
        targetWeeks = 8;
        actions.push('Reduce reorders, clear slow movers');
      }
      break;
      
    case 'stable':
    default:
      if (profile.itemBreakdown.emerging > profile.itemBreakdown.declining) {
        strategy = 'aggressive';
        targetWeeks = 14;
        actions.push('Growth category - invest in depth');
      } else if (profile.itemBreakdown.declining > 0) {
        strategy = 'conservative';
        targetWeeks = 10;
        actions.push('Declining items - reduce buys');
      }
      break;
  }
  
  return {
    strategy,
    actions,
    targetWeeksOfSupply: targetWeeks,
  };
}

function getMonthName(month: number): string {
  return new Date(2000, month, 1).toLocaleString('default', { month: 'short' });
}
