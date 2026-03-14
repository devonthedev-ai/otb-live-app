import { createServiceClient } from '@/app/lib/supabase/service';
import { NextRequest, NextResponse } from 'next/server';

// Simple sync that fetches limited data to stay within Vercel 10s timeout
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { workspaceId } = body;
    
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
    }
    
    const serviceSupabase = createServiceClient();
    
    // Get connection
    const { data: connection, error: connError } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token, target_season')
      .eq('workspace_id', workspaceId)
      .single();
    
    if (connError || !connection) {
      return NextResponse.json({ error: 'No ApparelMagic connection' }, { status: 400 });
    }
    
    // Create sync job record
    const { data: job } = await serviceSupabase
      .from('sync_jobs')
      .insert({
        workspace_id: workspaceId,
        job_type: 'apparelmagic_sync',
        status: 'running',
        message: 'Starting sync...',
        progress: 5,
        started_at: new Date().toISOString(),
      })
      .select()
      .single();
    
    const jobId = job?.id;
    
    // Import and sync
    const { ApparelMagicClient } = await import('@/app/lib/apparelmagic/api');
    const client = new ApparelMagicClient({
      subdomain: connection.subdomain,
      token: connection.token
    });
    
    const targetSeason = connection.target_season || 'SS26';
    
    // STEP 1: Fetch products (limited to avoid timeout)
    await serviceSupabase
      .from('sync_jobs')
      .update({ message: 'Fetching products...', progress: 20 })
      .eq('id', jobId);
    
    // Only fetch first 500 products to stay within timeout
    let allProducts: any[] = [];
    let lastId: string | undefined;
    let pageCount = 0;
    const maxPages = 5; // Limit to 500 products
    
    while (pageCount < maxPages) {
      const { products, lastId: newLastId } = await client.getProducts(
        lastId ? { lastId } : undefined
      );
      
      if (products.length === 0) break;
      allProducts.push(...products);
      pageCount++;
      
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    // Find target season
    const targetStyles = new Set<string>();
    const uniqueSeasons = new Set<string>();
    
    for (const product of allProducts) {
      const styleNumber = String((product as any).style_number || '');
      const season = (product as any).season || '';
      if (season) uniqueSeasons.add(String(season));
      if (styleNumber && season?.toLowerCase() === targetSeason.toLowerCase()) {
        targetStyles.add(styleNumber);
      }
    }
    
    if (targetStyles.size === 0) {
      await serviceSupabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          message: `No ${targetSeason} products found in first 500`,
          error: JSON.stringify({ 
            availableSeasons: Array.from(uniqueSeasons).slice(0, 10),
            note: 'Only checked first 500 products due to timeout limits'
          }),
          progress: 100,
        })
        .eq('id', jobId);
      
      return NextResponse.json({
        success: false,
        error: `No ${targetSeason} products found in first 500`,
        availableSeasons: Array.from(uniqueSeasons).slice(0, 10),
        checkedProducts: allProducts.length,
      });
    }
    
    // STEP 2: Fetch inventory
    await serviceSupabase
      .from('sync_jobs')
      .update({ message: 'Fetching inventory...', progress: 50 })
      .eq('id', jobId);
    
    const inventory = await client.getAllInventory();
    const targetInventory = inventory.filter(item =>
      targetStyles.has(item.style_number)
    );
    
    // STEP 3: Fetch limited sales
    await serviceSupabase
      .from('sync_jobs')
      .update({ message: 'Fetching sales...', progress: 70 })
      .eq('id', jobId);
    
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    const allInvoices = await client.getAllInvoices(ninetyDaysAgo.toISOString().split('T')[0]);
    
    // Build activity map
    const skuActivity = new Map<string, { lastSale: string; totalUnits: number }>();
    for (const invoice of allInvoices.slice(0, 200)) { // Limit invoices
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
    
    // STEP 4: Save to database
    await serviceSupabase
      .from('sync_jobs')
      .update({ message: 'Saving to database...', progress: 85 })
      .eq('id', jobId);
    
    // Transform and save products
    const transformedProducts = targetInventory.map((item) => ({
      workspace_id: workspaceId,
      external_id: item.sku_id,
      name: `${item.style_number} ${item.attr_2 || ''} ${item.size || ''}`.trim(),
      sku: item.sku_concat || item.sku_id,
      style: item.style_number,
      color: item.attr_2 || 'Unknown',
      size: item.size || 'Unknown',
      cost: parseFloat(item.cost || '0') || 0,
      price: parseFloat(item.price || '0') || 0,
      category: targetSeason,
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
    
    // Save inventory
    const transformedInventory = targetInventory.map((item) => ({
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
    
    // Save limited sales
    const activeSkuSet = new Set(targetInventory.map(i => i.sku_id));
    const salesRecords: any[] = [];
    
    for (const invoice of allInvoices.slice(0, 200)) {
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
    
    // Update connection timestamp
    await serviceSupabase
      .from('apparelmagic_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId);
    
    // Mark complete
    await serviceSupabase
      .from('sync_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        message: 'Sync completed',
        progress: 100,
        results: {
          productsSynced: uniqueProducts.length,
          inventorySynced: uniqueInventory.length,
          salesSynced: uniqueSales.length,
          season: targetSeason,
          productsChecked: allProducts.length,
        },
      })
      .eq('id', jobId);
    
    return NextResponse.json({
      success: true,
      message: 'Sync completed',
      results: {
        productsSynced: uniqueProducts.length,
        inventorySynced: uniqueInventory.length,
        salesSynced: uniqueSales.length,
        season: targetSeason,
        productsChecked: allProducts.length,
      }
    });
    
  } catch (error) {
    console.error('Sync error:', error);
    return NextResponse.json(
      { error: 'Sync failed', details: String(error) },
      { status: 500 }
    );
  }
}

// GET status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    
    const serviceSupabase = createServiceClient();
    
    const { data: jobs } = await serviceSupabase
      .from('sync_jobs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(1);
    
    return NextResponse.json({
      success: true,
      jobs: jobs || [],
    });
    
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
