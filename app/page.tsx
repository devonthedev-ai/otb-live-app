'use client';

import { useState, useCallback, useMemo } from 'react';
import { Product, InventoryItem, SaleRecord, ReorderRecommendation } from './types';
import { parseInventoryCSV, parseSalesCSV } from './utils/csvParser';
import { calculateRecommendations } from './utils/calculations';
import { groupByVendor, calculateInventoryHealth } from './utils/advancedCalculations';
import { useLocalStorage } from './hooks/useLocalStorage';

interface Overrides {
  season: Record<string, string>;
  leadTime: Record<string, number>;
  incomingPO: Record<string, number>;
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [recommendations, setRecommendations] = useState<ReorderRecommendation[]>([]);
  const [inventoryFileName, setInventoryFileName] = useState('');
  const [salesFileName, setSalesFileName] = useState('');
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  
  const [overrides, setOverrides] = useLocalStorage<Overrides>('otb-overrides', { season: {}, leadTime: {}, incomingPO: {} });
  const [filter, setFilter] = useLocalStorage<'all' | 'critical' | 'reorder' | 'ok'>('otb-filter', 'all');
  const [sortBy, setSortBy] = useLocalStorage<'days' | 'velocity' | 'stock'>('otb-sort', 'days');
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [activeView, setActiveView] = useState<'items' | 'vendors' | 'dashboard'>('items');

  const handleInventoryUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setInventoryFileName(file.name);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseInventoryCSV(text);
      setProducts(parsed.products);
      setInventory(parsed.inventory);
      
