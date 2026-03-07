// components/SeasonalBadge.tsx - Display seasonal classification

import { SeasonalRecommendation } from '@/app/utils/seasonalRecommendations';

interface SeasonalBadgeProps {
  recommendation: SeasonalRecommendation;
  compact?: boolean;
}

export function SeasonalBadge({ recommendation, compact = false }: SeasonalBadgeProps) {
  const { classification, seasonalAdjustment } = recommendation;
  
  const typeColors: Record<string, string> = {
    core: 'bg-gray-100 text-gray-700',
    seasonal: 'bg-blue-100 text-blue-700',
    holiday: 'bg-purple-100 text-purple-700',
    declining: 'bg-red-100 text-red-700',
    emerging: 'bg-green-100 text-green-700',
  };

  const typeLabels: Record<string, string> = {
    core: 'Core',
    seasonal: 'Seasonal',
    holiday: 'Holiday',
    declining: 'Declining',
    emerging: 'Emerging',
  };

  if (compact) {
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${typeColors[classification.type]}`}>
        {typeLabels[classification.type]}
        {classification.confidence >= 70 && (
          <svg className="w-3 h-3 ml-1" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        )}
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${typeColors[classification.type]}`}>
          {typeLabels[classification.type]}
        </span>
        <span className="text-xs text-gray-500">
          {classification.confidence.toFixed(0)}% confidence
        </span>
      </div>

      {classification.type === 'seasonal' && seasonalAdjustment.peakMonths.length > 0 && (
        <div className="text-xs text-gray-600">
          <span className="font-medium">Peak: </span>
          {seasonalAdjustment.peakMonths.map(m => getMonthName(m)).join(', ')}
          {seasonalAdjustment.daysUntilPeak < 90 && (
            <span className="text-amber-600 ml-1">
              (in {seasonalAdjustment.daysUntilPeak} days)
            </span>
          )}
        </div>
      )}

      {classification.type === 'declining' && (
        <div className="text-xs text-red-600">
          Consider reducing future orders
        </div>
      )}

      {classification.type === 'emerging' && (
        <div className="text-xs text-green-600">
          Growth product - monitor closely
        </div>
      )}

      {seasonalAdjustment.multiplier !== 1.0 && (
        <div className="text-xs text-gray-500">
          Demand {seasonalAdjustment.multiplier > 1 ? '+' : ''}
          {((seasonalAdjustment.multiplier - 1) * 100).toFixed(0)}% this month
        </div>
      )}
    </div>
  );
}

function getMonthName(month: number): string {
  return new Date(2000, month, 1).toLocaleString('default', { month: 'short' });
}
