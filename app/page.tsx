'use client';

import { useState, useCallback } from 'react';
import { Product, InventoryItem, SaleRecord, ReorderRecommendation } from './types';
import { parseInventoryCSV, parseSalesCSV } from './utils/csvParser';
import { calculateRecommendations } from './utils/calculations';

export default function Home() {
  const [products, setProducts] = useState<Product[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [sales, setSales] = useState<SaleRecord[]>([]);
  const [recommendations, setRecommendations] = useState<ReorderRecommendation[]>([]);
  const [inventoryFileName, setInventoryFileName] = useState('');
  const [salesFileName, setSalesFileName] = useState('');

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
      
      // Recalculate if we have sales data
      if (sales.length > 0) {
        const recs = calculateRecommendations(parsed.products, parsed.inventory, sales);
        setRecommendations(recs);
      }
    };
    
    reader.readAsText(file);
  }, [sales]);

  const handleSalesUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setSalesFileName(file.name);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseSalesCSV(text);
      setSales(parsed);
      
      // Recalculate if we have inventory data
      if (products.length > 0) {
        const recs = calculateRecommendations(products, inventory, parsed);
        setRecommendations(recs);
      }
    };
    
    reader.readAsText(file);
  }, [products, inventory]);

  const handleExport = () => {
    const coreRecs = recommendations.filter(r => r.isCore && r.suggestedQty > 0);
    
    let csv = 'Style,Color,Size,Current Stock,Daily Velocity,Days Until Stockout,Suggested Qty,Reason\n';
    for (const r of coreRecs) {
      csv += `"${r.style}","${r.color}","${r.size}",${r.currentStock},${r.dailyVelocity.toFixed(2)},${r.daysUntilStockout},${r.suggestedQty},"${r.reason}"\n`;
    }
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reorder_plan_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  const criticalCount = recommendations.filter(r => r.isCore && r.suggestedQty > 0).length;
  const coreItems = recommendations.filter(r => r.isCore);

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
          
          <div className="mt-4 p-4 bg-blue-50 rounded text-sm text-blue-800">
            <p><strong>Expected Files:</strong></p>
            <ul className="list-disc ml-5 mt-1">
              <li>Inventory: ApparelMagic Current Inventory export (Style/Color/Size matrix)</li>
              <li>Sales: ApparelMagic Sales report (Style, Color, Size, Units, Net Sales)</li>
            </ul>
          </div>
        </div>

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

        {/* Action List */}
        {recommendations.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b flex justify-between items-center">
              <h2 className="text-xl font-semibold">Action List</h2>
              {criticalCount > 0 && (
                <button
                  onClick={handleExport}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Export Reorder Plan ({criticalCount} items)
                </button>
              )}
            </div>
            
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Stock</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Daily Sales</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Days Left</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Reorder Qty</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {recommendations
                    .filter(r => r.isCore) // Only show Core items
                    .map((rec) => (
                    <tr key={`${rec.style}-${rec.color}-${rec.size}`} className={rec.suggestedQty > 0 ? 'bg-red-50' : ''}>
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
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
