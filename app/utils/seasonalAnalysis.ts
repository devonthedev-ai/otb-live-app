// utils/seasonalAnalysis.ts - Detect seasonal patterns in sales data

export interface SaleData {
  units: number;
  date: string; // ISO date string
}

export interface SeasonalAnalysis {
  productId: string;
  style: string;
  isSeasonal: boolean;
  peakMonths: number[]; // 0-11 (Jan-Dec)
  troughMonths: number[];
  seasonalityScore: number; // 0-1, higher = more seasonal
  recommendedClassification: 'core' | 'seasonal' | 'holiday';
  confidence: number;
}

/**
 * Analyze sales data to detect seasonal patterns
 */
export function analyzeSeasonalPatterns(
  style: string,
  sales: SaleData[],
  minDataPoints: number = 90 // Need at least 3 months of data
): SeasonalAnalysis | null {
  if (sales.length < minDataPoints) {
    return null;
  }

  // Group sales by month
  const monthlySales: Map<number, number> = new Map();
  const monthlyCounts: Map<number, number> = new Map();
  
  for (const sale of sales) {
    const date = new Date(sale.date);
    const month = date.getMonth(); // 0-11
    
    const current = monthlySales.get(month) || 0;
    monthlySales.set(month, current + sale.units);
    
    const count = monthlyCounts.get(month) || 0;
    monthlyCounts.set(month, count + 1);
  }

  // Calculate average daily sales per month
  const monthlyAvg: number[] = [];
  for (let month = 0; month < 12; month++) {
    const total = monthlySales.get(month) || 0;
    const days = monthlyCounts.get(month) || 1;
    monthlyAvg[month] = total / days;
  }

  // Calculate overall average
  const overallAvg = monthlyAvg.reduce((a, b) => a + b, 0) / 12;
  
  if (overallAvg === 0) {
    return null;
  }

  // Calculate seasonality score (coefficient of variation)
  const variance = monthlyAvg.reduce((sum, val) => 
    sum + Math.pow(val - overallAvg, 2), 0) / 12;
  const stdDev = Math.sqrt(variance);
  const seasonalityScore = stdDev / overallAvg;

  // Determine peak months (>20% above average)
  const peakMonths: number[] = [];
  const troughMonths: number[] = [];
  
  for (let month = 0; month < 12; month++) {
    const ratio = monthlyAvg[month] / overallAvg;
    if (ratio > 1.3) peakMonths.push(month);
    if (ratio < 0.7) troughMonths.push(month);
  }

  // Classify
  let recommendedClassification: 'core' | 'seasonal' | 'holiday' = 'core';
  
  if (seasonalityScore > 1.5) {
    recommendedClassification = 'seasonal';
  } else if (seasonalityScore > 2.5 && peakMonths.length <= 2) {
    recommendedClassification = 'holiday';
  }

  // Calculate confidence based on data coverage
  const monthsWithData = monthlySales.size;
  const confidence = Math.min(100, (monthsWithData / 12) * 100 + (sales.length / 365) * 50);

  return {
    productId: style,
    style,
    isSeasonal: seasonalityScore > 0.8,
    peakMonths,
    troughMonths,
    seasonalityScore,
    recommendedClassification,
    confidence: Math.min(100, confidence),
  };
}

/**
 * Predict upcoming season demand multiplier
 */
export function getSeasonalMultiplier(
  analysis: SeasonalAnalysis,
  targetMonth: number = new Date().getMonth()
): number {
  if (!analysis.isSeasonal || analysis.confidence < 50) {
    return 1.0;
  }

  const isPeak = analysis.peakMonths.includes(targetMonth);
  const isTrough = analysis.troughMonths.includes(targetMonth);

  if (isPeak) return 1.5; // 50% boost during peak
  if (isTrough) return 0.6; // 40% reduction during trough
  
  return 1.0;
}

/**
 * Detect year-over-year growth/decline
 */
