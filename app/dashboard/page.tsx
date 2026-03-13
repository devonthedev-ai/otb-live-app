'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/app/lib/supabase/client';
import { useAuth } from '@/app/context/AuthContext';
import { useWorkspace } from '@/app/context/WorkspaceContext';
import { Sidebar } from '@/app/components/Sidebar';
import TrendsView from '@/app/components/TrendsView';
import BulkEditView from '@/app/components/BulkEditView';
import StockoutCalculator from '@/app/components/StockoutCalculator';
import WhatIfTool from '@/app/components/WhatIfTool';
import InventoryHealth from '@/app/components/InventoryHealth';
import SeasonalPatterns from '@/app/components/SeasonalPatterns';
import VendorScorecard from '@/app/components/VendorScorecard';

// Types
interface InventoryItem {
  sku: string;
  style: string;
  color: string;
  size: string;
  qty_on_hand: number;
  qty_available: number;
  cost: number;
  price: number;
  is_archived?: boolean;
  archived_at?: string | null;
}

interface ProductInfo {
  sku: string;
  style: string;
  is_archived: boolean;
  last_sale_date: string | null;
  total_sold_24mo: number;
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
  vendor_name: string | null;
}

interface SizeCurveData {
  style: string;
  color: string;
  sizes: {
    size: string;
    sales90Days: number;
    sales365Days: number;
    effectiveSales90: number;
    demandSource: 'recent' | 'extended' | 'constrained';
    currentStock: number;
    velocity: number;
    percentOfTotal: number;
    suggestedQty: number;
    isStockedOut: boolean;
    daysSinceLastSale: number | null;
  }[];
  totalSales: number;
  totalEffectiveSales: number;
  totalStock: number;
}

interface PODraft {
  vendor: string;
  items: {
    style: string;
    color: string;
    size: string;
    qty: number;
    cost: number;
    total: number;
  }[];
  totalUnits: number;
  totalCost: number;
}

interface CategoryData {
  category: string;
  skuCount: number;
  totalSales90: number;
  totalSales365: number;
  currentStockValue: number;
  reorderValue: number;
  avgSellThrough: number;
}

