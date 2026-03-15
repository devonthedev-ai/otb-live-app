import { createServiceClient } from '@/app/lib/supabase/service';
import { NextRequest, NextResponse } from 'next/server';

// Background sync endpoint - starts a job and returns immediately
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { secret, workspaceId } = body;
    
    // Support multiple valid secrets
    const validSecrets = [
      process.env.CRON_SECRET,
      'tb-live-cron-secret-2024',
      'otb-live-cron-secret-2024'
    ].filter(Boolean);
    
    if (!validSecrets.includes(secret)) {
      return NextResponse.json(
        { error: 'Invalid secret' },
        { status: 401 }
      );
    }
    
    const serviceSupabase = createServiceClient();
    
    // If no workspaceId provided, find all workspaces with AM connections
    let workspaces: string[] = [];
    
    if (workspaceId) {
      workspaces = [workspaceId];
    } else {
      const { data: connections } = await serviceSupabase
        .from('apparelmagic_connections')
        .select('workspace_id');
      
      workspaces = connections?.map(c => c.workspace_id) || [];
    }
    
    if (workspaces.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No workspaces with ApparelMagic connections found',
        jobs: [],
      });
    }
    
    // Create jobs for each workspace
    const jobs = [];
    
    for (const wsId of workspaces) {
      // Check if there's already a running job for this workspace
      const { data: existingJobs } = await serviceSupabase
        .from('sync_jobs')
        .select('id')
        .eq('workspace_id', wsId)
        .in('status', ['pending', 'running'])
        .limit(1);
      
      if (existingJobs && existingJobs.length > 0) {
        jobs.push({
          workspaceId: wsId,
          jobId: existingJobs[0].id,
          status: 'already_running',
          message: 'Sync already in progress for this workspace',
        });
        continue;
      }
      
      // Create new job
      const { data: job } = await serviceSupabase
        .from('sync_jobs')
        .insert({
          workspace_id: wsId,
          job_type: 'apparelmagic_sync',
          status: 'pending',
          message: 'Waiting to start...',
        })
        .select()
        .single();
      
      if (job) {
        jobs.push({
          workspaceId: wsId,
          jobId: job.id,
          status: 'started',
          message: 'Sync job created',
        });
        
        // Trigger the actual sync (fire and forget)
        // This runs in the background, doesn't block the response
        triggerBackgroundSync(job.id, wsId).catch(async (error) => {
          console.error(`Background sync failed for job ${job.id}:`, error);
          // Update job status to failed so user can see the error
          await serviceSupabase
            .from('sync_jobs')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString(),
              message: 'Sync failed - check logs',
              error: String(error),
              progress: 100,
            })
            .eq('id', job.id);
        });
      }
    }
    
    return NextResponse.json({
      success: true,
      message: `Started ${jobs.filter(j => j.status === 'started').length} sync job(s)`,
      jobs,
    });
    
  } catch (error) {
    console.error('Start sync error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

// Trigger the actual sync in the background
async function triggerBackgroundSync(jobId: string, workspaceId: string) {
  console.log(`[Sync Job ${jobId}] Starting background sync for workspace ${workspaceId}`);
  
  try {
    const serviceSupabase = createServiceClient();
    
    // Update job to running
    await serviceSupabase
      .from('sync_jobs')
      .update({ 
        status: 'running', 
        started_at: new Date().toISOString(),
        message: 'Fetching products from ApparelMagic...',
        progress: 10
      })
      .eq('id', jobId);
    
    console.log(`[Sync Job ${jobId}] Getting ApparelMagic credentials...`);
    
    // Get credentials
    const { data: connection, error: connError } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token, target_season')
      .eq('workspace_id', workspaceId)
      .single();
    
    if (connError) {
      throw new Error(`Failed to get connection: ${connError.message}`);
    }
    
    if (!connection) {
      throw new Error('No ApparelMagic connection found for this workspace');
    }
    
    console.log(`[Sync Job ${jobId}] Got credentials for subdomain: ${connection.subdomain}`);
    
    const credentials = { subdomain: connection.subdomain, token: connection.token };
    const targetSeason = connection.target_season || 'SS26';
    
    console.log(`[Sync Job ${jobId}] Initializing ApparelMagic client...`);
    const { ApparelMagicClient } = await import('@/app/lib/apparelmagic/api');
    const client = new ApparelMagicClient(credentials);
    
    // Step 1: Fetch all products
    console.log(`[Sync Job ${jobId}] Fetching all products...`);
    await serviceSupabase
      .from('sync_jobs')
      .update({ message: 'Fetching products...', progress: 20 })
      .eq('id', jobId);
    
    const allProducts = await client.getAllProducts();
    console.log(`[Sync Job ${jobId}] Fetched ${allProducts.length} products`);
    
    // Step 2: Find target season styles
    await serviceSupabase
      .from('sync_jobs')
      .update({ message: `Finding ${targetSeason} styles...`, progress: 40 })
      .eq('id', jobId);
    
    const productSeasons = new Map<string, string>();
    for (const product of allProducts) {
      const styleNumber = String((product as any).style_number || '');
      const season = (product as any).season || '';
      if (styleNumber && season) {
        productSeasons.set(styleNumber, String(season));
      }
    }
    
    const targetStyles = new Set(
      Array.from(productSeasons.entries())
        .filter(([_, season]) => season.toLowerCase() === targetSeason.toLowerCase())
        .map(([style, _]) => style)
    );
    
    console.log(`[Sync Job ${jobId}] Found ${targetStyles.size} ${targetSeason} styles`);
    
    if (targetStyles.size === 0) {
      const availableSeasons = Array.from(new Set(productSeasons.values()));
      
      await serviceSupabase
        .from('sync_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          message: `No ${targetSeason} products found`,
          error: JSON.stringify({ availableSeasons: availableSeasons.slice(0, 20) }),
          progress: 100,
        })
        .eq('id', jobId);
      
      return;
    }
    
    // Step 3: Fetch inventory
    console.log(`[Sync Job ${jobId}] Fetching inventory...`);
    await serviceSupabase
      .from('sync_jobs')
      .update({ message: 'Fetching inventory...', progress: 60 })
      .eq('id', jobId);
    
    const inventory = await client.getAllInventory();
    const targetInventory = inventory.filter(item =>
      targetStyles.has(item.style_number)
    );
    
    console.log(`[Sync Job ${jobId}] Found ${targetInventory.length} inventory items for target season`);
    
    // Step 4: Fetch sales
    console.log(`[Sync Job ${jobId}] Fetching sales...`);
    await serviceSupabase
      .from('sync_jobs')
      .update({ message: 'Fetching sales history...', progress: 70 })
      .eq('id', jobId);
    
    const twoYearsAgo = new Date();
    twoYearsAgo.setDate(twoYearsAgo.getDate() - 730);
    const allInvoices = await client.getAllInvoices(twoYearsAgo.toISOString().split('T')[0]);
    
    console.log(`[Sync Job ${jobId}] Fetched ${allInvoices.length} invoices`);
    
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
    
    // Step 5: Sync to database
    console.log(`[Sync Job ${jobId}] Syncing to database...`);
    await serviceSupabase
      .from('sync_jobs')
      .update({ message: 'Syncing to database...', progress: 80 })
      .eq('id', jobId);
    
    // Sync products
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
    
    // Sync inventory
    const transformedInventory = targetInventory.map((item) => ({
      workspace_id: workspaceId,
      external_id: item.sku_id,
      sku: item.sku_concat || item.sku_id,
      style: item.style_number,
      color: item.attr_2 || 'Unknown',
      size: item.size || 'Unknown',
      qty_on_hand: parseFloat(String(item.qty_inventory || 0)) || 0 || 0,
      qty_available: parseFloat(String(item.qty_avail_sell || 0)) || 0 || 0,
      qty_allocated: parseFloat(String(item.qty_alloc || 0)) || 0 || 0,
      qty_reserved: parseFloat(String(item.qty_picked || 0)) || 0 || 0,
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
    
    // Sync sales
    const activeSkuSet = new Set(targetInventory.map(i => i.sku_id));
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
    
    // Update connection timestamp
    await serviceSupabase
      .from('apparelmagic_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId);
    
    // Mark job as completed
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
          season: targetSeason,
          totalProductsFetched: allProducts.length,
        },
      })
      .eq('id', jobId);
    
    console.log(`[Sync Job ${jobId}] ✅ Completed successfully`);
    
  } catch (error) {
    console.error(`[Sync Job ${jobId}] ❌ Failed:`, error);
    
    const serviceSupabase = createServiceClient();
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
  }
}

// Get sync status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get('workspaceId');
    const jobId = searchParams.get('jobId');
    
    const serviceSupabase = createServiceClient();
    
    let query = serviceSupabase
      .from('sync_jobs')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (jobId) {
      query = query.eq('id', jobId);
    } else if (workspaceId) {
      query = query.eq('workspace_id', workspaceId);
    }
    
    const { data: jobs } = await query.limit(10);
    
    return NextResponse.json({
      success: true,
      jobs: jobs || [],
    });
    
  } catch (error) {
    console.error('Get sync status error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