      if (sales.length > 0) {
        recalculate(parsed.products, parsed.inventory, sales, overrides);
      }
    };
    
    reader.readAsText(file);
  }, [sales, overrides]);

  const handleSalesUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setSalesFileName(file.name);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseSalesCSV(text);
      setSales(parsed);
      
      if (products.length > 0) {
        recalculate(products, inventory, parsed, overrides);
      }
    };
    
    reader.readAsText(file);
  }, [products, inventory, overrides]);

  const recalculate = (prods: Product[], inv: InventoryItem[], salesData: SaleRecord[], over: Overrides) => {
    const adjustedProducts = prods.map(p => ({
      ...p,
      season: over.season[p.style] || p.season,
      leadTimeDays: over.leadTime[p.style] || p.leadTimeDays
    }));
    
    const adjustedInventory = inv.map(i => {
      const key = `${i.style}-${i.color}-${i.size}`;
      return { ...i, incomingQty: over.incomingPO[key] || i.incomingQty };
    });
    
    const recs = calculateRecommendations(adjustedProducts, adjustedInventory, salesData);
    setRecommendations(recs);
  };

  const handleSetSeason = (style: string, season: string) => {
    const newOverrides = { ...overrides, season: { ...overrides.season, [style]: season } };
    setOverrides(newOverrides);
    setLastSaved(new Date().toLocaleTimeString());
    recalculate(products, inventory, sales, newOverrides);
  };

  const handleSetLeadTime = (style: string, days: number) => {
    const newOverrides = { ...overrides, leadTime: { ...overrides.leadTime, [style]: days } };
    setOverrides(newOverrides);
    setLastSaved(new Date().toLocaleTimeString());
    recalculate(products, inventory, sales, newOverrides);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSetIncomingPO = (key: string, qty: number) => {
    const newOverrides = { ...overrides, incomingPO: { ...overrides.incomingPO, [key]: qty } };
    setOverrides(newOverrides);
    setLastSaved(new Date().toLocaleTimeString());
    recalculate(products, inventory, sales, newOverrides);
    setEditingItem(null);
  };

  const handleExport = () => {
    const coreRecs = recommendations.filter(r => r.isCore && r.suggestedQty > 0);
    let csv = 'Style,Color,Size,Stock,Velocity,Days Left,Suggested Qty\n';
    for (const r of coreRecs) {
      csv += `"${r.style}","${r.color}","${r.size}",${r.currentStock},${r.dailyVelocity.toFixed(2)},${r.daysUntilStockout},${r.suggestedQty}\n`;
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reorder_plan_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const filteredRecommendations = useMemo(() => {
    let filtered = recommendations.filter(r => r.isCore);
    if (filter === 'critical') filtered = filtered.filter(r => r.suggestedQty > 0 && r.daysUntilStockout < 60);
    else if (filter === 'reorder') filtered = filtered.filter(r => r.suggestedQty > 0);
    else if (filter === 'ok') filtered = filtered.filter(r => r.suggestedQty === 0);
    
    if (sortBy === 'days') filtered.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);
    else if (sortBy === 'velocity') filtered.sort((a, b) => b.dailyVelocity - a.dailyVelocity);
    else if (sortBy === 'stock') filtered.sort((a, b) => a.currentStock - b.currentStock);
    
    return filtered;
  }, [recommendations, filter, sortBy]);

  const criticalCount = recommendations.filter(r => r.isCore && r.suggestedQty > 0).length;
  const coreItems = recommendations.filter(r => r.isCore);
  const uniqueStyles = Array.from(new Set(recommendations.map(r => r.style)));
  const vendorSummaries = useMemo(() => groupByVendor(recommendations, products), [recommendations, products]);
  const health = useMemo(() => calculateInventoryHealth(recommendations, products), [recommendations, products]);

  return (
    <div className="min-h-screen bg-[#F5F5F7] font-sans">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-900">OTB Live</h1>
              <p className="text-sm text-gray-500 mt-0.5">Inventory Planning</p>
            </div>
            {lastSaved && (
              <span className="text-xs font-medium text-green-600 bg-green-50 px-3 py-1.5 rounded-full">
                Saved {lastSaved}
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Upload Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Import Data</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">Inventory CSV</label>
              <input
                type="file"
                accept=".csv"
                onChange={handleInventoryUpload}
                className="block w-full text-sm text-gray-600 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:bg-gray-100 file:text-gray-700 file:font-medium hover:file:bg-gray-200 transition-colors"
              />
              {inventoryFileName && <p className="text-xs text-green-600 mt-2 font-medium">✓ {inventoryFileName}</p>}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-700 mb-2">Sales CSV</label>
              <input
                type="file"
                accept=".csv"
                onChange={handleSalesUpload}
                className="block w-full text-sm text-gray-600 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:bg-gray-100 file:text-gray-700 file:font-medium hover:file:bg-gray-200 transition-colors"
              />
              {salesFileName && <p className="text-xs text-green-600 mt-2 font-medium">✓ {salesFileName}</p>}
            </div>
          </div>
        </div>

        {recommendations.length > 0 && (
          <>
            {/* Stats */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                <p className="text-sm font-medium text-gray-500">Total SKUs</p>
                <p className="text-3xl font-semibold text-gray-900 mt-1">{recommendations.length}</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                <p className="text-sm font-medium text-gray-500">Core Items</p>
                <p className="text-3xl font-semibold text-gray-900 mt-1">{coreItems.length}</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 border-l-4 border-l-red-500">
                <p className="text-sm font-medium text-gray-500">Need Reorder</p>
                <p className="text-3xl font-semibold text-red-600 mt-1">{criticalCount}</p>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                <p className="text-sm font-medium text-gray-500">Coverage</p>
                <p className="text-sm text-gray-700 mt-2">Lead time + 14d buffer</p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3 mb-6">
              <button
                onClick={() => setActiveView('items')}
                className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                  activeView === 'items' 
                    ? 'bg-gray-900 text-white shadow-lg' 
                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                Items
              </button>
              <button
                onClick={() => setActiveView('vendors')}
                className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                  activeView === 'vendors' 
                    ? 'bg-gray-900 text-white shadow-lg' 
                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                Vendors ({vendorSummaries.length})
              </button>
              <button
                onClick={() => setActiveView('dashboard')}
                className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all ${
                  activeView === 'dashboard' 
                    ? 'bg-gray-900 text-white shadow-lg' 
                    : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                Dashboard
              </button>
              <div className="flex-1" />
              <button
                onClick={() => setShowSettings(!showSettings)}
                className="px-5 py-2.5 rounded-full text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-all"
              >
                Settings
              </button>
              {criticalCount > 0 && (
                <button
                  onClick={handleExport}
                  className="px-5 py-2.5 rounded-full text-sm font-medium bg-blue-600 text-white shadow-lg hover:bg-blue-700 transition-all"
                >
                  Export ({criticalCount})
                </button>
              )}
            </div>

            {/* Settings Panel */}
            {showSettings && uniqueStyles.length > 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Style Settings</h3>
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 font-semibold text-gray-700">Style</th>
                        <th className="text-left py-3 font-semibold text-gray-700">Season</th>
                        <th className="text-left py-3 font-semibold text-gray-700">Lead Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uniqueStyles.slice(0, 50).map(style => (
                        <tr key={style} className="border-b border-gray-100">
                          <td className="py-3 font-medium text-gray-900">{style}</td>
                          <td className="py-3">
                            <select
                              value={overrides.season[style] || 'Core'}
                              onChange={(e) => handleSetSeason(style, e.target.value)}
                              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            >
                              <option value="Core">Core</option>
                              <option value="AW26">AW26</option>
                              <option value="SS26">SS26</option>
                              <option value="Seasonal">Seasonal</option>
                            </select>
                          </td>
                          <td className="py-3">
                            <input
                              type="number"
                              value={overrides.leadTime[style] || 90}
                              onChange={(e) => handleSetLeadTime(style, parseInt(e.target.value) || 90)}
                              className="border border-gray-200 rounded-lg px-3 py-1.5 w-20 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                            <span className="text-gray-500 ml-1">days</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Item View */}
            {activeView === 'items' && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as 'all' | 'critical' | 'reorder' | 'ok')}
                    className="border border-gray-200 rounded-lg px-4 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="all">All Items</option>
                    <option value="critical">Critical (&lt;60 days)</option>
                    <option value="reorder">Need Reorder</option>
                    <option value="ok">Stock OK</option>
                  </select>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as 'days' | 'velocity' | 'stock')}
                    className="border border-gray-200 rounded-lg px-4 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="days">Days Until Stockout</option>
                    <option value="velocity">Sales Velocity</option>
                    <option value="stock">Current Stock</option>
                  </select>
                  <span className="text-sm text-gray-500 ml-auto">
                    {filteredRecommendations.length} items
                  </span>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-gray-50/50">
                      <tr>
                        <th className="text-left py-4 px-6 font-semibold text-gray-700 text-sm">SKU</th>
                        <th className="text-right py-4 px-6 font-semibold text-gray-700 text-sm">Stock</th>
                        <th className="text-right py-4 px-6 font-semibold text-gray-700 text-sm">Daily</th>
                        <th className="text-right py-4 px-6 font-semibold text-gray-700 text-sm">Days</th>
                        <th className="text-right py-4 px-6 font-semibold text-gray-700 text-sm">Reorder</th>
                        <th className="text-left py-4 px-6 font-semibold text-gray-700 text-sm">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredRecommendations.map((rec) => {
                        const key = `${rec.style}-${rec.color}-${rec.size}`;
                        
                        return (
                          <tr key={key} className={rec.suggestedQty > 0 ? 'bg-red-50/30' : 'hover:bg-gray-50/50'}>
                            <td className="py-4 px-6">
                              <div className="font-semibold text-gray-900">{rec.style}</div>
                              <div className="text-sm text-gray-500">{rec.color} · {rec.size}</div>
                            </td>
                            <td className="py-4 px-6 text-right">
                              <span className="font-medium text-gray-900">{rec.currentStock}</span>
                            </td>
                            <td className="py-4 px-6 text-right text-gray-600">
                              {rec.dailyVelocity.toFixed(2)}
                            </td>
                            <td className="py-4 px-6 text-right">
                              <span className={`font-medium ${
                                rec.daysUntilStockout < 60 ? 'text-red-600' : 
                                rec.daysUntilStockout < 104 ? 'text-amber-600' : 'text-green-600'
                              }`}>
                                {rec.daysUntilStockout === Infinity ? '∞' : rec.daysUntilStockout}
                              </span>
                            </td>
                            <td className="py-4 px-6 text-right">
                              {rec.suggestedQty > 0 ? (
                                <span className="font-bold text-red-600">{rec.suggestedQty}</span>
                              ) : (
                                <span className="text-gray-400">—</span>
                              )}
                            </td>
                            <td className="py-4 px-6">
                              {rec.suggestedQty > 0 ? (
                                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                                  rec.daysUntilStockout < 60 
                                    ? 'bg-red-100 text-red-700' 
                                    : 'bg-amber-100 text-amber-700'
                                }`}>
                                  {rec.daysUntilStockout < 60 ? 'Critical' : 'Reorder'}
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">
                                  OK
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {/* Vendor View */}
            {activeView === 'vendors' && (
              <div className="space-y-4">
                {vendorSummaries.map((vendor) => (
                  <div key={vendor.vendor} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="px-6 py-4 bg-gray-50/50 border-b border-gray-100 flex justify-between items-center">
                      <div>
                        <h3 className="font-semibold text-gray-900">{vendor.vendor}</h3>
                        <p className="text-sm text-gray-500">{vendor.styles.length} styles · {vendor.items.length} SKUs</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-gray-900">{vendor.totalQty}</p>
                        <p className="text-sm text-gray-500">${vendor.totalCost.toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Dashboard */}
            {activeView === 'dashboard' && (
              <div className="grid grid-cols-3 gap-6">
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">Stock Status</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-red-600 font-medium">Critical</span>
                      <span className="font-bold text-2xl">{health.criticalCount}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-amber-600 font-medium">Need Reorder</span>
                      <span className="font-bold text-2xl">{health.reorderCount}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-green-600 font-medium">Stock OK</span>
                      <span className="font-bold text-2xl">{health.okCount}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">Health Metrics</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Avg Weeks Supply</span>
                      <span className="font-bold">{health.avgWeeksOfSupply}w</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Dead Stock</span>
                      <span className="font-bold text-orange-600">{health.deadStockCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Inventory Value</span>
                      <span className="font-bold">${health.totalInventoryValue.toLocaleString()}</span>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">Overview</h3>
                  <div className="space-y-3">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Total SKUs</span>
                      <span className="font-bold">{health.totalSKUs}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Core Items</span>
                      <span className="font-bold">{health.coreSKUs}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Vendors</span>
                      <span className="font-bold">{vendorSummaries.length}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