export default function Dashboard() {
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const supabase = createClient();
  
  // Data states
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [sales, setSales] = useState<SalesItem[]>([]);
  const [settings, setSettings] = useState<Map<string, ProductSetting>>(new Map());
  const [loading, setLoading] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  
  // View states
  const [activeTab, setActiveTab] = useState<'otb' | 'size-curves' | 'categories' | 'po-generator' | 'trends' | 'bulk-edit' | 'stockouts' | 'whatif' | 'health' | 'seasonal' | 'vendors'>('otb');
  const [selectedVendor, setSelectedVendor] = useState<string>('all');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [lastSync, setLastSync] = useState<string | null>(null);
  
  // Load data
  useEffect(() => {
    if (!currentWorkspace) return;
    
    const loadData = async () => {
      setLoading(true);
      
      const oneYearAgo = new Date();
      oneYearAgo.setDate(oneYearAgo.getDate() - 365);
      
      const [{ data: invData }, { data: salesData }, { data: settingsData }] = await Promise.all([
        supabase.from('inventory_levels').select('*').eq('workspace_id', currentWorkspace.id),
        supabase.from('sales').select('*').eq('workspace_id', currentWorkspace.id).gte('sale_date', oneYearAgo.toISOString().split('T')[0]),
        supabase.from('product_settings').select('*').eq('workspace_id', currentWorkspace.id)
      ]);
      
      if (invData) setInventory(invData);
      if (salesData) setSales(salesData);
      
      if (settingsData) {
        const settingsMap = new Map<string, ProductSetting>();
        for (const s of settingsData) settingsMap.set(s.sku, s);
        setSettings(settingsMap);
      }
      
      // Fetch last sync time
      const { data: connectionData } = await supabase
        .from('apparelmagic_connections')
        .select('last_sync_at')
        .eq('workspace_id', currentWorkspace.id)
        .single();
      
      if (connectionData?.last_sync_at) {
        setLastSync(connectionData.last_sync_at);
      }
      
      setLoading(false);
    };
    
    loadData();
  }, [currentWorkspace, supabase]);

  // Filter inventory based on archived status
  const activeInventory = useMemo(() => {
    return showArchived ? inventory : inventory.filter(item => !item.is_archived);
  }, [inventory, showArchived]);
  
  const archivedCount = useMemo(() => inventory.filter(item => item.is_archived).length, [inventory]);

  // === SIZE CURVE CALCULATIONS ===
  const sizeCurves = useMemo<SizeCurveData[]>(() => {
    const curves = new Map<string, SizeCurveData>();
    
    // Group sales by style-color (use 365 days for better accuracy)
    const salesByStyleColor = new Map<string, SalesItem[]>();
    for (const sale of sales) {
      const key = `${sale.style}-${sale.color}`;
      if (!salesByStyleColor.has(key)) salesByStyleColor.set(key, []);
      salesByStyleColor.get(key)!.push(sale);
    }
    
    // Group inventory by style-color
    const invByStyleColor = new Map<string, InventoryItem[]>();
    for (const item of activeInventory) {
      const key = `${item.style}-${item.color}`;
      if (!invByStyleColor.has(key)) invByStyleColor.set(key, []);
      invByStyleColor.get(key)!.push(item);
    }
    
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const oneYearAgo = new Date();
    oneYearAgo.setDate(oneYearAgo.getDate() - 365);
    
    for (const [key, items] of Array.from(invByStyleColor)) {
      const [style, color] = key.split('-');
      const styleColorSales = salesByStyleColor.get(key) || [];
      
      const sizeData = items.map(item => {
        // Get sales for this specific size
        const sizeSales = styleColorSales.filter(s => s.size === item.size);
        
        // 90-day sales (recent)
        const sales90 = sizeSales
          .filter(s => new Date(s.sale_date) >= ninetyDaysAgo)
          .reduce((sum, s) => sum + s.units, 0);
        
        // 365-day sales (extended)
        const sales365 = sizeSales
          .filter(s => new Date(s.sale_date) >= oneYearAgo)
          .reduce((sum, s) => sum + s.units, 0);
        
        // Detect stockout situation
        // If current stock is 0 but had sales before, it stocked out
        const lastSale = sizeSales[0]; // Already sorted by date desc
        const lastSaleDate = lastSale ? new Date(lastSale.sale_date) : null;
        const daysSinceLastSale = lastSaleDate 
          ? Math.floor((Date.now() - lastSaleDate.getTime()) / (1000 * 60 * 60 * 24))
          : null;
        
        // Size stocked out if: zero inventory + had sales + last sale was a while ago
        const isStockedOut = item.qty_available <= 0 && sales365 > 0 && daysSinceLastSale !== null && daysSinceLastSale > 14;
        
        // Calculate true demand
        // If stocked out with strong historical sales, use 365-day average
        // Otherwise use 90-day recent velocity
        let effectiveSales90 = sales90;
        let demandSource: 'recent' | 'extended' | 'constrained' = 'recent';
        
        if (isStockedOut && sales365 > sales90 * 2) {
          // Size stocked out early in the 90-day window
          // Estimate what sales would have been if not stocked out
          effectiveSales90 = Math.round(sales365 / 4); // Approximate 90-day from 365-day
          demandSource = 'extended';
        } else if (isStockedOut) {
          demandSource = 'constrained';
        }
        
        return {
          size: item.size,
          sales90Days: sales90,
          sales365Days: sales365,
          effectiveSales90,
          demandSource,
          currentStock: item.qty_available,
          velocity: effectiveSales90 / 90,
          percentOfTotal: 0, // Calculated below
          suggestedQty: 0, // Calculated below
          isStockedOut,
          daysSinceLastSale
        };
      });
      
      // Calculate total using effective sales (not just raw 90-day)
      const totalEffectiveSales = sizeData.reduce((sum, s) => sum + s.effectiveSales90, 0);
      const totalStock = sizeData.reduce((sum, s) => sum + s.currentStock, 0);
      
      // Calculate percentages based on effective demand
      sizeData.forEach(s => {
        s.percentOfTotal = totalEffectiveSales > 0 ? (s.effectiveSales90 / totalEffectiveSales) * 100 : 0;
      });
      
      // Sort by size (common size order)
      const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'OS', 'ONE SIZE'];
      sizeData.sort((a, b) => {
        const aIdx = sizeOrder.indexOf(a.size.toUpperCase());
        const bIdx = sizeOrder.indexOf(b.size.toUpperCase());
        if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
        if (aIdx >= 0) return -1;
        if (bIdx >= 0) return 1;
        return a.size.localeCompare(b.size);
      });
      
      curves.set(key, {
        style,
        color,
        sizes: sizeData,
        totalSales: sizeData.reduce((sum, s) => sum + s.sales90Days, 0),
        totalEffectiveSales,
        totalStock
      });
    }
    
    return Array.from(curves.values())
      .sort((a, b) => b.totalEffectiveSales - a.totalEffectiveSales);
  }, [inventory, sales]);

  // === CATEGORY DATA ===
  const categoryData = useMemo<CategoryData[]>(() => {
    const cats = new Map<string, CategoryData>();
    
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    for (const item of activeInventory) {
      // Extract category from style or use default
      const category = extractCategory(item.style);
      
      const itemSales = sales.filter(s => s.sku === item.sku);
      const sales90 = itemSales.filter(s => new Date(s.sale_date) >= ninetyDaysAgo).reduce((sum, s) => sum + s.units, 0);
      const sales365 = itemSales.reduce((sum, s) => sum + s.units, 0);
      const stockValue = item.qty_available * (item.cost || 0);
      
      // Calculate if reorder needed
      const velocity = sales90 / 90;
      const setting = settings.get(item.sku);
      const leadTime = setting?.lead_time_days || 60;
      const safetyStock = velocity * 14;
      const target = velocity * (leadTime + 14);
      const reorderQty = Math.max(0, Math.ceil(target - item.qty_available));
      const reorderValue = reorderQty * (item.cost || 0);
      
      const existing = cats.get(category);
      if (existing) {
        existing.skuCount++;
        existing.totalSales90 += sales90;
        existing.totalSales365 += sales365;
        existing.currentStockValue += stockValue;
        existing.reorderValue += reorderValue;
      } else {
        cats.set(category, {
          category,
          skuCount: 1,
          totalSales90: sales90,
          totalSales365: sales365,
          currentStockValue: stockValue,
          reorderValue,
          avgSellThrough: 0
        });
      }
    }
    
    // Calculate sell-through rates
    const result = Array.from(cats.values());
    result.forEach(cat => {
      const avgDailySales = cat.totalSales90 / 90;
      const avgStock = cat.currentStockValue / (cat.skuCount || 1); // Simplified
      cat.avgSellThrough = avgStock > 0 ? (avgDailySales / avgStock) * 100 : 0;
    });
    
    return result.sort((a, b) => b.totalSales90 - a.totalSales90);
  }, [inventory, sales, settings]);

  // === PO GENERATOR ===
  const poDrafts = useMemo<PODraft[]>(() => {
    const drafts = new Map<string, PODraft>();
    
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    for (const item of activeInventory) {
      const setting = settings.get(item.sku);
      const vendor = setting?.vendor_name || 'Unknown Vendor';
      
      // Calculate reorder
      const itemSales = sales.filter(s => s.sku === item.sku && new Date(s.sale_date) >= ninetyDaysAgo);
      const totalSales = itemSales.reduce((sum, s) => sum + s.units, 0);
      const velocity = totalSales / 90;
      
      const leadTime = setting?.lead_time_days || 60;
      const moq = setting?.moq || 1;
      const target = velocity * (leadTime + 14);
      let reorderQty = Math.max(0, Math.ceil(target - item.qty_available));
      
      if (reorderQty > 0 && moq > 1) {
        reorderQty = Math.ceil(reorderQty / moq) * moq;
      }
      
      if (reorderQty > 0) {
        if (!drafts.has(vendor)) {
          drafts.set(vendor, { vendor, items: [], totalUnits: 0, totalCost: 0 });
        }
        
        const draft = drafts.get(vendor)!;
        draft.items.push({
          style: item.style,
          color: item.color,
          size: item.size,
          qty: reorderQty,
          cost: item.cost || 0,
          total: reorderQty * (item.cost || 0)
        });
        draft.totalUnits += reorderQty;
        draft.totalCost += reorderQty * (item.cost || 0);
      }
    }
    
    return Array.from(drafts.values()).sort((a, b) => b.totalCost - a.totalCost);
  }, [inventory, sales, settings]);

  // Export PO to CSV
  const exportPO = (draft: PODraft) => {
    let csv = 'Style,Color,Size,Quantity,Unit Cost,Total\n';
    for (const item of draft.items) {
      csv += `"${item.style}","${item.color}","${item.size}",${item.qty},$${item.cost.toFixed(2)},$${item.total.toFixed(2)}\n`;
    }
    csv += `,,,,TOTAL,$${draft.totalCost.toFixed(2)}\n`;
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PO_${draft.vendor.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  if (loading) {
    return (
      <div className="flex min-h-screen bg-[#F5F5F7]">
        <Sidebar />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500">Loading...</div>
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
          <div className="max-w-7xl mx-auto px-8 py-4">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">OTB Live</h1>
                {lastSync && (
                  <p className="text-xs text-gray-500 mt-0.5">
                    Last sync: {new Date(lastSync).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex gap-2 bg-gray-100 p-1 rounded-xl flex-wrap">
                {[
                  { id: 'otb', label: 'OTB' },
                  { id: 'size-curves', label: 'Size Curves' },
                  { id: 'categories', label: 'Categories' },
                  { id: 'po-generator', label: 'POs' },
                  { id: 'trends', label: 'Trends' },
                  { id: 'bulk-edit', label: 'Bulk Edit' },
                  { id: 'stockouts', label: 'Stockout $' },
                  { id: 'whatif', label: 'What-If' },
                  { id: 'health', label: 'Health' },
                  { id: 'seasonal', label: 'Seasonal' },
                  { id: 'vendors', label: 'Vendors' },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      activeTab === tab.id
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-8 py-8">
          {/* OTB TAB */}
          {activeTab === 'otb' && <OTBTab inventory={activeInventory} sales={sales} settings={settings} showArchived={showArchived} setShowArchived={setShowArchived} archivedCount={archivedCount} />}
          
          {/* SIZE CURVES TAB */}
          {activeTab === 'size-curves' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Size Curve Analysis</h2>
                <p className="text-sm text-gray-500">Top {sizeCurves.length} style-color combinations by sales volume</p>
              </div>
              
              {sizeCurves.slice(0, 20).map(curve => (
                <div key={`${curve.style}-${curve.color}`} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-900">{curve.style}</h3>
                      <p className="text-sm text-gray-500">{curve.color} · {curve.sizes.length} sizes</p>
                    </div>
                    <div className="text-right">
                      <p className="text-2xl font-bold text-gray-900">{curve.totalSales}</p>
                      <p className="text-sm text-gray-500">units sold (90d)</p>
                    </div>
                  </div>
                  
                  {/* Size Distribution Chart */}
                  <div className="space-y-3">
                    {curve.sizes.map(size => (
                      <div key={size.size} className="flex items-center gap-4">
                        <div className="w-14 text-sm font-medium text-gray-700">
                          {size.size}
                          {size.demandSource === 'extended' && (
                            <span className="ml-1 text-amber-500" title="Stocked out - using extended history">⚠️</span>
                          )}
                          {size.demandSource === 'constrained' && (
                            <span className="ml-1 text-red-500" title="Stocked out - demand constrained">🚫</span>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                              <div 
                                className={`h-full rounded-full ${
                                  size.demandSource === 'extended' ? 'bg-amber-500' :
                                  size.demandSource === 'constrained' ? 'bg-red-400' :
                                  size.percentOfTotal > 20 ? 'bg-blue-500' : 
                                  size.percentOfTotal > 10 ? 'bg-blue-400' : 'bg-blue-300'
                                }`}
                                style={{ width: `${Math.min(size.percentOfTotal * 2, 100)}%` }}
                              />
                            </div>
                            <span className="text-sm text-gray-600 w-16">
                              {size.percentOfTotal.toFixed(1)}%
                            </span>
                          </div>
                        </div>
                        <div className="text-right w-24">
                          <span className="text-sm font-medium">{size.sales90Days}</span>
                          {size.sales365Days > size.sales90Days * 2 && (
                            <span className="text-xs text-amber-600 block">
                              365d: {size.sales365Days}
                            </span>
                          )}
                        </div>
                        <div className="text-right w-20">
                          <span className={`text-sm ${size.currentStock < 10 ? 'text-red-600 font-bold' : 'text-gray-600'}`}>
                            {size.currentStock}
                          </span>
                          {size.isStockedOut && (
                            <span className="text-xs text-red-500 block">OUT</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Insight */}
                  {(() => {
                    const topSize = curve.sizes.reduce((max, s) => s.effectiveSales90 > max.effectiveSales90 ? s : max, curve.sizes[0]);
                    const lowStock = curve.sizes.filter(s => s.currentStock < 10 && s.effectiveSales90 > 5);
                    const stockedOut = curve.sizes.filter(s => s.isStockedOut && s.demandSource === 'extended');
                    return (
                      <div className="mt-4 pt-4 border-t border-gray-100 text-sm">
                        <span className="text-gray-600">Top size: </span>
                        <span className="font-medium text-gray-900">{topSize.size} ({topSize.percentOfTotal.toFixed(0)}%)</span>
                        {lowStock.length > 0 && (
                          <span className="ml-4 text-red-600">
                            ⚠️ Low stock: {lowStock.map(s => s.size).join(', ')}
                          </span>
                        )}
                        {stockedOut.length > 0 && (
                          <span className="ml-4 text-amber-600">
                            ⚠️ Est. demand: {stockedOut.map(s => s.size).join(', ')}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}

          {/* CATEGORIES TAB */}
          {activeTab === 'categories' && (
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">Category Performance</h2>
              
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {categoryData.map(cat => (
                  <div key={cat.category} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
                    <h3 className="font-semibold text-gray-900 mb-3">{cat.category}</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">SKUs</span>
                        <span className="font-medium">{cat.skuCount}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">90d Sales</span>
                        <span className="font-medium">{cat.totalSales90}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Stock Value</span>
                        <span className="font-medium">${cat.currentStockValue.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Reorder Need</span>
                        <span className={`font-bold ${cat.reorderValue > 0 ? 'text-red-600' : 'text-green-600'}`}>
                          ${cat.reorderValue.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PO GENERATOR TAB */}
          {activeTab === 'po-generator' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-900">Purchase Order Generator</h2>
                <p className="text-sm text-gray-500">{poDrafts.length} vendors with reorder needs</p>
              </div>
              
              {poDrafts.length === 0 && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-12 text-center">
                  <p className="text-gray-500">No reorder needs at this time. All stocked up! 🎉</p>
                </div>
              )}
              
              {poDrafts.map(draft => (
                <div key={draft.vendor} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                  <div className="p-6 border-b border-gray-100">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-semibold text-gray-900">{draft.vendor}</h3>
                        <p className="text-sm text-gray-500">{draft.items.length} SKUs · {draft.totalUnits} units</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-bold text-gray-900">${draft.totalCost.toLocaleString()}</p>
                        <button
                          onClick={() => exportPO(draft)}
                          className="mt-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                        >
                          Export CSV
                        </button>
                      </div>
                    </div>
                  </div>
                  
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50/50">
                        <tr>
                          <th className="text-left py-3 px-6 font-semibold text-gray-700">Style</th>
                          <th className="text-left py-3 px-6 font-semibold text-gray-700">Color</th>
                          <th className="text-left py-3 px-6 font-semibold text-gray-700">Size</th>
                          <th className="text-right py-3 px-6 font-semibold text-gray-700">Qty</th>
                          <th className="text-right py-3 px-6 font-semibold text-gray-700">Cost</th>
                          <th className="text-right py-3 px-6 font-semibold text-gray-700">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {draft.items.map((item, i) => (
                          <tr key={i}>
                            <td className="py-3 px-6 font-medium">{item.style}</td>
                            <td className="py-3 px-6 text-gray-600">{item.color}</td>
                            <td className="py-3 px-6 text-gray-600">{item.size}</td>
                            <td className="py-3 px-6 text-right font-bold text-red-600">{item.qty}</td>
                            <td className="py-3 px-6 text-right">${item.cost.toFixed(2)}</td>
                            <td className="py-3 px-6 text-right">${item.total.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* TRENDS TAB */}
          {activeTab === 'trends' && <TrendsView />}

          {/* BULK EDIT TAB */}
          {activeTab === 'bulk-edit' && <BulkEditView />}
          
          {/* STOCKOUT CALCULATOR TAB */}
          {activeTab === 'stockouts' && <StockoutCalculator />}
          
          {/* WHAT-IF TAB */}
          {activeTab === 'whatif' && <WhatIfTool />}
          
          {/* HEALTH SCORE TAB */}
          {activeTab === 'health' && <InventoryHealth />}
          
          {/* SEASONAL PATTERNS TAB */}
          {activeTab === 'seasonal' && <SeasonalPatterns />}
          
          {/* VENDOR SCORECARD TAB */}
          {activeTab === 'vendors' && <VendorScorecard />}
        </main>
      </div>
    </div>
  );
}

// Helper function to extract category from style
function extractCategory(style: string): string {
  const upper = style.toUpperCase();
  if (upper.includes('DRESS')) return 'Dresses';
  if (upper.includes('TOP') || upper.includes('SHIRT') || upper.includes('BLOUSE')) return 'Tops';
  if (upper.includes('PANT') || upper.includes('JEAN') || upper.includes('SHORT')) return 'Bottoms';
  if (upper.includes('SKIRT')) return 'Skirts';
  if (upper.includes('JACKET') || upper.includes('COAT') || upper.includes('BLAZER')) return 'Outerwear';
  if (upper.includes('SWEATER') || upper.includes('CARDIGAN') || upper.includes('KNIT')) return 'Knits';
  if (upper.includes('SHOE') || upper.includes('HEEL') || upper.includes('BOOT') || upper.includes('SANDAL')) return 'Shoes';
  if (upper.includes('BAG') || upper.includes('PURSE') || upper.includes('TOTE')) return 'Accessories';
  return 'Other';
}

// OTB Tab Component
function OTBTab({ inventory: activeInventory, sales, settings, showArchived, setShowArchived, archivedCount }: { 
  inventory: InventoryItem[]; 
  sales: SalesItem[]; 
  settings: Map<string, ProductSetting>;
  showArchived: boolean;
  setShowArchived: (show: boolean) => void;
  archivedCount: number;
}) {
  const [filter, setFilter] = useState<'all' | 'reorder' | 'critical'>('all');
  const [sortBy, setSortBy] = useState<'days' | 'velocity' | 'stock'>('days');
  
  const recommendations = useMemo(() => {
    const recs: any[] = [];
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    for (const item of activeInventory) {
      const itemSales = sales.filter(s => s.sku === item.sku && new Date(s.sale_date) >= ninetyDaysAgo);
      const totalSales = itemSales.reduce((sum, s) => sum + s.units, 0);
      const velocity = totalSales / 90;
      
      const setting = settings.get(item.sku);
      const leadTime = setting?.lead_time_days || 60;
      const moq = setting?.moq || 1;
      
      const daysUntil = velocity > 0 ? Math.floor(item.qty_available / velocity) : 999;
      const target = velocity * (leadTime + 14);
      let reorder = Math.max(0, Math.ceil(target - item.qty_available));
      if (reorder > 0 && moq > 1) reorder = Math.ceil(reorder / moq) * moq;
      
      recs.push({
        ...item,
        velocity,
        daysUntil,
        reorder,
        reorderValue: reorder * (item.cost || 0)
      });
    }
    return recs;
  }, [activeInventory, sales, settings]);
  
  const filtered = recommendations
    .filter(r => {
      if (filter === 'reorder') return r.reorder > 0;
      if (filter === 'critical') return r.daysUntil < 60;
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'days') return a.daysUntil - b.daysUntil;
      if (sortBy === 'velocity') return b.velocity - a.velocity;
      return a.qty_available - b.qty_available;
    });

  return (
    <div>
      {/* Archive Toggle */}
      {archivedCount > 0 && (
        <div className="mb-4 bg-gray-50 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-600">
              {archivedCount} archived items hidden
            </span>
            <span className="text-xs text-gray-400">
              (No sales in 12+ months, no inventory)
            </span>
          </div>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            {showArchived ? 'Hide Archived' : 'Show Archived'}
          </button>
        </div>
      )}
      
      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
          <p className="text-sm font-medium text-gray-500">Total SKUs</p>
          <p className="text-3xl font-semibold text-gray-900 mt-1">{activeInventory.length}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
          <p className="text-sm font-medium text-gray-500">Need Reorder</p>
          <p className="text-3xl font-semibold text-red-600 mt-1">{recommendations.filter(r => r.reorder > 0).length}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
          <p className="text-sm font-medium text-gray-500">Critical (&lt;60 days)</p>
          <p className="text-3xl font-semibold text-amber-600 mt-1">{recommendations.filter(r => r.daysUntil < 60).length}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200/60 p-5">
          <p className="text-sm font-medium text-gray-500">Reorder Value</p>
          <p className="text-3xl font-semibold text-gray-900 mt-1">${recommendations.reduce((sum, r) => sum + r.reorderValue, 0).toLocaleString()}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between mb-6 bg-white p-4 rounded-xl shadow-sm border border-gray-200">
        <div className="flex gap-3">
          <select value={filter} onChange={(e) => setFilter(e.target.value as any)} className="border border-gray-200 rounded-lg px-4 py-2 text-sm">
            <option value="all">All Items</option>
            <option value="reorder">Need Reorder</option>
            <option value="critical">Critical</option>
          </select>
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="border border-gray-200 rounded-lg px-4 py-2 text-sm">
            <option value="days">Days Until Stockout</option>
            <option value="velocity">Sales Velocity</option>
            <option value="stock">Current Stock</option>
          </select>
        </div>
        <span className="text-sm text-gray-500">{filtered.length} items</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50/50">
            <tr>
              <th className="text-left py-4 px-6 font-semibold text-gray-700">Product</th>
              <th className="text-right py-4 px-6 font-semibold text-gray-700">Stock</th>
              <th className="text-right py-4 px-6 font-semibold text-gray-700">Daily</th>
              <th className="text-right py-4 px-6 font-semibold text-gray-700">Days Left</th>
              <th className="text-right py-4 px-6 font-semibold text-gray-700">Reorder</th>
              <th className="text-left py-4 px-6 font-semibold text-gray-700">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((rec) => (
              <tr key={rec.sku} className={rec.reorder > 0 ? 'bg-red-50/30' : 'hover:bg-gray-50/50'}>
                <td className="py-4 px-6">
                  <div className="font-medium text-gray-900">{rec.style}</div>
                  <div className="text-gray-500">{rec.color} · {rec.size}</div>
                  <div className="text-xs text-gray-400">{rec.sku}</div>
                </td>
                <td className="py-4 px-6 text-right font-medium">{rec.qty_available}</td>
                <td className="py-4 px-6 text-right text-gray-600">{rec.velocity.toFixed(2)}</td>
                <td className="py-4 px-6 text-right">
                  <span className={rec.daysUntil < 60 ? 'text-red-600 font-medium' : 'text-gray-900'}>
                    {rec.daysUntil === 999 ? '∞' : rec.daysUntil}
                  </span>
                </td>
                <td className="py-4 px-6 text-right">
                  {rec.reorder > 0 ? (
                    <span className="font-bold text-red-600">{rec.reorder}</span>
                  ) : (
                    <span className="text-gray-400">—</span>
                  )}
                </td>
                <td className="py-4 px-6">
                  {rec.daysUntil < 60 ? (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">Critical</span>
                  ) : rec.reorder > 0 ? (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Reorder</span>
                  ) : (
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
