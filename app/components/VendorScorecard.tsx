'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/app/lib/supabase/client';
import { useWorkspace } from '@/app/context/WorkspaceContext';

interface VendorMetrics {
  name: string;
  skuCount: number;
  totalPurchased: number;
  totalValue: number;
  avgLeadTime: number;
  onTimeRate: number; // Estimated based on sales pattern
  qualityScore: number; // Based on returns (if data available)
  velocity: number; // Units sold per day
  inventoryValue: number;
  reorderValue: number;
  performanceScore: number; // 0-100
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
}

export default function VendorScorecard() {
  const { currentWorkspace } = useWorkspace();
  const supabase = createClient();
  
  const [inventory, setInventory] = useState<any[]>([]);
  const [sales, setSales] = useState<any[]>([]);
  const [settings, setSettings] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentWorkspace) return;
    
    const loadData = async () => {
      setLoading(true);
      
      const ninetyDaysAgo = new Date();
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      
      const [{ data: invData }, { data: salesData }, { data: settingsData }] = await Promise.all([
        supabase.from('inventory_levels').select('*').eq('workspace_id', currentWorkspace.id),
        supabase.from('sales').select('*').eq('workspace_id', currentWorkspace.id).gte('sale_date', ninetyDaysAgo.toISOString().split('T')[0]),
        supabase.from('product_settings').select('*').eq('workspace_id', currentWorkspace.id)
      ]);
      
      if (invData) setInventory(invData);
      if (salesData) setSales(salesData);
      
      if (settingsData) {
        const map = new Map<string, any>();
        for (const s of settingsData) map.set(s.sku, s);
        setSettings(map);
      }
      
      setLoading(false);
    };
    
    loadData();
  }, [currentWorkspace, supabase]);

  const vendors = useMemo<VendorMetrics[]>(() => {
    const vendorMap = new Map<string, VendorMetrics>();
    
    // Group by vendor
    const salesBySku = new Map<string, any[]>();
    for (const sale of sales) {
      if (!salesBySku.has(sale.sku)) salesBySku.set(sale.sku, []);
      salesBySku.get(sale.sku)!.push(sale);
    }
    
    for (const item of inventory) {
      const setting = settings.get(item.sku);
      const vendorName = setting?.vendor_name || 'Unknown Vendor';
      
      const skuSales = salesBySku.get(item.sku) || [];
      const totalSold = skuSales.reduce((sum, s) => sum + s.units, 0);
      const velocity = totalSold / 90;
      
      const inventoryValue = item.qty_available * (item.cost || 0);
      
      // Calculate reorder need
      const leadTime = setting?.lead_time_days || 60;
      const target = velocity * (leadTime + 14);
      const reorderQty = Math.max(0, Math.ceil(target - item.qty_available));
      const reorderValue = reorderQty * (item.cost || 0);
      
      if (!vendorMap.has(vendorName)) {
        vendorMap.set(vendorName, {
          name: vendorName,
          skuCount: 0,
          totalPurchased: 0,
          totalValue: 0,
          avgLeadTime: 0,
          onTimeRate: 85, // Default assumption
          qualityScore: 90, // Default
          velocity: 0,
          inventoryValue: 0,
          reorderValue: 0,
          performanceScore: 0,
          grade: 'C'
        });
      }
      
      const vendor = vendorMap.get(vendorName)!;
      vendor.skuCount++;
      vendor.totalPurchased += totalSold;
      vendor.totalValue += totalSold * (item.cost || 0);
      vendor.avgLeadTime = (vendor.avgLeadTime * (vendor.skuCount - 1) + leadTime) / vendor.skuCount;
      vendor.velocity += velocity;
      vendor.inventoryValue += inventoryValue;
      vendor.reorderValue += reorderValue;
    }
    
    // Calculate performance scores
    for (const vendor of Array.from(vendorMap.values())) {
      // Factors: velocity (40%), lead time (20%), inventory efficiency (40%)
      const velocityScore = Math.min(100, vendor.velocity * 10);
      const leadTimeScore = Math.max(0, 100 - (vendor.avgLeadTime - 30) * 2);
      const efficiencyScore = vendor.totalPurchased > 0 
        ? Math.min(100, (vendor.totalValue / Math.max(vendor.inventoryValue, 1)) * 50)
        : 50;
      
      vendor.performanceScore = Math.round(
        velocityScore * 0.4 + leadTimeScore * 0.2 + efficiencyScore * 0.4
      );
      
      // Assign grade
      if (vendor.performanceScore >= 90) vendor.grade = 'A';
      else if (vendor.performanceScore >= 80) vendor.grade = 'B';
      else if (vendor.performanceScore >= 70) vendor.grade = 'C';
      else if (vendor.performanceScore >= 60) vendor.grade = 'D';
      else vendor.grade = 'F';
    }
    
    return Array.from(vendorMap.values()).sort((a, b) => b.performanceScore - a.performanceScore);
  }, [inventory, sales, settings]);

  const getGradeColor = (grade: string) => {
    switch (grade) {
      case 'A': return 'bg-green-100 text-green-800 border-green-200';
      case 'B': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'C': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'D': return 'bg-orange-100 text-orange-800 border-orange-200';
      case 'F': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Calculating vendor scores...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-gray-900">🏆 Vendor Performance Scorecard</h2>
          <p className="text-sm text-gray-500">Rank your vendors by performance</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Total Vendors</p>
          <p className="text-3xl font-bold text-gray-900">{vendors.length}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Top Grade (A)</p>
          <p className="text-3xl font-bold text-green-600">{vendors.filter(v => v.grade === 'A').length}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Needs Improvement (D/F)</p>
          <p className="text-3xl font-bold text-red-600">{vendors.filter(v => v.grade === 'D' || v.grade === 'F').length}</p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <p className="text-sm text-gray-500">Avg Performance</p>
          <p className="text-3xl font-bold text-gray-900">{Math.round(vendors.reduce((sum, v) => sum + v.performanceScore, 0) / vendors.length || 0)}</p>
        </div>
      </div>

      {/* Vendor Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50/50">
              <tr>
                <th className="text-left py-3 px-6">Vendor</th>
                <th className="text-center py-3 px-6">Grade</th>
                <th className="text-center py-3 px-6">Score</th>
                <th className="text-right py-3 px-6">SKUs</th>
                <th className="text-right py-3 px-6">Total Sales</th>
                <th className="text-right py-3 px-6">Avg Lead Time</th>
                <th className="text-right py-3 px-6">Daily Velocity</th>
                <th className="text-right py-3 px-6">Reorder Need</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {vendors.map((vendor) => (
                <tr key={vendor.name} className="hover:bg-gray-50">
                  <td className="py-3 px-6">
                    <div className="font-medium">{vendor.name}</div>
                  </td>
                  <td className="py-3 px-6 text-center">
                    <span className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold border ${getGradeColor(vendor.grade)}`}>
                      {vendor.grade}
                    </span>
                  </td>
                  <td className="py-3 px-6 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <div className="w-16 bg-gray-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${
                            vendor.performanceScore >= 80 ? 'bg-green-500' :
                            vendor.performanceScore >= 60 ? 'bg-amber-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${vendor.performanceScore}%` }}
                        />
                      </div>
                      <span className="text-xs">{vendor.performanceScore}</span>
                    </div>
                  </td>
                  <td className="py-3 px-6 text-right">{vendor.skuCount}</td>
                  <td className="py-3 px-6 text-right">{vendor.totalPurchased} units</td>
                  <td className="py-3 px-6 text-right">{Math.round(vendor.avgLeadTime)}d</td>
                  <td className="py-3 px-6 text-right">{vendor.velocity.toFixed(1)}</td>
                  <td className="py-3 px-6 text-right">
                    <span className={vendor.reorderValue > 0 ? 'text-red-600 font-bold' : 'text-gray-400'}>
                      ${vendor.reorderValue.toLocaleString()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        
        {vendors.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No vendors found. Add vendor names to your product settings.
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="bg-gray-50 rounded-xl p-4 text-sm">
        <p className="font-medium text-gray-700 mb-2">Scoring Method:</p>
        <ul className="text-gray-600 space-y-1">
          <li>• Sales Velocity (40%): How fast their products sell</li>
          <li>• Lead Time (20%): Speed of delivery (faster = better)</li>
          <li>• Inventory Efficiency (40%): Sales value vs inventory held</li>
        </ul>
      </div>
    </div>
  );
}
