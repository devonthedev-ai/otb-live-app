'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/app/lib/supabase/client';
import { useWorkspace } from '@/app/context/WorkspaceContext';

interface StockoutItem {
  sku: string;
  style: string;
  color: string;
  size: string;
  lastSaleDate: string;
  daysSinceLastSale: number;
  estimatedStockoutDate: string;
  daysStockedOut: number;
  preStockoutVelocity: number;
  lostUnits: number;
  lostRevenue: number;
  lostProfit: number;
  annualizedLoss: number;
  currentStock: number;
  price: number;
  cost: number;
}

export default function StockoutCalculator() {
  const { currentWorkspace } = useWorkspace();
  const supabase = createClient();
  
  const [inventory, setInventory] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly' | 'annual'>('daily');

  useEffect(() => {
    if (!currentWorkspace) return;
    
    const loadData = async () => {
      setLoading(true);
      
      const oneYearAgo = new Date();
      oneYearAgo.setDate(oneYearAgo.getDate() - 365);
      
      const [{ data: invData }, { data: salesData }] = await Promise.all([
        supabase.from('inventory_levels').select('*').eq('workspace_id', currentWorkspace.id),
        supabase.from('sales').select('*').eq('workspace_id', currentWorkspace.id).gte('sale_date', oneYearAgo.toISOString().split('T')[0]).order('sale_date', { ascending: false })
      ]);
      
      if (invData) setInventory(invData);
      if (salesData) setSales(salesData);
      setLoading(false);
    };
    
    loadData();
  }, [currentWorkspace, supabase]);

  // Calculate stockout costs
  const stockoutAnalysis = useMemo(() => {
    const items: StockoutItem[] = [];
    const today = new Date();
    
    // Group sales by SKU
    const salesBySku = new Map<string, any[]>();
    for (const sale of sales) {
      if (!salesBySku.has(sale.sku)) salesBySku.set(sale.sku, []);
      salesBySku.get(sale.sku)!.push(sale);
    }
    
    for (const item of inventory) {
      // Skip items with stock
      if (item.qty_available > 0) continue;
      
      const skuSales = salesBySku.get(item.sku) || [];
      if (skuSales.length === 0) continue; // No sales history
      
      // Sort by date (newest first)
      skuSales.sort((a, b) => new Date(b.sale_date).getTime() - new Date(a.sale_date).getTime());
      
      const lastSale = skuSales[0];
      const lastSaleDate = new Date(lastSale.sale_date);
      const daysSinceLastSale = Math.floor((today.getTime() - lastSaleDate.getTime()) / (1000 * 60 * 60 * 24));
      
      // Calculate pre-stockout velocity (30 days before last sale)
      const thirtyDaysBeforeLastSale = new Date(lastSaleDate);
      thirtyDaysBeforeLastSale.setDate(thirtyDaysBeforeLastSale.getDate() - 30);
      
      const preStockoutSales = skuSales.filter(s => {
        const saleDate = new Date(s.sale_date);
        return saleDate >= thirtyDaysBeforeLastSale && saleDate <= lastSaleDate;
      });
      
      const preStockoutUnits = preStockoutSales.reduce((sum, s) => sum + (s.units || 0), 0);
      const preStockoutVelocity = preStockoutUnits / 30; // daily velocity
      
      // Estimate when stockout occurred
      // Assume stock lasted ~7 days after last sale (buffer for safety stock)
      const estimatedStockoutDate = new Date(lastSaleDate);
      estimatedStockoutDate.setDate(estimatedStockoutDate.getDate() + 7);
      
      const daysStockedOut = Math.max(0, Math.floor((today.getTime() - estimatedStockoutDate.getTime()) / (1000 * 60 * 60 * 24)));
      
      if (daysStockedOut <= 0) continue; // Not actually stocked out long enough
      
      // Calculate losses
      const lostUnits = Math.round(daysStockedOut * preStockoutVelocity);
      const price = item.price || 0;
      const cost = item.cost || 0;
      const lostRevenue = lostUnits * price;
      const lostProfit = lostUnits * (price - cost);
      
      // Annualize (if this pattern continued)
      const annualizedLoss = lostProfit * (365 / daysStockedOut);
      
      items.push({
        sku: item.sku,
        style: item.style,
        color: item.color,
        size: item.size,
        lastSaleDate: lastSale.sale_date,
        daysSinceLastSale,
        estimatedStockoutDate: estimatedStockoutDate.toISOString().split('T')[0],
        daysStockedOut,
        preStockoutVelocity,
        lostUnits,
        lostRevenue,
        lostProfit,
        annualizedLoss,
        currentStock: item.qty_available,
        price,
        cost
      });
    }
    
    return items.sort((a, b) => b.lostProfit - a.lostProfit);
  }, [inventory, sales]);

  // Totals
  const totals = useMemo(() => {
    const totalDaily = stockoutAnalysis.reduce((sum, i) => sum + (i.lostProfit / Math.max(i.daysStockedOut, 1)), 0);
    const totalWeekly = totalDaily * 7;
    const totalMonthly = totalDaily * 30;
    const totalAnnual = stockoutAnalysis.reduce((sum, i) => sum + i.annualizedLoss, 0);
    
    return {
      daily: totalDaily,
      weekly: totalWeekly,
      monthly: totalMonthly,
      annual: totalAnnual,
      totalLostRevenue: stockoutAnalysis.reduce((sum, i) => sum + i.lostRevenue, 0),
      totalLostProfit: stockoutAnalysis.reduce((sum, i) => sum + i.lostProfit, 0),
      skuCount: stockoutAnalysis.length
    };
  }, [stockoutAnalysis]);

  const currentValue = timeframe === 'daily' ? totals.daily :
                       timeframe === 'weekly' ? totals.weekly :
                       timeframe === 'monthly' ? totals.monthly : totals.annual;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Calculating stockout costs...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">💸 Stockout Cost Calculator</h2>
          <p className="text-sm text-gray-500">Money you&apos;re losing TODAY from stockouts</p>
        </div>
        <div className="flex gap-2">
          {['daily', 'weekly', 'monthly', 'annual'].map((t) => (
            <button
              key={t}
              onClick={() => setTimeframe(t as any)}
              className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                timeframe === t
                  ? 'bg-red-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Big Number */}
      <div className="bg-red-50 border-2 border-red-200 rounded-2xl p-8 text-center">
        <p className="text-red-600 font-medium mb-2">You&apos;re losing</p>
        <p className="text-6xl font-bold text-red-700 mb-2">${currentValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
        <p className="text-red-600">{timeframe === 'daily' ? 'per day' : timeframe === 'weekly' ? 'per week' : timeframe === 'monthly' ? 'per month' : 'per year'}</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">SKUs Stocked Out</p>
          <p className="text-3xl font-bold text-gray-900">{totals.skuCount}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total Lost Revenue</p>
          <p className="text-3xl font-bold text-red-600">${totals.totalLostRevenue.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total Lost Profit</p>
          <p className="text-3xl font-bold text-red-700">${totals.totalLostProfit.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Annualized Impact</p>
          <p className="text-3xl font-bold text-amber-600">${totals.annual.toLocaleString()}</p>
        </div>
      </div>

      {/* ROI Calculator */}
      {totals.totalLostProfit > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
          <h3 className="font-semibold text-blue-900 mb-3">💡 ROI Opportunity</h3>
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <p className="text-sm text-blue-600">Invest Now</p>
              <p className="text-2xl font-bold text-blue-900">${Math.round(totals.totalLostProfit * 0.5).toLocaleString()}</p>
              <p className="text-xs text-blue-500">50% of lost profit</p>
            </div>
            <div className="flex items-center justify-center">
              <span className="text-3xl">→</span>
            </div>
            <div>
              <p className="text-sm text-green-600">Save Per Year</p>
              <p className="text-2xl font-bold text-green-700">${totals.annual.toLocaleString()}</p>
              <p className="text-xs text-green-500">{Math.round((totals.annual / Math.max(totals.totalLostProfit * 0.5, 1)) * 100)}% ROI</p>
            </div>
          </div>
        </div>
      )}

      {/* Detailed Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">Stockout Details</h3>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50/50">
              <tr>
                <th className="text-left py-3 px-6">SKU</th>
                <th className="text-center py-3 px-6">Last Sale</th>
                <th className="text-center py-3 px-6">Days Out</th>
                <th className="text-right py-3 px-6">Velocity</th>
                <th className="text-right py-3 px-6">Lost Units</th>
                <th className="text-right py-3 px-6">Lost Revenue</th>
                <th className="text-right py-3 px-6">Lost Profit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stockoutAnalysis.slice(0, 50).map((item) => (
                <tr key={item.sku} className="hover:bg-gray-50">
                  <td className="py-3 px-6">
                    <div className="font-medium">{item.style}</div>
                    <div className="text-gray-500">{item.color} · {item.size}</div>
                  </td>
                  <td className="py-3 px-6 text-center">
                    {new Date(item.lastSaleDate).toLocaleDateString()}
                  </td>
                  <td className="py-3 px-6 text-center">
                    <span className="font-bold text-red-600">{item.daysStockedOut}</span>
                  </td>
                  <td className="py-3 px-6 text-right">{item.preStockoutVelocity.toFixed(1)}/day</td>
                  <td className="py-3 px-6 text-right">{item.lostUnits}</td>
                  <td className="py-3 px-6 text-right text-gray-600">${item.lostRevenue.toLocaleString()}</td>
                  <td className="py-3 px-6 text-right font-bold text-red-600">${item.lostProfit.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {stockoutAnalysis.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            🎉 No stockouts detected! All items have inventory.
          </div>
        )}
      </div>
    </div>
  );
}
