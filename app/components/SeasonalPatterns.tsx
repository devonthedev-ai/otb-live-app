'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/app/lib/supabase/client';
import { useWorkspace } from '@/app/context/WorkspaceContext';

interface SeasonalPattern {
  sku: string;
  style: string;
  color: string;
  size: string;
  peakMonths: number[];
  peakSeason: string;
  lowSeason: string;
  seasonalityScore: number; // 0-100, higher = more seasonal
  monthlyData: { month: number; units: number; avg: number }[];
  recommendation: string;
}

export default function SeasonalPatterns() {
  const { currentWorkspace } = useWorkspace();
  const supabase = createClient();
  
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPattern, setSelectedPattern] = useState<SeasonalPattern | null>(null);

  useEffect(() => {
    if (!currentWorkspace) return;
    
    const loadData = async () => {
      setLoading(true);
      
      const twoYearsAgo = new Date();
      twoYearsAgo.setDate(twoYearsAgo.getDate() - 730);
      
      const { data } = await supabase
        .from('sales')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .gte('sale_date', twoYearsAgo.toISOString().split('T')[0]);
      
      if (data) setSales(data);
      setLoading(false);
    };
    
    loadData();
  }, [currentWorkspace, supabase]);

  const patterns = useMemo<SeasonalPattern[]>(() => {
    const skuSales = new Map<string, any[]>();
    
    for (const sale of sales) {
      if (!skuSales.has(sale.sku)) skuSales.set(sale.sku, []);
      skuSales.get(sale.sku)!.push(sale);
    }
    
    const results: SeasonalPattern[] = [];
    
    for (const [sku, skuSalesList] of Array.from(skuSales)) {
      if (skuSalesList.length < 10) continue; // Need enough data
      
      // Group by month
      const monthlyUnits = new Array(12).fill(0);
      const monthlyCounts = new Array(12).fill(0);
      
      for (const sale of skuSalesList) {
        const month = new Date(sale.sale_date).getMonth();
        monthlyUnits[month] += sale.units || 0;
        monthlyCounts[month]++;
      }
      
      const totalUnits = monthlyUnits.reduce((a, b) => a + b, 0);
      const avgMonthly = totalUnits / 12;
      
      // Calculate variance to detect seasonality
      const variance = monthlyUnits.reduce((sum, units) => sum + Math.pow(units - avgMonthly, 2), 0) / 12;
      const seasonalityScore = Math.min(100, Math.round((variance / (avgMonthly + 1)) * 50));
      
      // Find peak months (above average)
      const peakMonths = monthlyUnits
        .map((units, idx) => ({ units, idx }))
        .filter(m => m.units > avgMonthly * 1.2)
        .sort((a, b) => b.units - a.units)
        .slice(0, 3)
        .map(m => m.idx);
      
      // Find low months
      const lowMonths = monthlyUnits
        .map((units, idx) => ({ units, idx }))
        .filter(m => m.units < avgMonthly * 0.5)
        .map(m => m.idx);
      
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      
      const getSeasonName = (months: number[]) => {
        if (months.length === 0) return 'Consistent';
        if (months.every(m => [11, 0, 1].includes(m))) return 'Winter';
        if (months.every(m => [2, 3, 4].includes(m))) return 'Spring';
        if (months.every(m => [5, 6, 7].includes(m))) return 'Summer';
        if (months.every(m => [8, 9, 10].includes(m))) return 'Fall';
        if (months.includes(10) || months.includes(11)) return 'Holiday';
        return months.map(m => monthNames[m]).join(', ');
      };
      
      const monthlyData = monthlyUnits.map((units, idx) => ({
        month: idx,
        units,
        avg: avgMonthly
      }));
      
      // Generate recommendation
      let recommendation = '';
      const currentMonth = new Date().getMonth();
      const monthsUntilPeak = peakMonths.length > 0 
        ? peakMonths.map(m => (m - currentMonth + 12) % 12).sort((a, b) => a - b)[0]
        : 6;
      
      if (seasonalityScore > 50) {
        if (monthsUntilPeak <= 2) {
          recommendation = `⚠️ Peak season (${getSeasonName(peakMonths)}) starting soon! Stock up now.`;
        } else if (monthsUntilPeak <= 4) {
          recommendation = `📅 Start planning for ${getSeasonName(peakMonths)} season in ${monthsUntilPeak} months.`;
        } else {
          recommendation = `📉 Low season. Reduce orders, clear excess inventory.`;
        }
      } else {
        recommendation = '✅ Steady demand. Maintain consistent stock levels.';
      }
      
      results.push({
        sku,
        style: skuSalesList[0].style,
        color: skuSalesList[0].color,
        size: skuSalesList[0].size,
        peakMonths,
        peakSeason: getSeasonName(peakMonths),
        lowSeason: getSeasonName(lowMonths),
        seasonalityScore,
        monthlyData,
        recommendation
      });
    }
    
    return results.sort((a, b) => b.seasonalityScore - a.seasonalityScore);
  }, [sales]);

  const highlySeasonal = patterns.filter(p => p.seasonalityScore > 50);
  const steady = patterns.filter(p => p.seasonalityScore <= 30);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Analyzing seasonal patterns...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">📅 Seasonal Pattern Detection</h2>
          <p className="text-sm text-gray-500">AI-powered analysis of sales cycles</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Highly Seasonal</p>
          <p className="text-3xl font-bold text-amber-600">{highlySeasonal.length}</p>
          <p className="text-xs text-gray-400">SKUs with strong seasonal patterns</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Steady Sellers</p>
          <p className="text-3xl font-bold text-green-600">{steady.length}</p>
          <p className="text-xs text-gray-400">Consistent demand year-round</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Current Season</p>
          <p className="text-2xl font-bold text-blue-600">{new Date().toLocaleDateString('en-US', { month: 'long' })}</p>
          <p className="text-xs text-gray-400">{highlySeasonal.filter(p => p.peakMonths.includes(new Date().getMonth())).length} SKUs in peak season</p>
        </div>
      </div>

      {/* Patterns List */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Detected Patterns</h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50/50">
              <tr>
                <th className="text-left py-3 px-6">SKU</th>
                <th className="text-center py-3 px-6">Seasonality</th>
                <th className="text-center py-3 px-6">Peak Season</th>
                <th className="text-left py-3 px-6">Recommendation</th>
                <th className="text-right py-3 px-6">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {patterns.slice(0, 20).map((pattern) => (
                <tr key={pattern.sku} className="hover:bg-gray-50">
                  <td className="py-3 px-6">
                    <div className="font-medium">{pattern.style}</div>
                    <div className="text-gray-500">{pattern.color} · {pattern.size}</div>
                  </td>
                  <td className="py-3 px-6 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            pattern.seasonalityScore > 70 ? 'bg-red-500' :
                            pattern.seasonalityScore > 40 ? 'bg-amber-500' : 'bg-green-500'
                          }`}
                          style={{ width: `${pattern.seasonalityScore}%` }}
                        />
                      </div>
                      <span className="text-xs">{pattern.seasonalityScore}</span>
                    </div>
                  </td>
                  <td className="py-3 px-6 text-center">
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                      pattern.peakSeason === 'Holiday' ? 'bg-red-100 text-red-700' :
                      pattern.peakSeason === 'Summer' ? 'bg-orange-100 text-orange-700' :
                      pattern.peakSeason === 'Winter' ? 'bg-blue-100 text-blue-700' :
                      pattern.peakSeason === 'Spring' ? 'bg-green-100 text-green-700' :
                      pattern.peakSeason === 'Fall' ? 'bg-amber-100 text-amber-700' :
                      'bg-gray-100 text-gray-700'
                    }`}>
                      {pattern.peakSeason}
                    </span>
                  </td>
                  <td className="py-3 px-6">
                    <p className="text-sm">{pattern.recommendation}</p>
                  </td>
                  <td className="py-3 px-6 text-right">
                    <button
                      onClick={() => setSelectedPattern(pattern)}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      View Chart
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal for detailed view */}
      {selectedPattern && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setSelectedPattern(null)}
        >
          <div 
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full mx-4 p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">
                {selectedPattern.style} - {selectedPattern.color} - {selectedPattern.size}
              </h3>
              <button onClick={() => setSelectedPattern(null)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            
            <div className="h-48 flex items-end gap-2 mb-4">
              {selectedPattern.monthlyData.map((m) => {
                const maxUnits = Math.max(...selectedPattern.monthlyData.map(d => d.units));
                const height = maxUnits > 0 ? (m.units / maxUnits) * 100 : 0;
                const isPeak = selectedPattern.peakMonths.includes(m.month);
                const isCurrent = m.month === new Date().getMonth();
                
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center">
                    <div className="w-full h-32 flex items-end">
                      <div
                        className={`w-full rounded-t transition-all ${
                          isPeak ? 'bg-red-500' : isCurrent ? 'bg-blue-500' : 'bg-gray-300'
                        }`}
                        style={{ height: `${Math.max(height, 5)}%` }}
                        title={`${m.units} units`}
                      />
                    </div>
                    <span className={`text-xs mt-1 ${isCurrent ? 'font-bold text-blue-600' : 'text-gray-500'}`}>
                      {['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'][m.month]}
                    </span>
                  </div>
                );
              })}
            </div>
            
            <div className="text-sm space-y-2">
              <p><strong>Seasonality Score:</strong> {selectedPattern.seasonalityScore}/100</p>
              <p><strong>Peak Season:</strong> {selectedPattern.peakSeason}</p>
              <p><strong>Low Season:</strong> {selectedPattern.lowSeason}</p>
              <p className="text-blue-600 font-medium mt-4">{selectedPattern.recommendation}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
