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
    const { workspaceId, daysBack = 90, archiveThreshold = 365 } = body;

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
      archived: 0,
      filtered: 0,
    };

    // === FETCH PRODUCT ATTRIBUTES TO FILTER BY "CORE" ===
    console.log('🏷️ Fetching product attributes for Core filtering...');
    const allProducts = await client.getAllProducts();

    // Build map of style_number -> attributes
    const productAttributes = new Map<string, { attr2: string; attr3: string; season: string; isCore: boolean }>();
    for (const product of allProducts) {
      const attrs = {
        attr2: (product as any).attr_2 || '',
        attr3: (product as any).attr_3 || '',
        season: (product as any).season || '',
      };

      // Check if this product has "Core" anywhere in attributes
      const isCore =
        String(attrs.attr2).toLowerCase() === 'core' ||
        String(attrs.attr3).toLowerCase() === 'core' ||
        String(attrs.season).toLowerCase() === 'core' ||
        String((product as any).notes || '').toLowerCase().includes('core');

      const styleKey = (product as any).style_number 
        ? String((product as any).style_number) 
        : String((product as any).id);
      
      productAttributes.set(styleKey, {
        ...attrs,
        isCore,
      });
    }

    const coreStyleNumbers = new Set(
      Array.from(productAttributes.entries())
        .filter(([_, attrs]) => attrs.isCore)
        .map(([style, _]) => style)
    );

    console.log(`📊 Found ${coreStyleNumbers.size} Core styles out of ${allProducts.length} total`);

    // Fetch 2 years of sales for activity analysis
    const twoYearsAgo = new Date();
    twoYearsAgo.setDate(twoYearsAgo.getDate() - 730);

    console.log('📊 Fetching sales history for activity analysis...');
    const allInvoices = await client.getAllInvoices(twoYearsAgo.toISOString().split('T')[0]);

    // Build activity map: sku -> last sale date, total sales
    const skuActivity = new Map<string, { lastSale: string; totalUnits: number }>();
    for (const invoice of allInvoices) {
      if (!invoice.invoice_items) continue;

      for (const item of invoice.invoice_items) {
        const existing = skuActivity.get(item.sku_id);
        if (!existing || new Date(invoice.date) > new Date(existing.lastSale)) {
          skuActivity.set(item.sku_id, {
            lastSale: invoice.date,
            totalUnits: (existing?.totalUnits || 0) + (parseInt(item.qty) || 0)
          });
        } else {
          existing.totalUnits += parseInt(item.qty) || 0;
        }
      }
    }

    // === 1. SYNC PRODUCTS & INVENTORY WITH FILTERING ===
    console.log('📦 Fetching inventory...');
    const inventory = await client.getAllInventory();

    // Filter to only Core items
    const coreInventory = inventory.filter(item =>
      coreStyleNumbers.has(item.style_number)
    );

    console.log(`📊 Filtered to ${coreInventory.length} Core items out of ${inventory.length} total`);

    const now = new Date();
    const archiveDate = new Date();
    archiveDate.setDate(archiveDate.getDate() - archiveThreshold);

    const activeInventory = [];
    const archivedSkus = [];

    for (const item of coreInventory) {
      const activity = skuActivity.get(item.sku_id);
      const daysSinceLastSale = activity
        ? Math.floor((now.getTime() - new Date(activity.lastSale).getTime()) / (1000 * 60 * 60 * 24))
        : 9999;

      // Filter criteria:
      // 1. Has sales in last 12 months OR
      // 2. Has inventory > 0 OR  
      // 3. Has open PO qty > 0
      const shouldKeep = 
        (activity && daysSinceLastSale < archiveThreshold) ||
        (parseFloat(item.qty_inventory) || 0) > 0 ||
        (parseFloat(item.qty_open_po) || 0) > 0;
      
      if (shouldKeep) {
        activeInventory.push(item);
      } else {
        archivedSkus.push({
          sku: item.sku_concat || item.sku_id,
          style: item.style_number,
          lastSale: activity?.lastSale,
          daysSinceLastSale,
        });
      }
    }

    results.filtered = coreInventory.length - activeInventory.length;
    results.archived = archivedSkus.length;

    console.log(`📋 Active: ${activeInventory.length}, Archived: ${archivedSkus.length}`);

    // Mark archived items in database
    if (archivedSkus.length > 0) {
      for (const sku of archivedSkus) {
        // Mark in products table
        await serviceSupabase
          .from('products')
          .upsert({
            workspace_id: workspaceId,
            sku: sku.sku,
            style: sku.style,
            is_archived: true,
            archived_at: new Date().toISOString(),
            archive_reason: sku.lastSale
              ? `No sales in ${sku.daysSinceLastSale} days`
              : 'No sales history',
          }, { onConflict: 'workspace_id,sku' });

        // Also mark in inventory_levels (for dashboard filtering)
        await serviceSupabase
          .from('inventory_levels')
          .update({
            is_archived: true,
            archived_at: new Date().toISOString()
          })
          .eq('workspace_id', workspaceId)
          .eq('sku', sku.sku);
      }
    }

    // Also un-archive items that are now active again
    for (const item of activeInventory) {
      await serviceSupabase
        .from('inventory_levels')
        .update({
          is_archived: false,
          archived_at: null
        })
        .eq('workspace_id', workspaceId)
        .eq('sku', item.sku_concat || item.sku_id);
    }

    // Transform active inventory for products table
    const transformedProducts = activeInventory.map((item) => ({
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
      is_archived: false,
      last_sale_date: skuActivity.get(item.sku_id)?.lastSale || null,
      total_sold_24mo: skuActivity.get(item.sku_id)?.totalUnits || 0,
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

    // Transform for inventory_levels table (only active)
    const transformedInventory = activeInventory.map((item) => ({
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

    // === 2. SYNC SALES (only sync active items' sales) ===
    console.log('💰 Fetching recent sales...');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);

    const activeSkuSet = new Set(activeInventory.map(i => i.sku_id));

    const salesRecords: any[] = [];
    for (const invoice of allInvoices.slice(0, 500)) { // Limit recent invoices
      if (!invoice.invoice_items) continue;

      for (const item of invoice.invoice_items) {
        // Only sync sales for active items
        if (!activeSkuSet.has(item.sku_id)) continue;

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

    // === 3. SYNC VENDORS (only for active items) ===
    console.log('🏢 Fetching vendors...');
    const vendors = await client.getAllVendors();
    const products = await client.getAllProducts();

    const vendorMap = new Map<string, string>();
    for (const vendor of vendors) {
      vendorMap.set(vendor.id, vendor.name);
    }

    const activeStyles = new Set(activeInventory.map(i => i.style_number));
    let vendorUpdates = 0;

    for (const product of products) {
      if (!product.vendor_id || !product.style_number) continue;
      if (!activeStyles.has(product.style_number)) continue; // Skip archived styles

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

    results.vendors = vendors.length;

    // === 4. UPDATE SYNC TIMESTAMP ===
    const nowISO = new Date().toISOString();
    await serviceSupabase
      .from('apparelmagic_connections')
      .update({
        last_sync_at: nowISO,
        last_inventory_sync: nowISO,
        last_sales_sync: nowISO,
        last_vendor_sync: nowISO,
      })
      .eq('workspace_id', workspaceId);

    return NextResponse.json({
      success: true,
      ...results,
      message: `Synced ${results.products} active products (${results.filtered} archived), ${results.sales} sales, ${results.vendors} vendors`,
    });

  } catch (error) {
    console.error('Sync all error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
