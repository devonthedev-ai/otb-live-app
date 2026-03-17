import { createServiceClient } from '@/app/lib/supabase/service';
import { NextRequest, NextResponse } from 'next/server';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';

// Vercel Cron Job - runs daily at 6 AM ET
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const subdomain = searchParams.get('subdomain');
  
  // If subdomain provided, return status
  if (subdomain) {
    try {
      const serviceSupabase = createServiceClient();
      
      const { data: jobs } = await serviceSupabase
        .from('sync_jobs')
        .select('*')
        .eq('workspace_id', subdomain)
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
  
  // Otherwise run the cron job
  console.log('[Vercel Cron] Starting daily ApparelMagic sync...');
  
  const serviceSupabase = createServiceClient();
  const results: any[] = [];
  
  try {
    const { data: connections, error: connError } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token');
    
    if (connError || !connections || connections.length === 0) {
      console.log('[Vercel Cron] No ApparelMagic connections found');
      return NextResponse.json({
        success: true,
        message: 'No workspaces to sync',
        workspaces: 0,
      });
    }
    
    console.log(`[Vercel Cron] Found ${connections.length} workspace(s) to sync`);
    
    for (const conn of connections) {
      try {
        console.log(`[Vercel Cron] Syncing workspace...`);
        const result = await syncWorkspace(conn.subdomain, conn);
        results.push(result);
        console.log(`[Vercel Cron] Workspace synced:`, result);
      } catch (error) {
        console.error(`[Vercel Cron] Failed to sync workspace:`, error);
        results.push({
          subdomain: conn.subdomain,
          success: false,
          error: String(error),
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    console.log(`[Vercel Cron] Completed. ${successCount}/${connections.length} workspaces synced successfully`);
    
    return NextResponse.json({
      success: true,
      message: `Synced ${successCount}/${connections.length} workspaces`,
      results,
    });
    
  } catch (error) {
    console.error('[Vercel Cron] Fatal error:', error);
    return NextResponse.json(
      { error: 'Cron job failed', details: String(error) },
      { status: 500 }
    );
  }
}

async function syncWorkspace(subdomain: string, connection: any) {
  const serviceSupabase = createServiceClient();
  
  const client = new ApparelMagicClient({
    subdomain: connection.subdomain,
    token: connection.token,
  });
  
  const { data: job } = await serviceSupabase
    .from('sync_jobs')
    .insert({
      workspace_id: subdomain,
      job_type: 'apparelmagic_sync',
      status: 'running',
      message: 'Starting full sync...',
      progress: 0,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();
  
  const jobId = job?.id;
  
  try {
    // STEP 1: Fetch inventory (API limited to 100 items)
    await updateJobProgress(serviceSupabase, jobId, 'Fetching inventory...', 10);
    
    console.log(`[Vercel Cron] Fetching inventory...`);
    const inventory = await client.getAllInventory();
    console.log(`[Vercel Cron] Inventory: ${inventory.length} items`);
    
    if (inventory.length === 0) {
      await serviceSupabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          message: 'No products found',
          progress: 100,
        })
        .eq('id', jobId);
      
      return {
        subdomain,
        success: false,
        error: 'No products found',
      };
    }
    
    // STEP 2: Process inventory
    await updateJobProgress(serviceSupabase, jobId, 'Processing inventory...', 40);
    
    console.log(`[Vercel Cron] Processing ${inventory.length} inventory items`);
    
    // STEP 3: Fetch sales
    await updateJobProgress(serviceSupabase, jobId, 'Fetching sales history...', 60);
    
    const twoYearsAgo = new Date();
    twoYearsAgo.setDate(twoYearsAgo.getDate() - 730);
    const allInvoices = await client.getAllInvoices(twoYearsAgo.toISOString().split('T')[0]);
    
    console.log(`[Vercel Cron] Fetched ${allInvoices.length} invoices`);
    
    // Build activity map
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
    
    // STEP 4: Save to database
    await updateJobProgress(serviceSupabase, jobId, 'Saving to database...', 80);
    
    // Save products
    const transformedProducts = inventory.map((item: any) => ({
      workspace_id: subdomain,
      external_id: item.sku_id,
      name: `${item.style_number} ${item.attr_2 || ''} ${item.size || ''}`.trim(),
      sku: item.sku_concat || item.sku_id,
      style: item.style_number,
      color: item.attr_2 || 'Unknown',
      size: item.size || 'Unknown',
      cost: parseFloat(item.cost || '0') || 0,
      price: parseFloat(item.price || '0') || 0,
      category: item.season || 'ALL',
      source: 'apparelmagic',
      is_archived: false,
      last_sale_date: skuActivity.get(item.sku_id)?.lastSale || null,
      total_sold_24mo: skuActivity.get(item.sku_id)?.totalUnits || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    
    const uniqueProducts = Array.from(
      new Map(transformedProducts.map((p: any) => [p.sku, p])).values()
    );
    
    await serviceSupabase
      .from('products')
      .upsert(uniqueProducts, { onConflict: 'workspace_id,sku' });
    
    // Save inventory
    const transformedInventory = inventory.map((item: any) => ({
      workspace_id: subdomain,
      external_id: item.sku_id,
      sku: item.sku_concat || item.sku_id,
      style: item.style_number,
      color: item.attr_2 || 'Unknown',
      size: item.size || 'Unknown',
      qty_on_hand: parseFloat(item.qty_inventory || '0') || 0,
      qty_available: parseFloat(item.qty_avail_sell || '0') || 0,
      qty_allocated: parseFloat(item.qty_alloc || '0') || 0,
      qty_reserved: parseFloat(item.qty_picked || '0') || 0,
      qty_open_po: parseFloat(item.qty_open_po || '0') || 0,
      upc: item.upc_display || item.upc_11 || '',
      cost: parseFloat(item.cost || '0') || 0,
      price: parseFloat(item.price || '0') || 0,
      weight: parseFloat(item.weight || '0') || 0,
      source: 'apparelmagic',
      last_synced_at: new Date().toISOString(),
    }));
    
    const uniqueInventory = Array.from(
      new Map(transformedInventory.map((i: any) => [i.sku, i])).values()
    );
    
    await serviceSupabase
      .from('inventory_levels')
      .upsert(uniqueInventory, { onConflict: 'workspace_id,sku' });
    
    // Save sales
    const activeSkuSet = new Set(inventory.map((i: any) => i.sku_id));
    const salesRecords: any[] = [];
    
    for (const invoice of allInvoices) {
      if (!invoice.invoice_items) continue;
      for (const item of invoice.invoice_items) {
        if (!activeSkuSet.has(item.sku_id)) continue;
        salesRecords.push({
          workspace_id: subdomain,
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
      new Map(salesRecords.map((s: any) => [s.external_id, s])).values()
    );
    
    await serviceSupabase
      .from('sales')
      .upsert(uniqueSales, { onConflict: 'workspace_id,external_id' });
    
    // Update connection timestamp
    await serviceSupabase
      .from('apparelmagic_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('workspace_id', subdomain);
    
    // Mark complete
    await serviceSupabase
      .from('sync_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        message: 'Sync completed successfully',
        progress: 100,
        results: {
          productsSynced: uniqueProducts.length,
          inventorySynced: uniqueInventory.length,
          salesSynced: uniqueSales.length,
        },
      })
      .eq('id', jobId);
    
    console.log(`[Vercel Cron] Workspace ${subdomain} sync complete!`);
    
    return {
      subdomain,
      success: true,
      productsSynced: uniqueProducts.length,
      inventorySynced: uniqueInventory.length,
      salesSynced: uniqueSales.length,
    };
    
  } catch (error) {
    console.error(`[Vercel Cron] Error syncing workspace ${subdomain}:`, error);
    
    await serviceSupabase
      .from('sync_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        message: 'Sync failed',
        error: String(error),
        progress: 100,
      })
      .eq('id', jobId);
    
    throw error;
  }
}

async function updateJobProgress(serviceSupabase: any, jobId: string | undefined, message: string, progress: number) {
  if (!jobId) return;
  
  await serviceSupabase
    .from('sync_jobs')
    .update({ message, progress })
    .eq('id', jobId);
}
// Sync fixed
