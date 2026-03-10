'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/app/lib/supabase/client';
import { useWorkspace } from '@/app/context/WorkspaceContext';

interface HealthMetrics {
  overallScore: number;
  turnScore: number;
  stockoutScore: number;
  coverageScore: number;
  velocityScore: number;
  
  totalSkus: number;
  inStockSkus: number;
  stockedOutSkus: number;
  criticalSkus: number;
  
  avgDaysOfInventory: number;
  totalInventoryValue: number;
  totalReorderValue: number;
  
  topPerformers: string[];
  needsAttention: string[];
}

export default function InventoryHealth() {
  const { currentWorkspace } = useWorkspace();
  const supabase = createClient();
  
  const [inventory, setInventory] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentWorkspace) return;
    
    const loadData = async () => {
      setLoading(true);
      
      const oneYearAgo = new Date();
      oneYearAgo.setDate(oneYearAgo.getDate() - 365);
      
      const [{ data: invData }, { data: salesData }] = await Promise.all([
        supabase.from('inventory_levels').select('*').eq('workspace_id', currentWorkspace.id),
        supabase.from('sales').select('*').eq('workspace_id', currentWorkspace.id).gte('sale_date', oneYearAgo.toISOString().split('T')[0])
      ]);
      
      if (invData) setInventory(invData);
      if (salesData) setSales(salesData);
      setLoading(false);
    };
    
    loadData();
  }, [currentWorkspace, supabase]);

  const health = useMemo<HealthMetrics>(() => {
    if (inventory.length === 0) {
      return {
        overallScore: 0,
        turnScore: 0,
        stockoutScore: 0,
        coverageScore: 0,
        velocityScore: 0,
        totalSkus: 0,
        inStockSkus: 0,
        stockedOutSkus: 0,
        criticalSkus: 0,
        avgDaysOfInventory: 0,
        totalInventoryValue: 0,
        totalReorderValue: 0,
        topPerformers: [],
        needsAttention: []
      };
    }
    
    // Group sales by SKU
    const salesBySku = new Map<string, any[]>();
    for (const sale of sales) {
      if (!salesBySku.has(sale.sku)) salesBySku.set(sale.sku, []);
      salesBySku.get(sale.sku)!.push(sale);
    }
    
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    let totalDaysOfInventory = 0;
    let totalInventoryValue = 0;
    let totalReorderValue = 0;
    let inStockCount = 0;
    let stockedOutCount = 0;
    let criticalCount = 0;
    let totalTurns = 0;
    
    const topPerformers: { sku: string; velocity: number }[] = [];
    const needsAttention: { sku: string; reason: string }[] = [];
    
    for (const item of inventory) {
      const skuSales = salesBySku.get(item.sku) || [];
      const sales90 = skuSales
        .filter(s => new Date(s.sale_date) >= ninetyDaysAgo)
        .reduce((sum, s) => sum + s.units, 0);
      
      const velocity = sales90 / 90;
      const daysOfInventory = velocity > 0 ? item.qty_available / velocity : 999;
      const inventoryValue = item.qty_available * (item.cost || 0);
      
      totalDaysOfInventory += Math.min(daysOfInventory, 365);
      totalInventoryValue += inventoryValue;
      
      // Check reorder need
      const targetStock = velocity * 90; // 90 days
      const reorderQty = Math.max(0, Math.ceil(targetStock - item.qty_available));
      totalReorderValue += reorderQty * (item.cost || 0);
      
      if (item.qty_available > 0) {
        inStockCount++;
      } else {
        stockedOutCount++;
        if (sales90 > 10) {
          needsAttention.push({ sku: `${item.style}-${item.color}-${item.size}`, reason: 'Stocked out with demand' });
        }
      }
      
      if (daysOfInventory < 30) {
        criticalCount++;
        needsAttention.push({ sku: `${item.style}-${item.color}-${item.size}`, reason: 'Critical stock level' });
      }
      
      // Inventory turn (annualized)
      const annualSales = velocity * 365;
      const turn = inventoryValue > 0 ? annualSales / (item.qty_available || 1) : 0;
      totalTurns += turn;
      
      if (velocity > 1) {
        topPerformers.push({ sku: `${item.style}-${item.color}-${item.size}`, velocity });
      }
    }
    
    // Calculate scores (0-100)
    const avgDays = totalDaysOfInventory / inventory.length;
    const coverageScore = Math.max(0, Math.min(100, 100 - ((avgDays - 60) / 60) * 100)); // Optimal ~60 days
    const stockoutScore = Math.max(0, 100 - (stockedOutCount / inventory.length) * 200); // Penalize stockouts heavily
    const avgTurn = totalTurns / inventory.length;
    const turnScore = Math.min(100, avgTurn * 20); // Higher turn = better
    const velocityScore = Math.min(100, (topPerformers.length / inventory.length) * 200);
    
    const overallScore = Math.round((coverageScore + stockoutScore + turnScore + velocityScore) / 4);
    
    topPerformers.sort((a, b) => b.velocity - a.velocity);
    needsAttention.sort((a, b) => a.reason.localeCompare(b.reason));
    
    return {
      overallScore,
      turnScore: Math.round(turnScore),
      stockoutScore: Math.round(stockoutScore),
      coverageScore: Math.round(coverageScore),
      velocityScore: Math.round(velocityScore),
      totalSkus: inventory.length,
      inStockSkus: inStockCount,
      stockedOutSkus: stockedOutCount,
      criticalSkus: criticalCount,
      avgDaysOfInventory: Math.round(avgDays),
      totalInventoryValue,
      totalReorderValue,
      topPerformers: topPerformers.slice(0, 5).map(p => p.sku),
      needsAttention: needsAttention.slice(0, 10).map(n => `${n.sku} (${n.reason})`)
    };
  }, [inventory, sales]);

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-amber-600';
    return 'text-red-600';
  };

  const getScoreBg = (score: number) => {
    if (score >= 80) return 'bg-green-100 border-green-200';
    if (score >= 60) return 'bg-amber-100 border-amber-200';
    return 'bg-red-100 border-red-200';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Calculating health score...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">🏥 Inventory Health Score</h2>
          <p className="text-sm text-gray-500">Overall assessment of your inventory performance</p>
        </div>
      </div>

      {/* Big Score */}
      <div className={`rounded-2xl border-2 p-8 text-center ${getScoreBg(health.overallScore)}`}>
        <p className="text-sm mb-2 opacity-75">Overall Health Score</p>
        <p className={`text-7xl font-bold ${getScoreColor(health.overallScore)}`}>{health.overallScore}</p>
        <p className="text-lg mt-2 opacity-75">
          {health.overallScore >= 80 ? '🌟 Excellent' : health.overallScore >= 60 ? '⚠️ Needs Improvement' : '🚨 Critical'}
        </p>
      </div>

      {/* Component Scores */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Turn Rate', score: health.turnScore, desc: 'How fast inventory sells' },
          { label: 'Stock Availability', score: health.stockoutScore, desc: 'Items in stock' },
          { label: 'Coverage', score: health.coverageScore, desc: 'Days of inventory' },
          { label: 'Velocity', score: health.velocityScore, desc: 'Sales momentum' },
        ].map((metric) => (
          <div key={metric.label} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 text-center">
            <p className="text-sm text-gray-500 mb-2">{metric.label}</p>
            <p className={`text-4xl font-bold ${getScoreColor(metric.score)}`}>{metric.score}</p>
            <p className="text-xs text-gray-400 mt-1">{metric.desc}</p>
          </div>
        ))}
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total SKUs</p>
          <p className="text-2xl font-bold text-gray-900">{health.totalSkus}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">In Stock</p>
          <p className="text-2xl font-bold text-green-600">{health.inStockSkus}</p>
          <p className="text-xs text-gray-400">{Math.round((health.inStockSkus / health.totalSkus) * 100)}%</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Stocked Out</p>
          <p className="text-2xl font-bold text-red-600">{health.stockedOutSkus}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Critical (&lt;30d)</p>
          <p className="text-2xl font-bold text-amber-600">{health.criticalSkus}</p>
        </div>
      </div>

      {/* Inventory Value */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Inventory Value</p>
          <p className="text-2xl font-bold text-gray-900">${health.totalInventoryValue.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Reorder Investment Needed</p>
          <p className="text-2xl font-bold text-red-600">${health.totalReorderValue.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Avg Days of Inventory</p>
          <p className="text-2xl font-bold text-gray-900">{health.avgDaysOfInventory}d</p>
        </div>
      </div>

      {/* Recommendations */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-green-50 rounded-2xl border border-green-200 p-6">
          <h3 className="font-semibold text-green-900 mb-4">🌟 Top Performers</h3>
          {health.topPerformers.length > 0 ? (
            <ul className="space-y-2">
              {health.topPerformers.map((sku, i) => (
                <li key={i} className="text-sm text-green-800">
                  {i + 1}. {sku}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-green-600">No top performers yet. Keep selling!</p>
          )}
        </div>

        <div className="bg-red-50 rounded-2xl border border-red-200 p-6">
          <h3 className="font-semibold text-red-900 mb-4">🚨 Needs Attention</h3>
          {health.needsAttention.length > 0 ? (
            <ul className="space-y-2">
              {health.needsAttention.map((item, i) => (
                <li key={i} className="text-sm text-red-800">
                  • {item}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-red-600">🎉 Nothing needs attention right now!</p>
          )}
        </div>
      </div>
    </div>
  );
}
