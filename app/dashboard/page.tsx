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

interface ProductSetting {
  sku: string;
  lead_time_days: number;
  moq: number;
  moq_amount: number | null;
  vendor_name: string | null;
  safety_stock_days: number;
  is_manual_lead_time: boolean;
  is_manual_moq: boolean;
  workspace_id?: string;
  style?: string;
  color?: string;
  size?: string;
}

interface OTBRecommendation {
  sku: string;
  style: string;
  color: string;
  size: string;
  currentStock: number;
  availableStock: number;
  avgDailySales: number;
  daysUntilStockout: number;
  leadTimeDays: number;
  moq: number;
  safetyStockDays: number;
  suggestedReorder: number;
  reorderValue: number;
  velocityTrend: 'up' | 'down' | 'stable';
  vendorName: string | null;
  lastSaleDate: string | null;
  isStockedOut: boolean;
  stockoutOpportunity: boolean;
  velocitySource: 'recent' | 'extended' | 'estimated';
  totalSales90Days: number;
  totalSales365Days: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const supabase = createClient();
  
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sales, setSales] = useState<SalesItem[]>([]);
  const [settings, setSettings] = useState<Map<string, ProductSetting>>(new Map());
  const [recommendations, setRecommendations] = useState<OTBRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState<{inventory?: string, sales?: string}>({});
  const [filter, setFilter] = useState<'all' | 'reorder' | 'critical' | 'stockout'>('all');
  const [sortBy, setSortBy] = useState<'days' | 'velocity' | 'stock'>('days');
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<ProductSetting>>({});
  const [showSettings, setShowSettings] = useState(false);

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
      
      // Load ALL sales history (365 days) for stockout detection
      const oneYearAgo = new Date();
      oneYearAgo.setDate(oneYearAgo.getDate() - 365);
      
      const { data: salesData, error: salesError } = await supabase
        .from('sales')
        .select('*')
        .eq('workspace_id', currentWorkspace.id)
        .gte('sale_date', oneYearAgo.toISOString().split('T')[0])
        .order('sale_date', { ascending: false });
      
      if (salesError) console.error('Sales error:', salesError);
      
      // Load product settings
      const { data: settingsData, error: settingsError } = await supabase
        .from('product_settings')
        .select('*')
        .eq('workspace_id', currentWorkspace.id);
      
      if (settingsError) console.error('Settings error:', settingsError);
      
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
      
      // Convert settings to map
      if (settingsData) {
        const settingsMap = new Map<string, ProductSetting>();
        for (const s of settingsData) {
          settingsMap.set(s.sku, s);
        }
        setSettings(settingsMap);
      }
      
      setLoading(false);
    };
    
    loadData();
  }, [currentWorkspace, supabase]);

  // Calculate OTB recommendations
  useEffect(() => {
    if (inventory.length === 0) return;
    
    // Group sales by SKU
    const salesBySku = new Map<string, SalesItem[]>();
    for (const sale of sales) {
      const key = `${sale.style}-${sale.color}-${sale.size}`;
      if (!salesBySku.has(key)) salesBySku.set(key, []);
      salesBySku.get(key)!.push(sale);
    }
    
    const recs: OTBRecommendation[] = [];
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    for (const item of inventory) {
      const skuSales = salesBySku.get(item.sku) || [];
      
      // Split into recent (90d) and extended (365d)
      const recentSales = skuSales.filter(s => new Date(s.sale_date) >= ninetyDaysAgo);
      const totalSales90 = recentSales.reduce((sum, s) => sum + (s.units || 0), 0);
      const totalSales365 = skuSales.reduce((sum, s) => sum + (s.units || 0), 0);
      
      // Determine velocity source and calculate daily sales
      let avgDailySales = 0;
      let velocitySource: 'recent' | 'extended' | 'estimated' = 'recent';
      
      if (totalSales90 > 0) {
        avgDailySales = totalSales90 / 90;
        velocitySource = 'recent';
      } else if (totalSales365 > 0) {
        avgDailySales = totalSales365 / 365;
        velocitySource = 'extended';
      } else {
        avgDailySales = 0;
        velocitySource = 'estimated';
      }
      
      const lastSaleDate = skuSales.length > 0 ? skuSales[0].sale_date : null;
      const isStockedOut = item.qty_available <= 0 && totalSales365 > 0;
      const stockoutOpportunity = isStockedOut && (totalSales90 > 10 || totalSales365 > 50);
      
      // Calculate trend
      let trend: 'up' | 'down' | 'stable' = 'stable';
      if (recentSales.length > 10) {
        const midPoint = new Date();
        midPoint.setDate(midPoint.getDate() - 45);
        const firstHalf = recentSales.filter(s => new Date(s.sale_date) < midPoint).reduce((sum, s) => sum + s.units, 0);
        const secondHalf = recentSales.filter(s => new Date(s.sale_date) >= midPoint).reduce((sum, s) => sum + s.units, 0);
        
        if (firstHalf > 0) {
          const change = (secondHalf - firstHalf) / firstHalf;
          if (change > 0.2) trend = 'up';
          else if (change < -0.2) trend = 'down';
        }
      }
      
      const setting = settings.get(item.sku);
      const leadTimeDays = setting?.lead_time_days || 60;
      const moq = setting?.moq || 1;
      const safetyStockDays = setting?.safety_stock_days || 14;
      
      const daysUntilStockout = avgDailySales > 0 
        ? Math.floor(item.qty_available / avgDailySales)
        : 999;
      
      // Restock multiplier for stocked out items
      const restockMultiplier = isStockedOut ? 1.5 : 1;
      const targetStock = avgDailySales * (leadTimeDays + safetyStockDays) * restockMultiplier;
      let suggestedReorder = Math.max(0, Math.ceil(targetStock - item.qty_available));
      
      if (suggestedReorder > 0 && moq > 1) {
        suggestedReorder = Math.ceil(suggestedReorder / moq) * moq;
      }
      
      recs.push({
        sku: item.sku,
        style: item.style,
        color: item.color,
        size: item.size,
        currentStock: item.qty_on_hand,
        availableStock: item.qty_available,
        avgDailySales,
        daysUntilStockout,
        leadTimeDays,
        moq,
        safetyStockDays,
        suggestedReorder,
        reorderValue: suggestedReorder * (item.cost || 0),
        velocityTrend: trend,
        vendorName: setting?.vendor_name || null,
        lastSaleDate,
        isStockedOut,
        stockoutOpportunity,
        velocitySource,
        totalSales90Days: totalSales90,
        totalSales365Days: totalSales365,
      });
    }
    
    setRecommendations(recs);
  }, [inventory, sales, settings]);

  // Save settings
  const saveSettings = async () => {
    if (!currentWorkspace || !editingSku) return;
    
    const rec = recommendations.find(r => r.sku === editingSku);
    if (!rec) return;
    
    const newSetting: Partial<ProductSetting> = {
      ...editForm,
      workspace_id: currentWorkspace.id,
      sku: editingSku,
      style: rec.style,
      color: rec.color,
      size: rec.size,
    };
    
    const { error } = await supabase
      .from('product_settings')
      .upsert(newSetting, { onConflict: 'workspace_id,sku' });
    
    if (error) {
      console.error('Save error:', error);
      alert('Failed to save settings');
      return;
    }
    
    setSettings(prev => {
      const next = new Map(prev);
      next.set(editingSku, { ...prev.get(editingSku), ...editForm } as ProductSetting);
      return next;
    });
    
    setEditingSku(null);
  };

  const openEdit = (rec: OTBRecommendation) => {
    setEditingSku(rec.sku);
    const existing = settings.get(rec.sku);
    setEditForm({
      lead_time_days: existing?.lead_time_days || rec.leadTimeDays,
      moq: existing?.moq || rec.moq,
      moq_amount: existing?.moq_amount || null,
      vendor_name: existing?.vendor_name || rec.vendorName || '',
      safety_stock_days: existing?.safety_stock_days || rec.safetyStockDays,
      is_manual_lead_time: true,
      is_manual_moq: true,
    });
  };

  // Filter and sort
  const filteredRecs = recommendations
    .filter(r => {
      if (filter === 'reorder') return r.suggestedReorder > 0;
      if (filter === 'critical') return r.daysUntilStockout < 60;
      if (filter === 'stockout') return r.stockoutOpportunity;
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
  const stockoutOpportunities = recommendations.filter(r => r.stockoutOpportunity).length;
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
        <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">OTB Dashboard</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                  {inventory.length} SKUs · Last sync: {lastSync.inventory ? new Date(lastSync.inventory).toLocaleDateString() : 'Never'}
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  {showSettings ? 'Hide Settings' : 'Bulk Edit'}
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-8 py-8">
          {/* Stats Cards */}
          <div className="grid grid-cols-5 gap-4 mb-8">
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
              <p className="text-sm font-medium text-gray-500">Stockout Opps</p>
              <p className="text-3xl font-semibold text-purple-600 mt-1">{stockoutOpportunities}</p>
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
                onChange={(e) => setFilter(e.target.value as 'all' | 'reorder' | 'critical' | 'stockout')}
                className="border border-gray-200 rounded-lg px-4 py-2 text-sm"
              >
                <option value="all">All Items</option>
                <option value="reorder">Need Reorder</option>
                <option value="critical">Critical</option>
                <option value="stockout">🔥 Stockout Opportunities</option>
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
                  <th className="text-left py-4 px-6 font-semibold text-gray-700">Vendor</th>
                  <th className="text-right py-4 px-6 font-semibold text-gray-700">Stock</th>
                  <th className="text-right py-4 px-6 font-semibold text-gray-700">Daily Sales</th>
                  <th className="text-center py-4 px-6 font-semibold text-gray-700">Source</th>
                  <th className="text-right py-4 px-6 font-semibold text-gray-700">Last Sale</th>
                  <th className="text-right py-4 px-6 font-semibold text-gray-700">Reorder</th>
                  <th className="text-center py-4 px-6 font-semibold text-gray-700">Trend</th>
                  <th className="text-left py-4 px-6 font-semibold text-gray-700">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredRecs.map((rec) => (
                  <tr 
                    key={rec.sku} 
                    className={`${rec.suggestedReorder > 0 ? 'bg-red-50/30' : 'hover:bg-gray-50/50'} cursor-pointer`}
                    onClick={() => openEdit(rec)}
                  >
                    <td className="py-4 px-6">
                      <div className="font-medium text-gray-900">{rec.style}</div>
                      <div className="text-gray-500">{rec.color} · {rec.size}</div>
                    </td>
                    <td className="py-4 px-6 text-gray-600">{rec.vendorName || '—'}</td>
                    <td className="py-4 px-6 text-right">
                      <span className={`font-medium ${rec.isStockedOut ? 'text-red-600' : ''}`}>
                        {rec.currentStock}
                      </span>
                      <span className="text-gray-400 text-xs block">{rec.availableStock} avail</span>
                    </td>
                    <td className="py-4 px-6 text-right text-gray-600">
                      {rec.avgDailySales.toFixed(2)}
                    </td>
                    <td className="py-4 px-6 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full ${
                        rec.velocitySource === 'recent' ? 'bg-green-100 text-green-700' :
                        rec.velocitySource === 'extended' ? 'bg-amber-100 text-amber-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {rec.velocitySource === 'recent' ? '90d' : 
                         rec.velocitySource === 'extended' ? '365d' : 'est'}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      {rec.lastSaleDate ? (
                        <span className="text-gray-600">
                          {new Date(rec.lastSaleDate).toLocaleDateString()}
                        </span>
                      ) : (
                        <span className="text-gray-400">Never</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-right">
                      {rec.suggestedReorder > 0 ? (
                        <span className="font-bold text-red-600">{rec.suggestedReorder}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="py-4 px-6 text-center">
                      {rec.velocityTrend === 'up' && <span className="text-green-600 font-bold">↑</span>}
                      {rec.velocityTrend === 'down' && <span className="text-red-600 font-bold">↓</span>}
                      {rec.velocityTrend === 'stable' && <span className="text-gray-400">→</span>}
                    </td>
                    <td className="py-4 px-6">
                      {rec.stockoutOpportunity ? (
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">
                          🔥 Stockout Opp
                        </span>
                      ) : rec.daysUntilStockout < 60 ? (
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

      {/* Edit Modal */}
      {editingSku && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setEditingSku(null)}
        >
          <div 
            className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold">Edit Settings</h3>
              <button 
                onClick={() => setEditingSku(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vendor Name</label>
                <input
                  type="text"
                  value={editForm.vendor_name || ''}
                  onChange={(e) => setEditForm({...editForm, vendor_name: e.target.value})}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="e.g., Vendor Inc."
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Lead Time (days)</label>
                  <input
                    type="number"
                    value={editForm.lead_time_days || 60}
                    onChange={(e) => setEditForm({...editForm, lead_time_days: parseInt(e.target.value) || 60})}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">MOQ</label>
                  <input
                    type="number"
                    value={editForm.moq || 1}
                    onChange={(e) => setEditForm({...editForm, moq: parseInt(e.target.value) || 1})}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Safety Stock (days)</label>
                  <input
                    type="number"
                    value={editForm.safety_stock_days || 14}
                    onChange={(e) => setEditForm({...editForm, safety_stock_days: parseInt(e.target.value) || 14})}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">MOQ $ Amount (optional)</label>
                  <input
                    type="number"
                    value={editForm.moq_amount || ''}
                    onChange={(e) => setEditForm({...editForm, moq_amount: e.target.value ? parseFloat(e.target.value) : null})}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                    placeholder="Min order $"
                  />
                </div>
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setEditingSku(null)}
                className="flex-1 px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={saveSettings}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
