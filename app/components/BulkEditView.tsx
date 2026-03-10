'use client';

import { useState, useEffect, useMemo } from 'react';
import { createClient } from '@/app/lib/supabase/client';
import { useWorkspace } from '@/app/context/WorkspaceContext';

interface BulkEditItem {
  sku: string;
  style: string;
  color: string;
  size: string;
  vendor_name: string | null;
  lead_time_days: number;
  moq: number;
  safety_stock_days: number;
}

export default function BulkEditView() {
  const { currentWorkspace } = useWorkspace();
  const supabase = createClient();
  
  const [inventory, setInventory] = useState<any[]>([]);
  const [settings, setSettings] = useState<Map<string, any>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterVendor, setFilterVendor] = useState<string>('all');
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [editMode, setEditMode] = useState<false | 'single' | 'bulk'>(false);
  const [bulkValues, setBulkValues] = useState({
    vendor_name: '',
    lead_time_days: 60,
    moq: 1,
    safety_stock_days: 14
  });
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvPreview, setCsvPreview] = useState<any[]>([]);

  useEffect(() => {
    if (!currentWorkspace) return;
    
    const loadData = async () => {
      setLoading(true);
      
      const [{ data: invData }, { data: settingsData }] = await Promise.all([
        supabase.from('inventory_levels').select('*').eq('workspace_id', currentWorkspace.id),
        supabase.from('product_settings').select('*').eq('workspace_id', currentWorkspace.id)
      ]);
      
      if (invData) setInventory(invData);
      
      if (settingsData) {
        const settingsMap = new Map<string, any>();
        for (const s of settingsData) settingsMap.set(s.sku, s);
        setSettings(settingsMap);
      }
      
      setLoading(false);
    };
    
    loadData();
  }, [currentWorkspace, supabase]);

  // Build editable items list
  const items = useMemo<BulkEditItem[]>(() => {
    return inventory.map(item => {
      const setting = settings.get(item.sku);
      return {
        sku: item.sku,
        style: item.style,
        color: item.color,
        size: item.size,
        vendor_name: setting?.vendor_name || null,
        lead_time_days: setting?.lead_time_days || 60,
        moq: setting?.moq || 1,
        safety_stock_days: setting?.safety_stock_days || 14
      };
    });
  }, [inventory, settings]);

  // Get unique vendors for filter
  const vendors = useMemo(() => {
    const vendorSet = new Set<string>();
    items.forEach(item => {
      if (item.vendor_name) vendorSet.add(item.vendor_name);
    });
    return Array.from(vendorSet).sort();
  }, [items]);

  // Filter items
  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesSearch = 
        item.style.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.color.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.sku.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesVendor = filterVendor === 'all' || item.vendor_name === filterVendor;
      
      return matchesSearch && matchesVendor;
    });
  }, [items, searchTerm, filterVendor]);

  // Toggle selection
  const toggleSelection = (sku: string) => {
    const next = new Set(selectedItems);
    if (next.has(sku)) next.delete(sku);
    else next.add(sku);
    setSelectedItems(next);
  };

  // Select all visible
  const selectAll = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map(i => i.sku)));
    }
  };

  // Save single item
  const saveItem = async (item: BulkEditItem) => {
    if (!currentWorkspace) return;
    
    const { error } = await supabase
      .from('product_settings')
      .upsert({
        workspace_id: currentWorkspace.id,
        sku: item.sku,
        style: item.style,
        color: item.color,
        size: item.size,
        vendor_name: item.vendor_name,
        lead_time_days: item.lead_time_days,
        moq: item.moq,
        safety_stock_days: item.safety_stock_days,
        is_manual_lead_time: true,
        is_manual_moq: true
      }, { onConflict: 'workspace_id,sku' });
    
    if (error) {
      console.error('Save error:', error);
      alert(`Failed to save ${item.sku}`);
    } else {
      // Update local state
      setSettings(prev => {
        const next = new Map(prev);
        next.set(item.sku, { ...prev.get(item.sku), ...item });
        return next;
      });
    }
  };

  // Bulk save
  const saveBulk = async () => {
    if (!currentWorkspace || selectedItems.size === 0) return;
    
    setSaving(true);
    
    const updates = Array.from(selectedItems).map(sku => {
      const item = items.find(i => i.sku === sku)!;
      return {
        workspace_id: currentWorkspace.id,
        sku,
        style: item.style,
        color: item.color,
        size: item.size,
        vendor_name: bulkValues.vendor_name || item.vendor_name,
        lead_time_days: bulkValues.lead_time_days,
        moq: bulkValues.moq,
        safety_stock_days: bulkValues.safety_stock_days,
        is_manual_lead_time: true,
        is_manual_moq: true
      };
    });
    
    // Batch upsert (Supabase supports batch)
    const { error } = await supabase
      .from('product_settings')
      .upsert(updates, { onConflict: 'workspace_id,sku' });
    
    if (error) {
      console.error('Bulk save error:', error);
      alert('Failed to save some items');
    } else {
      // Refresh settings
      const { data } = await supabase
        .from('product_settings')
        .select('*')
        .eq('workspace_id', currentWorkspace.id);
      
      if (data) {
        const settingsMap = new Map<string, any>();
        for (const s of data) settingsMap.set(s.sku, s);
        setSettings(settingsMap);
      }
      
      setSelectedItems(new Set());
      setEditMode(false);
      alert(`Updated ${updates.length} items`);
    }
    
    setSaving(false);
  };

  // Export CSV template
  const exportTemplate = () => {
    const headers = ['sku', 'style', 'color', 'size', 'vendor_name', 'lead_time_days', 'moq', 'safety_stock_days'];
    const rows = items.slice(0, 5).map(item => [
      item.sku,
      item.style,
      item.color,
      item.size,
      item.vendor_name || '',
      item.lead_time_days,
      item.moq,
      item.safety_stock_days
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bulk_edit_template.csv';
    a.click();
  };

  // Import CSV
  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter(l => l.trim());
      const headers = lines[0].split(',').map(h => h.trim());
      
      const data = [];
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row: any = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx];
        });
        data.push(row);
      }
      
      setCsvPreview(data);
    };
    reader.readAsText(file);
    setCsvFile(file);
  };

  // Apply CSV import
  const applyCsvImport = async () => {
    if (!currentWorkspace || csvPreview.length === 0) return;
    
    setSaving(true);
    
    const updates = csvPreview
      .filter(row => row.sku)
      .map(row => ({
        workspace_id: currentWorkspace.id,
        sku: row.sku,
        style: row.style || '',
        color: row.color || '',
        size: row.size || '',
        vendor_name: row.vendor_name || null,
        lead_time_days: parseInt(row.lead_time_days) || 60,
        moq: parseInt(row.moq) || 1,
        safety_stock_days: parseInt(row.safety_stock_days) || 14,
        is_manual_lead_time: true,
        is_manual_moq: true
      }));
    
    const { error } = await supabase
      .from('product_settings')
      .upsert(updates, { onConflict: 'workspace_id,sku' });
    
    if (error) {
      console.error('Import error:', error);
      alert('Import failed');
    } else {
      // Refresh
      const { data } = await supabase
        .from('product_settings')
        .select('*')
        .eq('workspace_id', currentWorkspace.id);
      
      if (data) {
        const settingsMap = new Map<string, any>();
        for (const s of data) settingsMap.set(s.sku, s);
        setSettings(settingsMap);
      }
      
      setCsvFile(null);
      setCsvPreview([]);
      alert(`Imported ${updates.length} items`);
    }
    
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">Bulk Edit Settings</h2>
        <div className="flex gap-2">
          <button
            onClick={exportTemplate}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Download Template
          </button>
          <label className="px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 rounded-lg cursor-pointer">
            Import CSV
            <input
              type="file"
              accept=".csv"
              onChange={handleCsvUpload}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* CSV Preview */}
      {csvPreview.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-800 mb-2">CSV Preview: {csvPreview.length} rows</p>
          <div className="flex gap-2">
            <button
              onClick={applyCsvImport}
              disabled={saving}
              className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50"
            >
              {saving ? 'Importing...' : 'Apply Import'}
            </button>
            <button
              onClick={() => { setCsvFile(null); setCsvPreview([]); }}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3">
        <input
          type="text"
          placeholder="Search style, color, SKU..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="flex-1 border border-gray-200 rounded-lg px-4 py-2 text-sm"
        />
        <select
          value={filterVendor}
          onChange={(e) => setFilterVendor(e.target.value)}
          className="border border-gray-200 rounded-lg px-4 py-2 text-sm"
        >
          <option value="all">All Vendors</option>
          {vendors.map(v => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>

      {/* Bulk Actions */}
      {selectedItems.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between">
          <span className="text-sm text-blue-800">{selectedItems.size} items selected</span>
          <div className="flex gap-2">
            <button
              onClick={() => setEditMode('bulk')}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
            >
              Edit Selected
            </button>
            <button
              onClick={() => setSelectedItems(new Set())}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Bulk Edit Panel */}
      {editMode === 'bulk' && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-lg">
          <h3 className="font-semibold text-gray-900 mb-4">Edit {selectedItems.size} Items</h3>
          
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
              <input
                type="text"
                value={bulkValues.vendor_name}
                onChange={(e) => setBulkValues({...bulkValues, vendor_name: e.target.value})}
                placeholder="Leave blank to keep current"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Lead Time (days)</label>
              <input
                type="number"
                value={bulkValues.lead_time_days}
                onChange={(e) => setBulkValues({...bulkValues, lead_time_days: parseInt(e.target.value) || 60})}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">MOQ</label>
              <input
                type="number"
                value={bulkValues.moq}
                onChange={(e) => setBulkValues({...bulkValues, moq: parseInt(e.target.value) || 1})}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Safety Stock (days)</label>
              <input
                type="number"
                value={bulkValues.safety_stock_days}
                onChange={(e) => setBulkValues({...bulkValues, safety_stock_days: parseInt(e.target.value) || 14})}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={saveBulk}
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            <button
              onClick={() => setEditMode(false)}
              className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Items Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50/50">
            <tr>
              <th className="py-3 px-4">
                <input
                  type="checkbox"
                  checked={filteredItems.length > 0 && selectedItems.size === filteredItems.length}
                  onChange={selectAll}
                  className="rounded border-gray-300"
                />
              </th>
              <th className="text-left py-3 px-4 font-semibold text-gray-700">SKU</th>
              <th className="text-left py-3 px-4 font-semibold text-gray-700">Vendor</th>
              <th className="text-center py-3 px-4 font-semibold text-gray-700">Lead Time</th>
              <th className="text-center py-3 px-4 font-semibold text-gray-700">MOQ</th>
              <th className="text-center py-3 px-4 font-semibold text-gray-700">Safety</th>
              <th className="text-right py-3 px-4 font-semibold text-gray-700">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredItems.map((item) => (
              <tr key={item.sku} className={selectedItems.has(item.sku) ? 'bg-blue-50' : 'hover:bg-gray-50/50'}>
                <td className="py-3 px-4">
                  <input
                    type="checkbox"
                    checked={selectedItems.has(item.sku)}
                    onChange={() => toggleSelection(item.sku)}
                    className="rounded border-gray-300"
                  />
                </td>
                <td className="py-3 px-4">
                  <div className="font-medium">{item.style}</div>
                  <div className="text-gray-500">{item.color} · {item.size}</div>
                </td>
                <td className="py-3 px-4">
                  <input
                    type="text"
                    value={item.vendor_name || ''}
                    onChange={(e) => {
                      const updated = items.map(i => 
                        i.sku === item.sku ? {...i, vendor_name: e.target.value} : i
                      );
                      // This won't work with useMemo, need different approach
                    }}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-sm"
                    placeholder="Vendor name"
                  />
                </td>
                <td className="py-3 px-4 text-center">{item.lead_time_days}d</td>
                <td className="py-3 px-4 text-center">{item.moq}</td>
                <td className="py-3 px-4 text-center">{item.safety_stock_days}d</td>
                <td className="py-3 px-4 text-right">
                  <button
                    onClick={() => saveItem(item)}
                    className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                  >
                    Save
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {filteredItems.length === 0 && (
          <div className="text-center py-12 text-gray-500">
            No items match your filters
          </div>
        )}
      </div>
    </div>
  );
}
