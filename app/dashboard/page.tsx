'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { Product, InventoryItem, SaleRecord, ReorderRecommendation, SizeCurveItem } from '@/app/types';
import { parseInventoryCSV, parseSalesCSV } from '@/app/utils/csvParser';
import { calculateRecommendations } from '@/app/utils/calculations';
import { groupByVendor, calculateInventoryHealth } from '@/app/utils/advancedCalculations';
import { generateStyleColorSizeCurve } from '@/app/utils/sizeCurves';
import { generatePODraft, downloadPO } from '@/app/utils/poExport';
import { enhanceWithSmartProjections } from '@/app/utils/smartProjections';
import { useLocalStorage } from '@/app/hooks/useLocalStorage';
import { useAuth } from '@/app/context/AuthContext';
import { useWorkspace } from '@/app/context/WorkspaceContext';
import { Sidebar } from '@/app/components/Sidebar';
import { createClient } from '@/app/lib/supabase/client';
import { 
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ShieldCheckIcon,
  CubeIcon
} from '@heroicons/react/24/outline';

interface Overrides {
  season: Record<string, string>;
  leadTime: Record<string, number>;
  incomingPO: Record<string, number>;
}

export default function Dashboard() {
  const { user, signOut } = useAuth();
  const { currentWorkspace, workspaces, setCurrentWorkspace } = useWorkspace();
  
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
  
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [activeView, setActiveView] = useState<'items' | 'vendors' | 'dashboard' | 'categories'>('items');
  
  // Size Curve Modal State
  const [sizeCurveModal, setSizeCurveModal] = useState<{
    open: boolean;
    style: string;
    color: string;
    totalQty: number;
    curve: SizeCurveItem[];
  }>({ open: false, style: '', color: '', totalQty: 0, curve: [] });

  const supabase = createClient();

  // Load products from database on mount
  useEffect(() => {
    if (!currentWorkspace) {
      console.log('No current workspace, skipping product load');
      return;
    }
    
    const loadProducts = async () => {
      console.log('Loading products for workspace:', currentWorkspace.id);
      try {
        const { data, error } = await supabase
          .from('products')
          .select('*')
          .eq('workspace_id', currentWorkspace.id)
          .order('created_at', { ascending: false });
        
        if (error) {
          console.error('Error loading products:', error);
          return;
        }
        
        console.log('Products query result:', { count: data?.length });
        
        if (data && data.length > 0) {
          // Convert DB format to app format
          const appProducts: Product[] = data.map(p => ({
            sku: p.sku || p.style,
            style: p.style,
            color: p.color,
            size: p.size,
            category: p.category || '',
            cost: p.cost || 0,
            season: p.season || 'Core',
            leadTimeDays: p.lead_time_days || 90,
            vendor: p.vendor || '',
          }));
          console.log('Setting products:', appProducts.length);
          setProducts(appProducts);
        } else {
          console.log('No products found in database');
        }
      } catch (err) {
        console.error('Exception loading products:', err);
      }
    };
    
    loadProducts();
  }, [currentWorkspace, supabase]);

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
    
    const baseRecs = calculateRecommendations(adjustedProducts, adjustedInventory, salesData);
    
    // Enhance with smart projections (trends, volatility, confidence)
    const enhancedRecs = enhanceWithSmartProjections(baseRecs, salesData);
    
    setRecommendations(enhancedRecs);
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

  const handleSetIncomingPO = (key: string, qty: number) => {
    const newOverrides = { ...overrides, incomingPO: { ...overrides.incomingPO, [key]: qty } };
    setOverrides(newOverrides);
    setLastSaved(new Date().toLocaleTimeString());
    recalculate(products, inventory, sales, newOverrides);
    setEditingItem(null);
  };

  // Open size curve modal
  const openSizeCurve = (style: string, color: string, totalQty: number) => {
    const curve = generateStyleColorSizeCurve(style, color, totalQty, sales);
    setSizeCurveModal({ open: true, style, color, totalQty, curve });
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
  const _health = health;

  // === ROLLUP CALCULATIONS ===
  
  // Group by Style-Color for reorder rollups
  const styleColorRollups = useMemo(() => {
    const groups = new Map<string, { 
      style: string; 
      color: string; 
      sizes: ReorderRecommendation[];
      totalReorder: number;
      avgConfidence: number;
      trend: string;
    }>();
    
    for (const rec of recommendations.filter(r => r.isCore && r.suggestedQty > 0)) {
      const key = `${rec.style}-${rec.color}`;
      const existing = groups.get(key);
      
      if (existing) {
        existing.sizes.push(rec);
        existing.totalReorder += rec.suggestedQty;
      } else {
        groups.set(key, {
          style: rec.style,
          color: rec.color,
          sizes: [rec],
          totalReorder: rec.suggestedQty,
          avgConfidence: rec.confidence || 50,
          trend: rec.trend || 'stable'
        });
      }
    }
    
    // Calculate averages
    for (const group of Array.from(groups.values())) {
      group.avgConfidence = group.sizes.reduce((sum, s) => sum + (s.confidence || 50), 0) / group.sizes.length;
    }
    
    return Array.from(groups.values()).sort((a, b) => b.totalReorder - a.totalReorder);
  }, [recommendations]);
  
  // Group by Style only (highest level rollup)
  const styleRollups = useMemo(() => {
    const groups = new Map<string, {
      style: string;
      colors: string[];
      totalReorder: number;
      totalSKUs: number;
      criticalCount: number;
    }>();
    
    for (const rec of recommendations.filter(r => r.isCore)) {
      const existing = groups.get(rec.style);
      
      if (existing) {
        existing.totalReorder += rec.suggestedQty;
        if (rec.suggestedQty > 0) existing.criticalCount++;
        if (!existing.colors.includes(rec.color)) existing.colors.push(rec.color);
      } else {
        groups.set(rec.style, {
          style: rec.style,
          colors: [rec.color],
          totalReorder: rec.suggestedQty,
          totalSKUs: 1,
          criticalCount: rec.suggestedQty > 0 ? 1 : 0
        });
      }
    }
    
    return Array.from(groups.values())
      .map(g => ({ ...g, totalSKUs: recommendations.filter(r => r.style === g.style).length }))
      .sort((a, b) => b.totalReorder - a.totalReorder);
  }, [recommendations]);
  
  // Category rollups (when we have category data)
  const categoryRollups = useMemo(() => {
    const cats = new Map<string, {
      category: string;
      styles: Set<string>;
      totalSKUs: number;
      reorderCount: number;
      totalValue: number;
    }>();
    
    for (const rec of recommendations) {
      const prod = products.find(p => p.style === rec.style);
      const category = prod?.category || 'Uncategorized';
      
      const existing = cats.get(category);
      if (existing) {
        existing.styles.add(rec.style);
        existing.totalSKUs++;
        if (rec.suggestedQty > 0) existing.reorderCount++;
        existing.totalValue += rec.currentStock * (prod?.cost || 0);
      } else {
        cats.set(category, {
          category,
          styles: new Set([rec.style]),
          totalSKUs: 1,
          reorderCount: rec.suggestedQty > 0 ? 1 : 0,
          totalValue: rec.currentStock * (prod?.cost || 0)
        });
      }
    }
    
    return Array.from(cats.values())
      .map(c => ({ ...c, styles: c.styles.size }))
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [recommendations, products]);

  return (
    <div className="flex min-h-screen bg-[#F5F5F7]">
      <Sidebar />
      <div className="flex-1">
        {/* Apple-style Header */}
        <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 sticky top-0 z-50">
          <div className="max-w-5xl mx-auto px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Inventory</h1>
                <p className="text-sm text-gray-500 mt-0.5">Plan and manage your stock</p>
              </div>
              
              <div className="flex items-center gap-3">
                {lastSaved && (
                  <span className="flex items-center gap-1.5 text-sm text-green-600 bg-green-50/80 backdrop-blur-sm px-3 py-1.5 rounded-full border border-green-100">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    {lastSaved}
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-5xl mx-auto px-8 py-8">
        {/* Upload Section - Apple Style */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Import Data</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="relative">
              <label className="block text-sm font-medium text-gray-600 mb-2">Inventory CSV</label>
              <input
                type="file"
                accept=".csv"
                onChange={handleInventoryUpload}
                className="block w-full text-sm text-gray-600 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:bg-gray-100 file:text-gray-700 file:font-medium hover:file:bg-gray-200 transition-all"
              />
              {inventoryFileName && <p className="text-xs text-green-600 mt-2 font-medium">✓ {inventoryFileName}</p>}
            </div>
            <div className="relative">
              <label className="block text-sm font-medium text-gray-600 mb-2">Sales CSV</label>
              <input
                type="file"
                accept=".csv"
                onChange={handleSalesUpload}
                className="block w-full text-sm text-gray-600 file:mr-4 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:bg-gray-100 file:text-gray-700 file:font-medium hover:file:bg-gray-200 transition-all"
              />
              {salesFileName && <p className="text-xs text-green-600 mt-2 font-medium">✓ {salesFileName}</p>}
            </div>
          </div>
        </div>

        {recommendations.length > 0 && (
          <>
            {/* Stats - Apple Style */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5 hover:shadow-md transition-shadow duration-200">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Total SKUs</p>
                    <p className="text-3xl font-semibold text-gray-900 mt-1">{recommendations.length}</p>
                  </div>
                  <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                    <CubeIcon className="h-5 w-5 text-blue-600 flex-shrink-0" style={{ width: '20px', height: '20px' }} />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5 hover:shadow-md transition-shadow duration-200">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Core Items</p>
                    <p className="text-3xl font-semibold text-gray-900 mt-1">{coreItems.length}</p>
                  </div>
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                    <CheckCircleIcon className="h-5 w-5 text-indigo-600 flex-shrink-0" style={{ width: '20px', height: '20px' }} />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5 hover:shadow-md transition-shadow duration-200">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Need Reorder</p>
                    <p className="text-3xl font-semibold text-red-600 mt-1">{criticalCount}</p>
                  </div>
                  <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center">
                    <ExclamationTriangleIcon className="h-5 w-5 text-red-600 flex-shrink-0" style={{ width: '20px', height: '20px' }} />
                  </div>
                </div>
                {criticalCount > 0 && (
                  <p className="text-xs text-red-600 mt-2 font-medium">Action required</p>
                )}
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5 hover:shadow-md transition-shadow duration-200">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Coverage</p>
                    <p className="text-sm text-gray-600 mt-2">Lead time + 14d</p>
                  </div>
                  <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
                    <ShieldCheckIcon className="h-5 w-5 text-green-600 flex-shrink-0" style={{ width: '20px', height: '20px' }} />
                  </div>
                </div>
              </div>
            </div>

            {/* Raw Products View (when loaded from DB) */}
            {(() => {
              console.log('Rendering products section, products.length:', products.length);
              return products.length > 0 ? (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-6 mb-8">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Products ({products.length})
                  </h3>
                <p className="text-sm text-gray-500 mb-4">
                  Upload inventory and sales CSV files to calculate reorder recommendations.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50/50">
                      <tr>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">SKU</th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Style</th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Color</th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Size</th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Category</th>
                        <th className="text-right py-3 px-4 font-semibold text-gray-700">Cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {products.slice(0, 20).map((p, i) => (
                        <tr key={i} className="hover:bg-gray-50/50">
                          <td className="py-3 px-4 text-gray-900">{p.sku}</td>
                          <td className="py-3 px-4 text-gray-600">{p.style}</td>
                          <td className="py-3 px-4 text-gray-600">{p.color}</td>
                          <td className="py-3 px-4 text-gray-600">{p.size}</td>
                          <td className="py-3 px-4 text-gray-600">{p.category}</td>
                          <td className="py-3 px-4 text-right text-gray-900">${p.cost?.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {products.length > 20 && (
                    <p className="text-sm text-gray-500 mt-4 text-center">
                      Showing 20 of {products.length} products
                    </p>
                  )}
                </div>
              </div>
              ) : null;
            })()}

            {/* Controls */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setActiveView('items')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeView === 'items' 
                      ? 'bg-indigo-600 text-white shadow-sm' 
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Items
                </button>
                <button
                  onClick={() => setActiveView('vendors')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeView === 'vendors' 
                      ? 'bg-indigo-600 text-white shadow-sm' 
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Vendors ({vendorSummaries.length})
                </button>
                <button
                  onClick={() => setActiveView('categories')}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    activeView === 'categories' 
                      ? 'bg-indigo-600 text-white shadow-sm' 
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Categories
                </button>
              </div>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSettings(!showSettings)}
                  className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  Settings
                </button>
                {criticalCount > 0 && (
                  <button
                    onClick={handleExport}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 shadow-sm transition-colors"
                  >
                    Export ({criticalCount})
                  </button>
                )}
              </div>
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

            {/* Show products from database when no recommendations yet */}
            {products.length > 0 && recommendations.length === 0 && (
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">
                  Products from ApparelMagic ({products.length})
                </h3>
                <p className="text-sm text-gray-500 mb-4">
                  Upload inventory and sales CSV files to calculate reorder recommendations.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50/50">
                      <tr>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">SKU</th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Style</th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Color</th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Size</th>
                        <th className="text-right py-3 px-4 font-semibold text-gray-700">Cost</th>
                        <th className="text-left py-3 px-4 font-semibold text-gray-700">Category</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.slice(0, 20).map((p) => (
                        <tr key={p.sku} className="border-t border-gray-100">
                          <td className="py-3 px-4 font-medium text-gray-900">{p.sku}</td>
                          <td className="py-3 px-4 text-gray-600">{p.style}</td>
                          <td className="py-3 px-4 text-gray-600">{p.color}</td>
                          <td className="py-3 px-4 text-gray-600">{p.size}</td>
                          <td className="py-3 px-4 text-right text-gray-600">${p.cost?.toFixed(2)}</td>
                          <td className="py-3 px-4 text-gray-600">{p.category}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {products.length > 20 && (
                    <p className="text-sm text-gray-500 text-center py-3">
                      ... and {products.length - 20} more products
                    </p>
                  )}
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
                        <th className="text-center py-4 px-6 font-semibold text-gray-700 text-sm">Trend</th>
                        <th className="text-center py-4 px-6 font-semibold text-gray-700 text-sm">Conf</th>
                        <th className="text-left py-4 px-6 font-semibold text-gray-700 text-sm">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredRecommendations.map((rec) => {
                        const key = `${rec.style}-${rec.color}-${rec.size}`;
                        
                        // Trend badge
                        const trendBadge = rec.trend === 'accelerating' ? <span className="text-green-600 font-bold">↑</span> :
                                          rec.trend === 'decelerating' ? <span className="text-red-600 font-bold">↓</span> :
                                          <span className="text-gray-400">→</span>;
                        
                        // Confidence color
                        const conf = rec.confidence || 50;
                        const confColor = conf >= 70 ? 'bg-green-100 text-green-700' :
                                         conf >= 40 ? 'bg-amber-100 text-amber-700' :
                                         'bg-red-100 text-red-700';
                        
                        return (
                          <tr 
                            key={key} 
                            className={rec.suggestedQty > 0 ? 'bg-red-50/30 cursor-pointer hover:bg-red-50/50' : 'hover:bg-gray-50/50 cursor-pointer'}
                            onClick={() => rec.suggestedQty > 0 && openSizeCurve(rec.style, rec.color, rec.suggestedQty)}
                          >
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
                            <td className="py-4 px-6 text-center">
                              <span title={rec.trend || 'stable'} className="text-lg">{trendBadge}</span>
                            </td>
                            <td className="py-4 px-6 text-center">
                              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${confColor}`}>
                                {conf}%
                              </span>
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
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-2xl font-bold text-gray-900">{vendor.totalQty}</p>
                          <p className="text-sm text-gray-500">${vendor.totalCost.toLocaleString()}</p>
                        </div>
                        <button
                          onClick={() => {
                            const draft = generatePODraft(vendor.vendor, recommendations, products);
                            downloadPO(draft);
                          }}
                          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
                        >
                          Export PO
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Categories View */}
            {activeView === 'categories' && (
              <div className="space-y-6">
                {/* Category Cards */}
                <div className="grid grid-cols-3 gap-4">
                  {categoryRollups.map((cat) => (
                    <div key={cat.category} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                      <h3 className="font-semibold text-gray-900 mb-3">{cat.category}</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Styles</span>
                          <span className="font-medium">{cat.styles}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">SKUs</span>
                          <span className="font-medium">{cat.totalSKUs}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Need Reorder</span>
                          <span className={`font-bold ${cat.reorderCount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {cat.reorderCount}
                          </span>
                        </div>
                        <div className="flex justify-between pt-2 border-t border-gray-100">
                          <span className="text-gray-500">Value</span>
                          <span className="font-medium">${cat.totalValue.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Style Rollups */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">Top Styles by Reorder Volume</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-3 font-semibold text-gray-700">Style</th>
                          <th className="text-right py-3 font-semibold text-gray-700">Colors</th>
                          <th className="text-right py-3 font-semibold text-gray-700">Total SKUs</th>
                          <th className="text-right py-3 font-semibold text-gray-700">Critical</th>
                          <th className="text-right py-3 font-semibold text-gray-700">Total Reorder</th>
                        </tr>
                      </thead>
                      <tbody>
                        {styleRollups.slice(0, 20).map((style) => (
                          <tr key={style.style} className="border-b border-gray-100">
                            <td className="py-3 font-medium text-gray-900">{style.style}</td>
                            <td className="py-3 text-right">{style.colors}</td>
                            <td className="py-3 text-right">{style.totalSKUs}</td>
                            <td className="py-3 text-right">
                              <span className={style.criticalCount > 0 ? 'text-red-600 font-bold' : 'text-gray-400'}>
                                {style.criticalCount}
                              </span>
                            </td>
                            <td className="py-3 text-right">
                              <span className={style.totalReorder > 0 ? 'font-bold text-red-600' : 'text-gray-400'}>
                                {style.totalReorder > 0 ? style.totalReorder : '—'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Style-Color Rollups */}
                {styleColorRollups.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                    <h3 className="font-semibold text-gray-900 mb-4">Color-Level Reorders</h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-3 font-semibold text-gray-700">Style-Color</th>
                            <th className="text-right py-3 font-semibold text-gray-700">Sizes</th>
                            <th className="text-right py-3 font-semibold text-gray-700">Total Qty</th>
                            <th className="text-center py-3 font-semibold text-gray-700">Confidence</th>
                            <th className="text-center py-3 font-semibold text-gray-700">Trend</th>
                          </tr>
                        </thead>
                        <tbody>
                          {styleColorRollups.slice(0, 15).map((sc) => (
                            <tr key={`${sc.style}-${sc.color}`} className="border-b border-gray-100">
                              <td className="py-3">
                                <span className="font-medium text-gray-900">{sc.style}</span>
                                <span className="text-gray-400 mx-1">·</span>
                                <span className="text-gray-600">{sc.color}</span>
                              </td>
                              <td className="py-3 text-right">{sc.sizes.length}</td>
                              <td className="py-3 text-right font-bold text-red-600">{sc.totalReorder}</td>
                              <td className="py-3 text-center">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                                  sc.avgConfidence >= 70 ? 'bg-green-100 text-green-700' :
                                  sc.avgConfidence >= 40 ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {Math.round(sc.avgConfidence)}%
                                </span>
                              </td>
                              <td className="py-3 text-center">
                                {sc.trend === 'accelerating' ? <span className="text-green-600">↑ Accel</span> :
                                 sc.trend === 'decelerating' ? <span className="text-red-600">↓ Decel</span> :
                                 <span className="text-gray-400">→ Stable</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Size Curve Modal */}
            {sizeCurveModal.open && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setSizeCurveModal({ ...sizeCurveModal, open: false })}>
                <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 p-6" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-semibold">Size Breakdown: {sizeCurveModal.style}-{sizeCurveModal.color}</h3>
                    <button 
                      onClick={() => setSizeCurveModal({ ...sizeCurveModal, open: false })}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  </div>
                  <p className="text-sm text-gray-500 mb-4">Total suggested: {sizeCurveModal.totalQty} units</p>
                  <div className="space-y-2">
                    {sizeCurveModal.curve.map((item) => (
                      <div key={item.size} className="flex justify-between items-center py-2 border-b border-gray-100">
                        <div className="flex items-center gap-4">
                          <span className="font-medium text-gray-900 w-12">{item.size}</span>
                          <div className="w-32 bg-gray-100 rounded-full h-2">
                            <div 
                              className="bg-blue-500 h-2 rounded-full" 
                              style={{ width: `${item.ratio * 100}%` }}
                            />
                          </div>
                          <span className="text-sm text-gray-500">{(item.ratio * 100).toFixed(0)}%</span>
                        </div>
                        <span className="font-bold text-gray-900">{item.suggestedQty}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </main>
      </div>
    </div>
  );
}
