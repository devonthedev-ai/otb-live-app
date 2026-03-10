'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/app/lib/supabase/client';
import { useWorkspace } from '@/app/context/WorkspaceContext';

interface MonthlyData {
  month: string;
  monthLabel: string;
  totalUnits: number;
  totalRevenue: number;
  skuCount: number;
  uniqueStyles: number;
}

interface TrendData {
  sku: string;
  style: string;
  color: string;
  size: string;
  monthlySales: MonthlyData[];
  totalSales: number;
  avgMonthlySales: number;
  peakMonth: string;
  trendDirection: 'up' | 'down' | 'stable';
}

export default function TrendsView() {
  const { currentWorkspace } = useWorkspace();
  const supabase = createClient();
  
  const [sales, setSales] = useState<any[]>([]);
  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'overview' | 'detail'>('overview');

  useEffect(() => {
    if (!currentWorkspace) return;
    
    const loadData = async () => {
      setLoading(true);
      
      const oneYearAgo = new Date();
      oneYearAgo.setDate(oneYearAgo.getDate() - 365);
      
      const [{ data: salesData }, { data: invData }] = await Promise.all([
        supabase
          .from('sales')
          .select('*')
          .eq('workspace_id', currentWorkspace.id)
          .gte('sale_date', oneYearAgo.toISOString().split('T')[0])
          .order('sale_date', { ascending: true }),
        supabase
          .from('inventory_levels')
          .select('*')
          .eq('workspace_id', currentWorkspace.id)
      ]);
      
      if (salesData) setSales(salesData);
      if (invData) setInventory(invData);
      setLoading(false);
    };
    
    loadData();
  }, [currentWorkspace, supabase]);

  // Calculate monthly overview data
  const monthlyOverview = useMemo(() => {
    const months = new Map<string, MonthlyData>();
    
    for (const sale of sales) {
      const date = new Date(sale.sale_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const monthLabel = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      
      if (!months.has(monthKey)) {
        months.set(monthKey, {
          month: monthKey,
          monthLabel,
          totalUnits: 0,
          totalRevenue: 0,
          skuCount: 0,
          uniqueStyles: 0
        });
      }
      
      const month = months.get(monthKey)!;
      month.totalUnits += sale.units || 0;
      month.totalRevenue += sale.net_sales || 0;
    }
    
    // Count unique SKUs per month
    const skusByMonth = new Map<string, Set<string>>();
    const stylesByMonth = new Map<string, Set<string>>();
    
    for (const sale of sales) {
      const date = new Date(sale.sale_date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!skusByMonth.has(monthKey)) skusByMonth.set(monthKey, new Set());
      if (!stylesByMonth.has(monthKey)) stylesByMonth.set(monthKey, new Set());
      
      skusByMonth.get(monthKey)!.add(sale.sku);
      stylesByMonth.get(monthKey)!.add(sale.style);
    }
    
    for (const [monthKey, skus] of Array.from(skusByMonth)) {
      const month = months.get(monthKey);
      if (month) {
        month.skuCount = skus.size;
        month.uniqueStyles = stylesByMonth.get(monthKey)?.size || 0;
      }
    }
    
    return Array.from(months.values()).sort((a, b) => a.month.localeCompare(b.month));
  }, [sales]);

  // Calculate trends per SKU
  const skuTrends = useMemo<TrendData[]>(() => {
    const trends = new Map<string, TrendData>();
    
    // Group sales by SKU
    const salesBySku = new Map<string, any[]>();
    for (const sale of sales) {
      if (!salesBySku.has(sale.sku)) salesBySku.set(sale.sku, []);
      salesBySku.get(sale.sku)!.push(sale);
    }
    
    for (const [sku, skuSales] of Array.from(salesBySku)) {
      const monthlyData = new Map<string, MonthlyData>();
      
      for (const sale of skuSales) {
        const date = new Date(sale.sale_date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const monthLabel = date.toLocaleDateString('en-US', { month: 'short' });
        
        if (!monthlyData.has(monthKey)) {
          monthlyData.set(monthKey, {
            month: monthKey,
            monthLabel,
            totalUnits: 0,
            totalRevenue: 0,
            skuCount: 1,
            uniqueStyles: 1
          });
        }
        
        const month = monthlyData.get(monthKey)!;
        month.totalUnits += sale.units || 0;
        month.totalRevenue += sale.net_sales || 0;
      }
      
      const monthlySales = Array.from(monthlyData.values()).sort((a, b) => a.month.localeCompare(b.month));
      const totalSales = monthlySales.reduce((sum, m) => sum + m.totalUnits, 0);
      const avgMonthlySales = totalSales / 12;
      
      // Find peak month
      const peakMonth = monthlySales.reduce((max, m) => m.totalUnits > max.totalUnits ? m : max, monthlySales[0] || { monthLabel: '-' });
      
      // Calculate trend direction (compare first 6 months to last 6 months)
      const first6 = monthlySales.slice(0, 6).reduce((sum, m) => sum + m.totalUnits, 0);
      const last6 = monthlySales.slice(-6).reduce((sum, m) => sum + m.totalUnits, 0);
      
      let trendDirection: 'up' | 'down' | 'stable' = 'stable';
      if (first6 > 0) {
        const change = (last6 - first6) / first6;
        if (change > 0.2) trendDirection = 'up';
        else if (change < -0.2) trendDirection = 'down';
      }
      
      const inv = inventory.find(i => i.sku === sku);
      
      trends.set(sku, {
        sku,
        style: skuSales[0]?.style || '',
        color: skuSales[0]?.color || '',
        size: skuSales[0]?.size || '',
        monthlySales,
        totalSales,
        avgMonthlySales,
        peakMonth: peakMonth?.monthLabel || '-',
        trendDirection
      });
    }
    
    return Array.from(trends.values()).sort((a, b) => b.totalSales - a.totalSales);
  }, [sales, inventory]);

  // Selected SKU detail
  const selectedTrend = selectedSku ? skuTrends.find(t => t.sku === selectedSku) : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading trends...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Historical Trends</h2>
        <div className="flex gap-2">
          <button
            onClick={() => { setViewMode('overview'); setSelectedSku(null); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'overview' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setViewMode('detail')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'detail' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            SKU Detail
          </button>
        </div>
      </div>

      {/* Overview Mode */}
      {viewMode === 'overview' && (
        <>
          {/* Monthly Sales Chart */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Monthly Sales Volume (Last 12 Months)</h3>
            
            <div className="h-64 flex items-end gap-2">
              {monthlyOverview.map((month, i) => {
                const maxUnits = Math.max(...monthlyOverview.map(m => m.totalUnits));
                const height = maxUnits > 0 ? (month.totalUnits / maxUnits) * 100 : 0;
                
                return (
                  <div key={month.month} className="flex-1 flex flex-col items-center gap-2">
                    <div className="w-full relative">
                      <div 
                        className="w-full bg-blue-500 rounded-t-lg transition-all duration-300 hover:bg-blue-600"
                        style={{ height: `${height}%`, minHeight: '4px' }}
                        title={`${month.monthLabel}: ${month.totalUnits} units`}
                      />
                    </div>
                    <span className="text-xs text-gray-500">{month.monthLabel}</span>
                    <span className="text-xs font-medium text-gray-700">{month.totalUnits}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <p className="text-sm text-gray-500">Total Units (12mo)</p>
              <p className="text-3xl font-bold text-gray-900">{monthlyOverview.reduce((sum, m) => sum + m.totalUnits, 0).toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <p className="text-sm text-gray-500">Total Revenue</p>
              <p className="text-3xl font-bold text-gray-900">${monthlyOverview.reduce((sum, m) => sum + m.totalRevenue, 0).toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <p className="text-sm text-gray-500">Avg Monthly Units</p>
              <p className="text-3xl font-bold text-gray-900">{Math.round(monthlyOverview.reduce((sum, m) => sum + m.totalUnits, 0) / 12).toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
              <p className="text-sm text-gray-500">Peak Month</p>
              <p className="text-3xl font-bold text-gray-900">{monthlyOverview.reduce((max, m) => m.totalUnits > max.totalUnits ? m : max, monthlyOverview[0] || { monthLabel: '-' }).monthLabel}</p>
            </div>
          </div>

          {/* Top Trending SKUs */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Top 10 SKUs by Sales Volume</h3>
            
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4">SKU</th>
                    <th className="text-right py-3 px-4">Total Units</th>
                    <th className="text-right py-3 px-4">Avg/Month</th>
                    <th className="text-center py-3 px-4">Peak Month</th>
                    <th className="text-center py-3 px-4">Trend</th>
                    <th className="text-right py-3 px-4">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {skuTrends.slice(0, 10).map(trend => (
                    <tr key={trend.sku} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <div className="font-medium">{trend.style}</div>
                        <div className="text-gray-500">{trend.color} · {trend.size}</div>
                      </td>
                      <td className="py-3 px-4 text-right font-medium">{trend.totalSales}</td>
                      <td className="py-3 px-4 text-right">{trend.avgMonthlySales.toFixed(1)}</td>
                      <td className="py-3 px-4 text-center">{trend.peakMonth}</td>
                      <td className="py-3 px-4 text-center">
                        {trend.trendDirection === 'up' && <span className="text-green-600 font-bold">↑ Rising</span>}
                        {trend.trendDirection === 'down' && <span className="text-red-600 font-bold">↓ Declining</span>}
                        {trend.trendDirection === 'stable' && <span className="text-gray-400">→ Stable</span>}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => { setSelectedSku(trend.sku); setViewMode('detail'); }}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Detail Mode */}
      {viewMode === 'detail' && (
        <div className="space-y-6">
          {!selectedSku && (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 text-center">
              <p className="text-gray-500">Select a SKU to view detailed trends</p>
              <div className="mt-4 max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <tbody>
                    {skuTrends.map(trend => (
                      <tr 
                        key={trend.sku} 
                        className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer"
                        onClick={() => setSelectedSku(trend.sku)}
                      >
                        <td className="py-3 px-4">{trend.style}-{trend.color}-{trend.size}</td>
                        <td className="py-3 px-4 text-right">{trend.totalSales} units</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          
          {selectedTrend && (
            <>
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setSelectedSku(null)}
                  className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                >
                  ← Back to list
                </button>
                <h3 className="text-lg font-semibold">{selectedTrend.style} - {selectedTrend.color} - {selectedTrend.size}</h3>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                <h4 className="text-sm font-medium text-gray-500 mb-4">Monthly Sales Trend</h4>
                
                <div className="h-48 flex items-end gap-3">
                  {selectedTrend.monthlySales.map((month, i) => {
                    const maxUnits = Math.max(...selectedTrend.monthlySales.map(m => m.totalUnits));
                    const height = maxUnits > 0 ? (month.totalUnits / maxUnits) * 100 : 0;
                    
                    return (
                      <div key={month.month} className="flex-1 flex flex-col items-center gap-1">
                        <div className="w-full relative h-32 flex items-end">
                          <div 
                            className="w-full bg-blue-500 rounded-t transition-all duration-300"
                            style={{ height: `${height}%`, minHeight: '2px' }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">{month.monthLabel}</span>
                        <span className="text-xs font-medium">{month.totalUnits}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                  <p className="text-sm text-gray-500">Total Units (12mo)</p>
                  <p className="text-2xl font-bold">{selectedTrend.totalSales}</p>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                  <p className="text-sm text-gray-500">Avg/Month</p>
                  <p className="text-2xl font-bold">{selectedTrend.avgMonthlySales.toFixed(1)}</p>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                  <p className="text-sm text-gray-500">Peak Month</p>
                  <p className="text-2xl font-bold">{selectedTrend.peakMonth}</p>
                </div>
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                  <p className="text-sm text-gray-500">Trend</p>
                  <p className={`text-2xl font-bold ${
                    selectedTrend.trendDirection === 'up' ? 'text-green-600' :
                    selectedTrend.trendDirection === 'down' ? 'text-red-600' : 'text-gray-600'
                  }`}>
                    {selectedTrend.trendDirection === 'up' && '↑ Rising'}
                    {selectedTrend.trendDirection === 'down' && '↓ Declining'}
                    {selectedTrend.trendDirection === 'stable' && '→ Stable'}
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
