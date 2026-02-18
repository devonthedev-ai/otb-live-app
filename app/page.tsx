'use client';

import { useState, useCallback, useMemo } from 'react';
import { Product, InventoryItem, SaleRecord, ReorderRecommendation } from './types';
import { parseInventoryCSV, parseSalesCSV } from './utils/csvParser';
import { calculateRecommendations } from './utils/calculations';

// Manual overrides storage
interface Overrides {
  season: Record<string, string>; // key: style, value: season
  leadTime: Record<string, number>; // key: style, value: days
  incomingPO: Record<string, number>; // key: style-color-size, value: qty
}

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [recommendations, setRecommendations] = useState<ReorderRecommendation[]>([]);
  const [inventoryFileName, setInventoryFileName] = useState('');
  const [salesFileName, setSalesFileName] = useState('');
  const [debug, setDebug] = useState<{invCount: number, salesCount: number, sampleInv: string, sampleSales: string} | null>(null);
  
  // UI State
  const [overrides, setOverrides] = useState<Overrides>({ season: {}, leadTime: {}, incomingPO: {} });
  const [filter, setFilter] = useState<'all' | 'critical' | 'reorder' | 'ok'>('all');
  const [sortBy, setSortBy] = useState<'days' | 'velocity' | 'stock'>('days');
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

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
      
      const sampleInv = parsed.inventory.slice(0, 3).map(i => `${i.style}-${i.color}-${i.size}`).join(', ');
      setDebug(prev => ({...(prev || {salesCount: 0, sampleSales: ''}), invCount: parsed.inventory.length, sampleInv}));
      
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
      
      const sampleSales = parsed.slice(0, 3).map(s => `${s.style}-${s.color}-${s.size}`).join(', ');
      setDebug(prev => ({...(prev || {invCount: 0, sampleInv: ''}), salesCount: parsed.length, sampleSales}));
      
      if (products.length > 0) {
        recalculate(products, inventory, parsed, overrides);
      }
    };
    
    reader.readAsText(file);
  }, [products, inventory, overrides]);

  const recalculate = (prods: Product[], inv: InventoryItem[], salesData: SaleRecord[], over: Overrides) => {
    // Apply overrides to products
    const adjustedProducts = prods.map(p => ({
      ...p,
      season: over.season[p.style] || p.season,
      leadTimeDays: over.leadTime[p.style] || p.leadTimeDays
    }));
    
    // Apply overrides to inventory (incoming PO)
    const adjustedInventory = inv.map(i => {
      const key = `${i.style}-${i.color}-${i.size}`;
      return {
        ...i,
        incomingQty: over.incomingPO[key] || i.incomingQty
      };
    });
    
    const recs = calculateRecommendations(adjustedProducts, adjustedInventory, salesData);
    setRecommendations(recs);
  };

  const handleSetSeason = (style: string, season: string) => {
    const newOverrides = {
      ...overrides,
      season: { ...overrides.season, [style]: season }
    };
    setOverrides(newOverrides);
    recalculate(products, inventory, sales, newOverrides);
  };

  const handleSetLeadTime = (style: string, days: number) => {
    const newOverrides = {
      ...overrides,
      leadTime: { ...overrides.leadTime, [style]: days }
    };
    setOverrides(newOverrides);
    recalculate(products, inventory, sales, newOverrides);
  };

  const handleSetIncomingPO = (key: string, qty: number) => {
    const newOverrides = {
      ...overrides,
      incomingPO: { ...overrides.incomingPO, [key]: qty }
    };
    setOverrides(newOverrides);
    recalculate(products, inventory, sales, newOverrides);
    setEditingItem(null);
  };

  const handleExport = () => {
    const coreRecs = recommendations.filter(r => r.isCore && r.suggestedQty > 0);
    
    let csv = 'Style,Color,Size,Current Stock,Incoming PO,Available,Daily Velocity,Days Until Stockout,Suggested Qty,Reason,Vendor\n';
    for (const r of coreRecs) {
      const product = products.find(p => p.style === r.style && p.color === r.color && p.size === r.size);
      csv += `"${r.style}","${r.color}","${r.size}",${r.currentStock},${product?.vendor || ''},${r.currentStock},${r.dailyVelocity.toFixed(2)},${r.daysUntilStockout},${r.suggestedQty},"${r.reason}"\n`;
    }
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reorder_plan_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // Filter and sort recommendations
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

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">OTB Live</h1>
          <p className="text-gray-600">Open-to-Buy Inventory Planning for ApparelMagic</p>
        </header>

        {/* Upload Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Upload Data</h2>
          
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Current Inventory CSV
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={handleInventoryUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {inventoryFileName && (
                <p className="text-sm text-green-600 mt-1">✓ {inventoryFileName}</p>
              )}
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Sales History CSV
              </label>
              <input
                type="file"
                accept=".csv"
                onChange={handleSalesUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {salesFileName && (
                <p className="text-sm text-green-600 mt-1">✓ {salesFileName}</p>
              )}
            </div>
          </div>
          
          <div className="mt-4 flex gap-4">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              {showSettings ? 'Hide' : 'Show'} Settings
            </button>
            
            {recommendations.length > 0 && (
              <button
                onClick={handleExport}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Export Reorder Plan ({criticalCount} items)
              </button>
            )}
          </div>
        </div>

        {/* Settings Panel */}
        {showSettings && uniqueStyles.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold mb-4">Settings ({uniqueStyles.length} styles)</h2>
            
            <div className="overflow-x-auto max-h-96">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left">Style</th>
                    <th className="px-4 py-2 text-left">Season</th>
                    <th className="px-4 py-2 text-left">Lead Time</th>
                  </tr>
                </thead>
                <tbody>
                  {uniqueStyles.slice(0, 50).map(style => (
                    <tr key={style}>
                      <td className="px-4 py-2 font-medium">{style}</td>
                      <td className="px-4 py-2">
                        <select
                          value={overrides.season[style] || 'Core'}
                          onChange={(e) => handleSetSeason(style, e.target.value)}
                          className="border rounded px-2 py-1"
                        >
                          <option value="Core">Core</option>
                          <option value="AW26">AW26</option>
                          <option value="SS26">SS26</option>
                          <option value="Seasonal">Seasonal</option>
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <input
                          type="number"
                          value={overrides.leadTime[style] || 90}
                          onChange={(e) => handleSetLeadTime(style, parseInt(e.target.value) || 90)}
                          className="border rounded px-2 py-1 w-20"
                        />
                        days
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Debug Info */}
        {debug && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <h3 className="font-semibold text-yellow-800 mb-2">Debug Info</h3>
            <div className="text-sm text-yellow-800">
              <p>Inventory items parsed: {debug.invCount}</p>
              <p>Sales records parsed: {debug.salesCount}</p>
              <p>Sample inventory keys: {debug.sampleInv || 'N/A'}</p>
              <p>Sample sales keys: {debug.sampleSales || 'N/A'}</p>
            </div>
          </div>
        )}

        {/* Summary Stats */}
        {recommendations.length > 0 && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-gray-600">Total SKUs</p>
              <p className="text-2xl font-bold">{recommendations.length}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-gray-600">Core Items</p>
              <p className="text-2xl font-bold">{coreItems.length}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4 border-l-4 border-red-500">
              <p className="text-sm text-gray-600">Need Reorder</p>
              <p className="text-2xl font-bold text-red-600">{criticalCount}</p>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <p className="text-sm text-gray-600">Coverage</p>
              <p className="text-sm">90d lead + 14d buffer</p>
            </div>
          </div>
        )}

        {/* Filters */}
        {recommendations.length > 0 && (
          <div className="bg-white rounded-lg shadow p-4 mb-6 flex gap-4 items-center">
            <div>
              <label className="text-sm font-medium text-gray-700 mr-2">Filter:</label>
              <select
                value={filter}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setFilter(e.target.value as 'all' | 'critical' | 'reorder' | 'ok')}
                className="border rounded px-3 py-2"
              >
                <option value="all">All Core Items</option>
                <option value="critical">Critical (&lt;60 days)</option>
                <option value="reorder">All Need Reorder</option>
                <option value="ok">Stock OK</option>
              </select>
            </div>
            
            <div>
              <label className="text-sm font-medium text-gray-700 mr-2">Sort by:</label>
              <select
                value={sortBy}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSortBy(e.target.value as 'days' | 'velocity' | 'stock')}
                className="border rounded px-3 py-2"
              >
                <option value="days">Days Until Stockout</option>
                <option value="velocity">Sales Velocity</option>
                <option value="stock">Current Stock</option>
              </select>
            </div>
            
            <div className="ml-auto text-sm text-gray-600">
              Showing {filteredRecommendations.length} of {coreItems.length} Core items
            </div>
          </div>
        )}

        {/* Action List */}
        {filteredRecommendations.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Stock</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Incoming PO</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Daily Sales</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Days Left</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Reorder Qty</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredRecommendations.map((rec) => {
                    const key = `${rec.style}-${rec.color}-${rec.size}`;
                    const incoming = overrides.incomingPO[key] || 0;
                    
                    return (
                    <tr key={key} className={rec.suggestedQty > 0 ? 'bg-red-50' : ''}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{rec.style}</div>
                        <div className="text-sm text-gray-500">{rec.color} / {rec.size}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                          Core
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm text-gray-900">{rec.currentStock}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        {editingItem === key ? (
                          <input
                            type="number"
                            defaultValue={incoming}
                            onBlur={(e) => handleSetIncomingPO(key, parseInt(e.target.value) || 0)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSetIncomingPO(key, parseInt((e.target as HTMLInputElement).value) || 0)}
                            className="w-16 border rounded px-2 py-1 text-right"
                            autoFocus
                          />
                        ) : (
                          <button
                            onClick={() => setEditingItem(key)}
                            className="text-sm text-blue-600 hover:text-blue-800"
                          >
                            {incoming || '—'}
                          </button>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className="text-sm text-gray-900">{rec.dailyVelocity.toFixed(2)}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        <span className={`text-sm font-medium ${
                          rec.daysUntilStockout < 60 ? 'text-red-600' : 
                          rec.daysUntilStockout < 104 ? 'text-yellow-600' : 'text-green-600'
                        }`}>
                          {rec.daysUntilStockout === Infinity ? '∞' : rec.daysUntilStockout}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right">
                        {rec.suggestedQty > 0 ? (
                          <span className="text-sm font-bold text-red-600">{rec.suggestedQty}</span>
                        ) : (
                          <span className="text-sm text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {rec.suggestedQty > 0 ? (
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            rec.daysUntilStockout < 60 ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {rec.daysUntilStockout < 60 ? 'CRITICAL' : 'Reorder'}
                          </span>
                        ) : (
                          <span className="px-2 py-1 text-xs rounded-full bg-green-100 text-green-800">
                            OK
                          </span>
                        )}
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
