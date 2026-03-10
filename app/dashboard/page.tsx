'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/app/lib/supabase/client';
import { useAuth } from '@/app/context/AuthContext';
import { useWorkspace } from '@/app/context/WorkspaceContext';
import { Sidebar } from '@/app/components/Sidebar';

interface InventoryItem {
  sku: string;
  style: string;
  color: string;
  size: string;
  qty_on_hand: number;
  qty_available: number;
  cost: number;
  price: number;
}

interface SalesItem {
  sku: string;
  style: string;
  color: string;
  size: string;
  units: number;
  net_sales: number;
  sale_date: string;
}

interface OTBRecommendation {
  sku: string;
  style: string;
  color: string;
  size: string;
  currentStock: number;
  availableStock: number;
  avgDailySales: number;
  daysOfInventory: number;
  daysUntilStockout: number;
  suggestedReorder: number;
  reorderValue: number;
  velocityTrend: 'up' | 'down' | 'stable';
}

export default function Dashboard() {
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const supabase = createClient();
  
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sales, setSales] = useState<SalesItem[]>([]);
  const [recommendations, setRecommendations] = useState<OTBRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<{inventory?: string, sales?: string}>({});
  const [filter, setFilter] = useState<'all' | 'reorder' | 'critical'>('all');
  const [sortBy, setSortBy] = useState<'days' | 'velocity' | 'stock'>('days');

  // Load data from database
  useEffect(() => {
    if (!currentWorkspace) return;
    
    const loadData = async () => {
      setLoading(true);
      
      // Load inventory
      const { data: invData, error: invError } = await supabase
        .from('inventory_levels')
        .select('*')
        .eq('workspace_id', currentWorkspace.id);
      
      if (invError) console.error('Inventory error:', invError);
      
      // Load sales (last 90 days)
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .gte('sale_date', ninetyDaysAgo.toISOString().split('T')[0]);
      
      if (salesError) console.error('Sales error:', salesError);
      
      // Load sync timestamps
      const { data: syncData } = await supabase
        .from('apparelmagic_connections')
        .select('last_inventory_sync, last_sales_sync')
        .eq('workspace_id', currentWorkspace.id)
        .single();
      
      if (syncData) {
        setLastSync({
          inventory: syncData.last_inventory_sync,
          sales: syncData.last_sales_sync
        });
      }
      
      if (invData) setInventory(invData);
      if (salesData) setSales(salesData);
      
      setLoading(false);
    };
    
    loadData();
  }, [currentWorkspace, supabase]);

  // Calculate OTB recommendations
  useEffect(() => {
    if (inventory.length === 0 || sales.length === 0) return;
    
    // Calculate velocity by SKU
    const velocityBySku = new Map<string, { units: number; days: number; trend: 'up' | 'down' | 'stable' }>();
    
    // Group sales by SKU
    const salesBySku = new Map<string, SalesItem[]>();
    for (const sale of sales) {
      const key = `${sale.style}-${sale.color}-${sale.size}`;
      if (!salesBySku.has(key)) salesBySku.set(key, []);
      salesBySku.get(key)!.push(sale);
    }
    
    // Calculate for each inventory item
    const recs: OTBRecommendation[] = [];
    
    for (const item of inventory) {
      const skuSales = salesBySku.get(item.sku) || [];
      const totalUnits = skuSales.reduce((sum, s) => sum + (s.units || 0), 0);
      
      // Days with sales (to calculate true velocity)
      const salesDays = new Set(skuSales.map(s => s.sale_date)).size;
      const avgDailySales = salesDays > 0 ? totalUnits / 90 : 0; // 90-day average
      
      // Calculate trend (compare first 45 days to last 45 days)
      const midPoint = new Date();
      midPoint.setDate(midPoint.getDate() - 45);
      const firstHalf = skuSales.filter(s => new Date(s.sale_date) < midPoint).reduce((sum, s) => sum + s.units, 0);
      const secondHalf = skuSales.filter(s => new Date(s.sale_date) >= midPoint).reduce((sum, s) => sum + s.units, 0);
      
      let trend: 'up' | 'down' | 'stable' = 'stable';
      if (firstHalf > 0) {
        const change = (secondHalf - firstHalf) / firstHalf;
        if (change > 0.2) trend = 'up';
        else if (change < -0.2) trend = 'down';
      }
      
      // Days until stockout
      const daysUntilStockout = avgDailySales > 0 
        ? Math.floor(item.qty_available / avgDailySales)
        : 999;
      
      // Suggested reorder (cover 120 days)
      const leadTime = 60; // Default 60 days
      const safetyStock = avgDailySales * 30; // 30 days safety
      const targetStock = avgDailySales * (leadTime + 30); // Lead time + 30 days sell
      const suggestedReorder = Math.max(0, Math.ceil(targetStock - item.qty_available));
      
      recs.push({
        sku: item.sku,
        style: item.style,
        color: item.color,
        size: item.size,
        currentStock: item.qty_on_hand,
        availableStock: item.qty_available,
        avgDailySales,
        daysOfInventory: daysUntilStockout,
        daysUntilStockout,
        suggestedReorder,
        reorderValue: suggestedReorder * (item.cost || 0),
        velocityTrend: trend
      });
    }
    
    setRecommendations(recs);
  }, [inventory, sales]);

  // Filter and sort
  const filteredRecs = recommendations
    .filter(r => {
      if (filter === 'reorder') return r.suggestedReorder > 0;
      if (filter === 'critical') return r.daysUntilStockout < 60;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'days') return a.daysUntilStockout - b.daysUntilStockout;
      if (sortBy === 'velocity') return b.avgDailySales - a.avgDailySales;
      return a.currentStock - b.currentStock;
    });

  // Stats
  const totalSkus = recommendations.length;
  const needReorder = recommendations.filter(r => r.suggestedReorder > 0).length;
  const critical = recommendations.filter(r => r.daysUntilStockout < 60).length;
  const totalReorderValue = recommendations.reduce((sum, r) => sum + r.reorderValue, 0);

  if (loading) {
    return (
      <div className="flex min-h-screen bg-[#F5F5F7]">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Loading inventory data...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#F5F5F7]">
      <Sidebar />
      <div className="flex-1">
        {/* Header */}
        <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-50">
          <div className="max-w-6xl mx-auto px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">OTB Dashboard</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  {inventory.length} SKUs · Last sync: {lastSync.inventory ? new Date(lastSync.inventory).toLocaleDateString() : 'Never'}
                </p>
              </div>
              <div className="flex gap-3">
                {lastSync.inventory && (
                  <span className="text-xs text-green-600 bg-green-50 px-3 py-1.5 rounded-full">
                    Inventory: {new Date(lastSync.inventory).toLocaleTimeString()}
                  </span>
                )}
                {lastSync.sales && (
                  <span className="text-xs text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full">
                    Sales: {new Date(lastSync.sales).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-8 py-8">
          {/* Stats Cards */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
              <p className="text-sm font-medium text-gray-500">Total SKUs</p>
              <p className="text-3xl font-semibold text-gray-900 mt-1">{totalSkus}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
              <p className="text-sm font-medium text-gray-500">Need Reorder</p>
              <p className="text-3xl font-semibold text-red-600 mt-1">{needReorder}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
              <p className="text-sm font-medium text-gray-500">Critical (&lt;60 days)</p>
              <p className="text-3xl font-semibold text-amber-600 mt-1">{critical}</p>
            </div>
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
              <p className="text-sm font-medium text-gray-500">Reorder Value</p>
              <p className="text-3xl font-semibold text-gray-900 mt-1">${totalReorderValue.toLocaleString()}</p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
            <div className="flex gap-3">
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as 'all' | 'reorder' | 'critical')}
                className="border border-gray-200 rounded-lg px-4 py-2 text-sm"
              >
                <option value="all">All Items</option>
                <option value="reorder">Need Reorder</option>
                <option value="critical">Critical</option>
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'days' | 'velocity' | 'stock')}
                className="border border-gray-200 rounded-lg px-4 py-2 text-sm"
              >
                <option value="days">Days Until Stockout</option>
                <option value="velocity">Sales Velocity</option>
                <option value="stock">Current Stock</option>
              </select>
            </div>
            <span className="text-sm text-gray-500">{filteredRecs.length} items shown</span>
          </div>

          {/* Data Table */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50/50">
                <tr>
                  <th className="text-left py-4 px-6 font-semibold text-gray-700">SKU</th>
                  <th className="text-right py-4 px-6 font-semibold text-gray-700">Stock</th>
                  <th className="text-right py-4 px-6 font-semibold text-gray-700">Daily Sales</th>
                  <th className="text-right py-4 px-6 font-semibold text-gray-700">Days Left</th>
                  <th className="text-right py-4 px-6 font-semibold text-gray-700">Reorder Qty</th>
                  <th className="text-right py-4 px-6 font-semibold text-gray-700">Value</th>
                  <th className="text-center py-4 px-6 font-semibold text-gray-700">Trend</th>
                  <th className="text-left py-4 px-6 font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRecs.map((rec) => (
                  <tr key={rec.sku} className={rec.suggestedReorder > 0 ? 'bg-red-50/30' : 'hover:bg-gray-50/50'}>
                    <td className="py-4 px-6">
                      <div className="font-medium text-gray-900">{rec.style}</div>
                      <div className="text-gray-500">{rec.color} · {rec.size}</div>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <span className="font-medium">{rec.currentStock}</span>
                      <span className="text-gray-400 text-xs block">{rec.availableStock} avail</span>
                    </td>
                    <td className="py-4 px-6 text-right text-gray-600">
                      {rec.avgDailySales.toFixed(2)}
                    </td>
                    <td className="py-4 px-6 text-right">
                      <span className={`font-medium ${
                        rec.daysUntilStockout < 60 ? 'text-red-600' : 
                        rec.daysUntilStockout < 120 ? 'text-amber-600' : 'text-green-600'
                      }`}>
                        {rec.daysUntilStockout === 999 ? '∞' : rec.daysUntilStockout}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      {rec.suggestedReorder > 0 ? (
                        <span className="font-bold text-red-600">{rec.suggestedReorder}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right text-gray-600">
                      ${rec.reorderValue.toLocaleString()}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {rec.velocityTrend === 'up' && <span className="text-green-600 font-bold">↑</span>}
                      {rec.velocityTrend === 'down' && <span className="text-red-600 font-bold">↓</span>}
                      {rec.velocityTrend === 'stable' && <span className="text-gray-400">→</span>}
                    </td>
                    <td className="py-4 px-6">
                      {rec.daysUntilStockout < 60 ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">
                          Critical
                        </span>
                      ) : rec.suggestedReorder > 0 ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">
                          Reorder
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            
            {filteredRecs.length === 0 && (
              <div className="text-center py-12 text-gray-500">
                {recommendations.length === 0 
                  ? 'No data yet. Sync inventory and sales from ApparelMagic.'
                  : 'No items match the current filter.'}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
