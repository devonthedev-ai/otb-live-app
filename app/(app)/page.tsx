// app/(app)/page.tsx - Professional Dashboard
'use client';

import { useState, useEffect } from 'react';
import { Layout } from '@/app/components/Layout';
import { MetricCard } from '@/app/components/MetricCard';
import { StatusBadge } from '@/app/components/StatusBadge';
import { DataTable } from '@/app/components/DataTable';
import { useWorkspace } from '@/app/context/WorkspaceContext';
import { createClient } from '@/app/lib/supabase/client';

interface DashboardStats {
  totalSKUs: number;
  criticalCount: number;
  reorderCount: number;
  healthyCount: number;
  totalValue: number;
  avgWeeksSupply: number;
}

interface RecentItem {
  id: string;
  style: string;
  color: string;
  size: string;
  stock: number;
  daysUntilStockout: number;
  suggestedQty: number;
  status: 'critical' | 'reorder' | 'healthy';
}

export default function DashboardPage() {
  const { currentWorkspace } = useWorkspace();
  const [stats, setStats] = useState<DashboardStats>({
    totalSKUs: 0,
    criticalCount: 0,
    reorderCount: 0,
    healthyCount: 0,
    totalValue: 0,
    avgWeeksSupply: 0,
  });
  const [recentItems, setRecentItems] = useState<RecentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (currentWorkspace) {
      loadDashboardData();
    }
  }, [currentWorkspace]);

  const loadDashboardData = async () => {
    setIsLoading(true);
    const supabase = createClient();

    try {
      // Get recommendations
      const { data: recommendations } = await supabase
        .from('recommendations')
        .select(`
          *,
          product:products(style, color, size, cost)
        `)
        .eq('workspace_id', currentWorkspace!.id)
        .order('days_until_stockout', { ascending: true });

      if (recommendations) {
        // Calculate stats
        const critical = recommendations.filter(r => r.days_until_stockout < 30 && r.suggested_qty > 0);
        const reorder = recommendations.filter(r => r.days_until_stockout >= 30 && r.days_until_stockout < 90 && r.suggested_qty > 0);
        const healthy = recommendations.filter(r => r.suggested_qty === 0);
        
        const totalValue = recommendations.reduce((sum, r) => 
          sum + (r.current_stock * (r.product?.cost || 0)), 0
        );

        const avgWeeks = recommendations.length > 0
          ? recommendations.reduce((sum, r) => sum + (r.days_until_stockout / 7), 0) / recommendations.length
          : 0;

        setStats({
          totalSKUs: recommendations.length,
          criticalCount: critical.length,
          reorderCount: reorder.length,
          healthyCount: healthy.length,
          totalValue,
          avgWeeksSupply: Math.round(avgWeeks * 10) / 10,
        });

        // Format recent items
        const items: RecentItem[] = recommendations
          .filter(r => r.suggested_qty > 0)
          .slice(0, 10)
          .map(r => ({
            id: r.id,
            style: r.product?.style || 'Unknown',
            color: r.product?.color || '',
            size: r.product?.size || '',
            stock: r.current_stock,
            daysUntilStockout: r.days_until_stockout,
            suggestedQty: r.suggested_qty,
            status: r.days_until_stockout < 30 ? 'critical' : 'reorder',
          }));

        setRecentItems(items);
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
            <p className="text-gray-500">Overview of your inventory health</p>
          </div>
          <button
            onClick={loadDashboardData}
            className="px-4 py-2 text-sm font-medium text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100"
          >
            Refresh Data
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <MetricCard
            title="Total SKUs"
            value={stats.totalSKUs.toLocaleString()}
            trend="Active inventory"
            icon="📦"
          />
          <MetricCard
            title="Critical Items"
            value={stats.criticalCount.toString()}
            trend="Need immediate reorder"
            icon="🚨"
            variant="danger"
          />
          <MetricCard
            title="Need Reorder"
            value={stats.reorderCount.toString()}
            trend="Plan within 60 days"
            icon="⚠️"
            variant="warning"
          />
          <MetricCard
            title="Inventory Value"
            value={`$${(stats.totalValue / 1000).toFixed(0)}k`}
            trend={`${stats.avgWeeksSupply} weeks supply`}
            icon="💰"
            variant="success"
          />
        </div>

        {/* Quick Actions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-3">
            <a
              href="/recommendations"
              className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
            >
              View Recommendations
            </a>
            <a
              href="/inventory"
              className="inline-flex items-center px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
            >
              Upload Inventory
            </a>
            <a
              href="/integrations"
              className="inline-flex items-center px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg font-medium hover:bg-gray-50"
            >
              Connect Shopify
            </a>
          </div>
        </div>

        {/* Recent Items Table */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Items Needing Attention</h2>
          </div>
          
          {isLoading ? (
            <div className="p-8 text-center text-gray-500">Loading...</div>
          ) : recentItems.length > 0 ? (
            <DataTable
              columns={[
                { key: 'style', title: 'Style' },
                { key: 'color', title: 'Color' },
                { key: 'size', title: 'Size' },
                { key: 'stock', title: 'Stock', align: 'right' },
                { key: 'daysUntilStockout', title: 'Days Left', align: 'right' },
                { key: 'suggestedQty', title: 'Reorder Qty', align: 'right' },
                { key: 'status', title: 'Status' },
              ]}
              data={recentItems.map(item => ({
                ...item,
                status: <StatusBadge status={item.status} />,
              }))}
            />
          ) : (
            <div className="p-8 text-center">
              <p className="text-gray-500">No items need reorder right now. 🎉</p>
              <p className="text-sm text-gray-400 mt-1">Upload inventory and sales data to get recommendations.</p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