export function detectYoYTrend(
  sales: SaleData[]
): { isGrowing: boolean; rate: number; confidence: number } {
  // Group by year-month
  const monthlyByYear: Map<string, number> = new Map();
  
  for (const sale of sales) {
    const date = new Date(sale.date);
    const key = `${date.getFullYear()}-${date.getMonth()}`;
    const current = monthlyByYear.get(key) || 0;
    monthlyByYear.set(key, current + sale.units);
  }

  const years = Array.from(new Set(Array.from(monthlyByYear.keys()).map(k => k.split('-')[0]))).sort();
  
  if (years.length < 2) {
    return { isGrowing: false, rate: 0, confidence: 0 };
  }

  // Compare same months across years
  const comparisons: number[] = [];
  
  for (let month = 0; month < 12; month++) {
    const thisYear = monthlyByYear.get(`${years[years.length - 1]}-${month}`) || 0;
    const lastYear = monthlyByYear.get(`${years[years.length - 2]}-${month}`) || 0;
    
    if (lastYear > 0) {
      comparisons.push((thisYear - lastYear) / lastYear);
    }
  }

  if (comparisons.length === 0) {
    return { isGrowing: false, rate: 0, confidence: 0 };
  }

  const avgGrowth = comparisons.reduce((a, b) => a + b, 0) / comparisons.length;
  
  return {
    isGrowing: avgGrowth > 0.05,
    rate: avgGrowth,
    confidence: Math.min(100, comparisons.length * 20),
  };
}

/**
 * Identify emerging seasonal patterns (new products)
 */
export function detectEmergingSeasonality(
  sales: SaleData[],
  productLaunchDate: Date
): { isEmerging: boolean; predictedPeak?: number; confidence: number } {
  const daysSinceLaunch = (Date.now() - productLaunchDate.getTime()) / (1000 * 60 * 60 * 24);
  
  // Need at least 30 days of data
  if (daysSinceLaunch < 30 || sales.length < 10) {
    return { isEmerging: false, confidence: 0 };
  }

  // Analyze sales trend since launch
  const salesByWeek: number[] = [];
  const weeks = Math.ceil(daysSinceLaunch / 7);
  
  for (let week = 0; week < weeks; week++) {
    const weekStart = new Date(productLaunchDate);
    weekStart.setDate(weekStart.getDate() + week * 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    
    const weekSales = sales.filter(s => {
      const date = new Date(s.date);
      return date >= weekStart && date < weekEnd;
    }).reduce((sum, s) => sum + s.units, 0);
    
    salesByWeek.push(weekSales);
  }

  // Check if sales are accelerating
  const firstHalf = salesByWeek.slice(0, Math.floor(weeks / 2)).reduce((a, b) => a + b, 0);
  const secondHalf = salesByWeek.slice(Math.floor(weeks / 2)).reduce((a, b) => a + b, 0);
  
  const isAccelerating = secondHalf > firstHalf * 1.3;
  
  return {
    isEmerging: isAccelerating,
    confidence: Math.min(100, daysSinceLaunch / 3),
  };
}

/**
 * Get season name from month
 */
export function getSeasonName(month: number): string {
  const seasons = ['Winter', 'Winter', 'Spring', 'Spring', 'Spring', 
                   'Summer', 'Summer', 'Summer', 'Fall', 'Fall', 'Fall', 'Winter'];
  return seasons[month];
}

/**
 * Calculate days until next peak season
 */
export function daysUntilPeakSeason(
  peakMonths: number[],
  fromDate: Date = new Date()
): number {
  if (peakMonths.length === 0) return 365;
  
  const currentMonth = fromDate.getMonth();
  const currentDay = fromDate.getDate();
  
  // Find next peak month
  let nextPeak = peakMonths.find(m => m > currentMonth);
  if (!nextPeak) {
    nextPeak = peakMonths[0]; // Wrap around to next year
  }
  
  const targetDate = new Date(fromDate.getFullYear(), nextPeak, 15); // Mid-month
  if (nextPeak < currentMonth) {
    targetDate.setFullYear(targetDate.getFullYear() + 1);
  }
  
  return Math.ceil((targetDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
}
