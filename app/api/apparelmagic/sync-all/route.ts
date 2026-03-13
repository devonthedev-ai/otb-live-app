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
    
    // Get credentials AND target_season
    const serviceSupabase = createServiceClient();
    const { data: connection } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token, target_season')
      .eq('workspace_id', workspaceId)
      .single();
    
    if (!connection) {
      return NextResponse.json(
        { error: 'ApparelMagic not connected' },
        { status: 400 }
      );
    }
    
    const credentials = { subdomain: connection.subdomain, token: connection.token };
    const targetSeason = connection.target_season || 'SS26';
    
    const client = new ApparelMagicClient(credentials);
    const results = {
      products: 0,
      inventory: 0,
      sales: 0,
      vendors: 0,
      archived: 0,
      filtered: 0,
      targetSeason: targetSeason,
    };
    
    // === FETCH PRODUCTS IN CHUNKS AND BUILD SEASON MAP ===
    console.log(`🏷️ Fetching products in chunks to find ${targetSeason}...`);
    
    const targetStyleNumbers = new Set<string>();
    const uniqueSeasons = new Set<string>();
    let lastId: string | undefined;
    let pageCount = 0;
    const maxPages = 20; // Limit to 2000 products to avoid timeout
    
    while (pageCount < maxPages) {
      pageCount++;
      console.log(`Fetching products page ${pageCount}, lastId: ${lastId || 'none'}`);
      
      const { products, lastId: newLastId } = await client.getProducts(
        lastId ? { lastId } : undefined
      );
      
      console.log(`Page ${pageCount}: got ${products.length} products`);
      
      if (products.length === 0) break;
      
      // Process this chunk immediately
      for (const product of products) {
        const styleNumber = String((product as any).style_number || '');
        const season = (product as any).season || '';
        
        if (season) {
          uniqueSeasons.add(String(season));
          if (season.toLowerCase() === targetSeason.toLowerCase() && styleNumber) {
            targetStyleNumbers.add(styleNumber);
          }
        }
      }
      
      // Check if we found our target season
      const hasTargetSeason = Array.from(uniqueSeasons).some(s => 
        s.toLowerCase() === targetSeason.toLowerCase()
      );
      
      // If we found the target season and collected some styles, we can stop
      // But continue a bit more to make sure we get all of that season
      if (hasTargetSeason && targetStyleNumbers.size > 0 && pageCount > 5) {
        console.log(`Found ${targetSeason} with ${targetStyleNumbers.size} styles, stopping after ${pageCount} pages`);
        break;
      }
      
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    console.log('📋 Seasons found:', Array.from(uniqueSeasons).slice(0, 20));
    console.log(`📊 Found ${targetStyleNumbers.size} ${targetSeason} styles from ${pageCount} pages`);
    
    if (targetStyleNumbers.size === 0) {
      return NextResponse.json({
        success: true,
        ...results,
        message: `No ${targetSeason} products found. Available seasons: ${Array.from(uniqueSeasons).join(', ')}`,
        availableSeasons: Array.from(uniqueSeasons),
      });
    }
    
    // === FETCH INVENTORY AND FILTER ===
    console.log('📦 Fetching inventory...');
    const inventory = await client.getAllInventory();
    
    const targetInventory = inventory.filter(item =>
      targetStyleNumbers.has(item.style_number)
    );
    
    console.log(`📊 Found ${targetInventory.length} ${targetSeason} items out of ${inventory.length} total inventory`);
    
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
    
    // === PROCESS ACTIVE VS ARCHIVED ===
    const now = new Date();
    const activeInventory = [];
    const archivedSkus = [];
    
    for (const item of targetInventory) {
      const activity = skuActivity.get(item.sku_id);
      const daysSinceLastSale = activity 
        ? Math.floor((now.getTime() - new Date(activity.lastSale).getTime()) / (1000 * 60 * 60 * 24))
        : 9999;
      
      // Filter criteria:
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
    
    results.filtered = targetInventory.length - activeInventory.length;
    results.archived = archivedSkus.length;
    
    console.log(`📋 Active ${targetSeason}: ${activeInventory.length}, Archived: ${archivedSkus.length}`);
    
    // === SYNC TO DATABASE ===
    
    // Mark archived items
    if (archivedSkus.length > 0) {
      for (const sku of archivedSkus) {
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
      }
    }
    
    // Un-archive active items
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
    
    // Transform and sync products
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
      category: targetSeason, // Tag with season
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
    
    // Transform and sync inventory
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
    
    // Sync sales
    const activeSkuSet = new Set(activeInventory.map(i => i.sku_id));
    const salesRecords: any[] = [];
    
    for (const invoice of allInvoices.slice(0, 500)) {
      if (!invoice.invoice_items) continue;
      
      for (const item of invoice.invoice_items) {
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
    
    // Sync vendors (lightweight - just count)
    const vendors = await client.getAllVendors();
    results.vendors = vendors.length;
    
    // Update timestamps
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
      availableSeasons: Array.from(uniqueSeasons),
      message: `Synced ${results.products} active ${targetSeason} products (${results.filtered} archived), ${results.sales} sales`,
    });
    
  } catch (error) {
    console.error('Sync all error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}
