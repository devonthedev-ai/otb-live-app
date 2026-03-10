'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/app/lib/supabase/client';
import { useWorkspace } from '@/app/context/WorkspaceContext';

interface ScenarioResult {
  sku: string;
  style: string;
  color: string;
  size: string;
  currentStock: number;
  additionalQty: number;
  newTotal: number;
  currentDays: number;
  newDays: number;
  investment: number;
  breakEvenDays: number;
}

export default function WhatIfTool() {
  const { currentWorkspace } = useWorkspace();
  const supabase = createClient();
  
  const [inventory, setInventory] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [additionalUnits, setAdditionalUnits] = useState(100);
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!currentWorkspace) return;
    
    const loadData = async () => {
      setLoading(true);
      
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      const [{ data: invData }, { data: salesData }] = await Promise.all([
        supabase.from('inventory_levels').select('*').eq('workspace_id', currentWorkspace.id),
        supabase.from('sales').select('*').eq('workspace_id', currentWorkspace.id).gte('sale_date', ninetyDaysAgo.toISOString().split('T')[0])
      ]);
      
      if (invData) setInventory(invData);
      if (salesData) setSales(salesData);
      setLoading(false);
    };
    
    loadData();
  }, [currentWorkspace, supabase]);

  // Group sales by SKU
  const salesBySku = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const sale of sales) {
      if (!map.has(sale.sku)) map.set(sale.sku, []);
      map.get(sale.sku)!.push(sale);
    }
    return map;
  }, [sales]);

  // Calculate scenarios
  const scenarios = useMemo<ScenarioResult[]>(() => {
    const results: ScenarioResult[] = [];
    
    for (const item of inventory) {
      const skuSales = salesBySku.get(item.sku) || [];
      const totalSales = skuSales.reduce((sum, s) => sum + s.units, 0);
      const velocity = totalSales / 90;
      
      const currentDays = velocity > 0 ? item.qty_available / velocity : 999;
      const newTotal = item.qty_available + additionalUnits;
      const newDays = velocity > 0 ? newTotal / velocity : 999;
      
      const investment = additionalUnits * (item.cost || 0);
      const profitPerUnit = (item.price || 0) - (item.cost || 0);
      const breakEvenDays = velocity > 0 && profitPerUnit > 0 
        ? investment / (velocity * profitPerUnit)
        : 999;
      
      results.push({
        sku: item.sku,
        style: item.style,
        color: item.color,
        size: item.size,
        currentStock: item.qty_available,
        additionalQty: additionalUnits,
        newTotal,
        currentDays,
        newDays,
        investment,
        breakEvenDays
      });
    }
    
    // Sort by biggest improvement in days
    return results.sort((a, b) => (b.newDays - b.currentDays) - (a.newDays - a.currentDays));
  }, [inventory, salesBySku, additionalUnits]);

  const selectedScenarios = scenarios.filter(s => selectedSkus.has(s.sku));
  
  const totals = useMemo(() => {
    const selected = selectedScenarios.length > 0 
      ? selectedScenarios 
      : scenarios.slice(0, 20); // Show top 20 by default
    
    return {
      totalInvestment: selected.reduce((sum, s) => sum + s.investment, 0),
      avgDaysAdded: selected.reduce((sum, s) => sum + (s.newDays - s.currentDays), 0) / selected.length,
      avgBreakEven: selected.reduce((sum, s) => sum + s.breakEvenDays, 0) / selected.length,
      skuCount: selected.length
    };
  }, [scenarios, selectedScenarios]);

  const toggleSelection = (sku: string) => {
    const next = new Set(selectedSkus);
    if (next.has(sku)) next.delete(sku);
    else next.add(sku);
    setSelectedSkus(next);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading scenarios...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">🔮 What-If Scenario Tool</h2>
          <p className="text-sm text-gray-500">See the impact of ordering more inventory</p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Additional Units to Order: <span className="text-2xl font-bold text-blue-600">{additionalUnits}</span>
        </label>        
        <input
          type="range"
          min="10"
          max="1000"
          step="10"
          value={additionalUnits}
          onChange={(e) => setAdditionalUnits(parseInt(e.target.value))}
          className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
        />
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>10</span>
          <span>500</span>
          <span>1000</span>
        </div>
      </div>

      {/* Impact Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-blue-50 rounded-2xl border border-blue-200 p-5">
          <p className="text-sm text-blue-600">Total Investment</p>
          <p className="text-3xl font-bold text-blue-900">${Math.round(totals.totalInvestment).toLocaleString()}</p>
          <p className="text-xs text-blue-500">{selectedScenarios.length > 0 ? `${selectedScenarios.length} SKUs selected` : 'Top 20 SKUs'}</p>
        </div>
        
        <div className="bg-green-50 rounded-2xl border border-green-200 p-5">
          <p className="text-sm text-green-600">Avg Days Added</p>
          <p className="text-3xl font-bold text-green-900">+{Math.round(totals.avgDaysAdded)}</p>
          <p className="text-xs text-green-500">per SKU</p>
        </div>
        
        <div className="bg-amber-50 rounded-2xl border border-amber-200 p-5">
          <p className="text-sm text-amber-600">Avg Break-Even</p>
          <p className="text-3xl font-bold text-amber-900">{Math.round(totals.avgBreakEven)}d</p>
          <p className="text-xs text-amber-500">to pay back investment</p>
        </div>
        
        <div className="bg-purple-50 rounded-2xl border border-purple-200 p-5">
          <p className="text-sm text-purple-600">Cash Flow Impact</p>
          <p className="text-3xl font-bold text-purple-900">-${Math.round(totals.totalInvestment).toLocaleString()}</p>
          <p className="text-xs text-purple-500">today</p>
        </div>
      </div>

      {/* Scenario Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="font-semibold text-gray-900">Scenario Results</h3>
          {selectedSkus.size > 0 && (
            <button
              onClick={() => setSelectedSkus(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Clear selection ({selectedSkus.size})
            </button>
          )}
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50/50">
              <tr>
                <th className="py-3 px-4"><input type="checkbox" checked={false} readOnly className="invisible" /></th>
                <th className="text-left py-3 px-4">SKU</th>
                <th className="text-right py-3 px-4">Current Stock</th>
                <th className="text-right py-3 px-4">Add</th>
                <th className="text-right py-3 px-4">New Total</th>
                <th className="text-right py-3 px-4">Current Days</th>
                <th className="text-right py-3 px-4">New Days</th>
                <th className="text-right py-3 px-4">Investment</th>
                <th className="text-right py-3 px-4">Break-Even</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {scenarios.slice(0, 50).map((s) => (
                <tr 
                  key={s.sku} 
                  className={`${selectedSkus.has(s.sku) ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                >
                  <td className="py-3 px-4">
                    <input
                      type="checkbox"
                      checked={selectedSkus.has(s.sku)}
                      onChange={() => toggleSelection(s.sku)}
                      className="rounded"
                    />
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium">{s.style}</div>
                    <div className="text-gray-500">{s.color} · {s.size}</div>
                  </td>
                  <td className="py-3 px-4 text-right">{s.currentStock}</td>
                  <td className="py-3 px-4 text-right text-blue-600 font-bold">+{s.additionalQty}</td>
                  <td className="py-3 px-4 text-right">{Math.round(s.newTotal)}</td>
                  <td className="py-3 px-4 text-right text-gray-600">{Math.round(s.currentDays)}d</td>
                  <td className="py-3 px-4 text-right text-green-600 font-bold">{Math.round(s.newDays)}d</td>
                  <td className="py-3 px-4 text-right">${Math.round(s.investment).toLocaleString()}</td>
                  <td className="py-3 px-4 text-right">
                    <span className={s.breakEvenDays < 90 ? 'text-green-600' : 'text-amber-600'}>
                      {Math.round(s.breakEvenDays)}d
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
