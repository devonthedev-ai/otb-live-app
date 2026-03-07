// components/CategorySeasonalView.tsx - Category-level seasonal analysis

import { CategorySeasonalProfile } from '@/app/utils/categoryAnalysis';

interface CategorySeasonalViewProps {
  profile: CategorySeasonalProfile;
}

export function CategorySeasonalView({ profile }: CategorySeasonalViewProps) {
  const profileColors: Record<string, string> = {
    stable: 'bg-green-100 text-green-700',
    seasonal: 'bg-amber-100 text-amber-700',
    highly_seasonal: 'bg-red-100 text-red-700',
  };

  const monthNames = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{profile.category}</h3>
          <p className="text-sm text-gray-500">
            {profile.totalStyles} styles · {profile.totalSKUs} SKUs
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${profileColors[profile.seasonalityProfile]}`}>
          {profile.seasonalityProfile.replace('_', ' ')}
        </span>
      </div>

      {/* Month grid */}
      <div className="mb-6">
        <p className="text-sm font-medium text-gray-700 mb-2">Seasonal Pattern</p>
        <div className="grid grid-cols-12 gap-1">
          {monthNames.map((name, month) => {
            const isPeak = profile.peakMonths.includes(month);
            const isOffPeak = profile.offPeakMonths.includes(month);
            
            return (
              <div
                key={month}
                className={`aspect-square flex items-center justify-center rounded text-xs font-medium ${
                  isPeak 
                    ? 'bg-red-500 text-white' 
                    : isOffPeak 
                    ? 'bg-gray-100 text-gray-400'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {name}
              </div>
            );
          })}
        </div>        
        <div className="flex items-center gap-4 mt-2 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-red-500 rounded"></div>
            <span>Peak</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-gray-200 rounded"></div>
            <span>Normal</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 bg-gray-100 rounded"></div>
            <span>Off-Peak</span>
          </div>
        </div>
      </div>

      {/* Item breakdown */}
      <div className="mb-4">
        <p className="text-sm font-medium text-gray-700 mb-2">Item Classifications</p>
        <div className="grid grid-cols-5 gap-2">
          {Object.entries(profile.itemBreakdown).map(([type, count]) => (
            count > 0 && (
              <div key={type} className="text-center p-2 bg-gray-50 rounded-lg">
                <p className="text-lg font-semibold text-gray-900">{count}</p>
                <p className="text-xs text-gray-500 capitalize">{type}</p>
              </div>
            )
          ))}
        </div>
      </div>

      {/* Insights */}
      {profile.insights.length > 0 && (
        <div className="space-y-2">
          {profile.insights.map((insight, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              {insight}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
