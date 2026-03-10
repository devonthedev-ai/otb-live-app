import { createClient } from '@/app/lib/supabase/server';
import { createServiceClient } from '@/app/lib/supabase/service';
import { NextRequest, NextResponse } from 'next/server';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const { workspaceId, daysBack = 90 } = body;
    
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'Workspace ID required' },
        { status: 400 }
      );
    }
    
    // Check permissions
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();
    
    if (!membership || !['owner', 'admin', 'buyer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    // Get credentials
    const serviceSupabase = createServiceClient();
    const { data: credentials } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token')
      .eq('workspace_id', workspaceId)
      .single();
    
    if (!credentials) {
      return NextResponse.json(
        { error: 'ApparelMagic not connected' },
        { status: 400 }
      );
    }
    
    const client = new ApparelMagicClient(credentials);
    const results = {
      products: 0,
      inventory: 0,
      sales: 0,
      vendors: 0,
    };
    
    // === 1. SYNC PRODUCTS & INVENTORY (from inventory endpoint) ===
    console.log('📦 Fetching inventory...');
    const inventory = await client.getAllInventory();
    
    // Transform for products table
    const transformedProducts = inventory.map((item) => ({
      workspace_id: workspaceId,
      external_id: item.sku_id,
      name: `${item.style_number} ${item.attr_2 || ''} ${item.size || ''}`.trim(),
      sku: item.sku_concat || item.sku_id,
      style: item.style_number,
      color: item.attr_2 || 'Unknown',
      size: item.size || 'Unknown',
      cost: parseFloat(item.cost || '0') || 0,
      price: parseFloat(item.price || '0') || 0,
      category: 'Uncategorized',
      source: 'apparelmagic',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    
    const uniqueProducts = Array.from(
      new Map(transformedProducts.map(p => [p.sku, p])).values()
    );
    
    await serviceSupabase
      .from('products')
      .upsert(uniqueProducts, { onConflict: 'workspace_id,sku' });
    
    results.products = uniqueProducts.length;
    
    // Transform for inventory_levels table
    const transformedInventory = inventory.map((item) => ({
      workspace_id: workspaceId,
      external_id: item.sku_id,
      sku: item.sku_concat || item.sku_id,
      style: item.style_number,
      color: item.attr_2 || 'Unknown',
      size: item.size || 'Unknown',
      qty_on_hand: parseFloat(item.qty_inventory) || 0,
      qty_available: parseFloat(item.qty_avail_sell) || 0,
      qty_allocated: parseFloat(item.qty_alloc) || 0,
      qty_reserved: parseFloat(item.qty_picked) || 0,
      qty_open_po: parseFloat(item.qty_open_po || '0') || 0,
      upc: item.upc_display || item.upc_11 || '',
      cost: parseFloat(item.cost || '0') || 0,
      price: parseFloat(item.price || '0') || 0,
      weight: parseFloat(item.weight || '0') || 0,
      source: 'apparelmagic',
      last_synced_at: new Date().toISOString(),
    }));
    
    const uniqueInventory = Array.from(
      new Map(transformedInventory.map(i => [i.sku, i])).values()
    );
    
    await serviceSupabase
      .from('inventory_levels')
      .upsert(uniqueInventory, { onConflict: 'workspace_id,sku' });
    
    results.inventory = uniqueInventory.length;
    
    // === 2. SYNC SALES ===
    console.log('💰 Fetching sales...');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    const invoices = await client.getAllInvoices(startDateStr);
    
    const salesRecords: any[] = [];
    for (const invoice of invoices) {
      if (!invoice.invoice_items || !Array.isArray(invoice.invoice_items)) continue;
      
      for (const item of invoice.invoice_items) {
        salesRecords.push({
          workspace_id: workspaceId,
          external_id: item.id,
          invoice_id: invoice.invoice_id,
          sku: item.sku_id,
          style: item.style_number,
          color: item.attr_2 || 'Unknown',
          size: item.size || 'Unknown',
          units: parseInt(item.qty) || 0,
          unit_price: parseFloat(item.unit_price) || 0,
          net_sales: parseFloat(item.amount) || 0,
          sale_date: invoice.date,
          customer_id: invoice.customer_id,
          channel: 'wholesale',
          source: 'apparelmagic',
        });
      }
    }
    
    const uniqueSales = Array.from(
      new Map(salesRecords.map(s => [s.external_id, s])).values()
    );
    
    await serviceSupabase
      .from('sales')
      .upsert(uniqueSales, { onConflict: 'workspace_id,external_id' });
    
    results.sales = uniqueSales.length;
    
    // === 3. SYNC VENDORS ===
    console.log('🏢 Fetching vendors...');
    const vendors = await client.getAllVendors();
    const products = await client.getAllProducts();
    
    const vendorMap = new Map<string, string>();
    for (const vendor of vendors) {
      vendorMap.set(vendor.id, vendor.name);
    }
    
    let vendorUpdates = 0;
    for (const product of products) {
      if (product.vendor_id && product.style_number) {
        const vendorName = vendorMap.get(product.vendor_id);
        if (vendorName) {
          const { data: skus } = await serviceSupabase
            .from('inventory_levels')
            .select('sku, style')
            .eq('workspace_id', workspaceId)
            .eq('style', product.style_number);
          
          if (skus && skus.length > 0) {
            for (const sku of skus) {
              await serviceSupabase
                .from('product_settings')
                .upsert({
                  workspace_id: workspaceId,
                  sku: sku.sku,
                  style: sku.style,
                  vendor_id: product.vendor_id,
                  vendor_name: vendorName,
                }, { onConflict: 'workspace_id,sku' });
              
              vendorUpdates++;
            }
          }
        }
      }
    }
    
    results.vendors = vendors.length;
    
    // === 4. UPDATE SYNC TIMESTAMPS ===
    const now = new Date().toISOString();
    await serviceSupabase
      .from('apparelmagic_connections')
      .update({
        last_sync_at: now,
        last_inventory_sync: now,
        last_sales_sync: now,
        last_vendor_sync: now,
      })
      .eq('workspace_id', workspaceId);
    
    return NextResponse.json({
      success: true,
      ...results,
      message: `Synced ${results.products} products, ${results.inventory} inventory records, ${results.sales} sales, ${results.vendors} vendors`,
    });
    
  } catch (error) {
    console.error('Sync all error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
