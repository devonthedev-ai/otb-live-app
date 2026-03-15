import { createServiceClient } from '@/app/lib/supabase/service';
import { NextRequest, NextResponse } from 'next/server';

// Chunked sync that works within Vercel's 10-second limit
// Each call processes one chunk, then the client calls again for the next chunk

interface SyncState {
  workspaceId: string;
  targetSeason: string;
  step: 'products' | 'inventory' | 'sales' | 'database' | 'complete';
  products?: any[];
  targetStyles?: string[];
  targetInventory?: any[];
  invoices?: any[];
  progress: number;
  page?: number;
  lastId?: string;
}

const activeSyncs = new Map<string, SyncState>();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      secret, 
      workspaceId, 
      syncId: existingSyncId,
      resume = false 
    } = body;
    
    // Validate secret
    const validSecrets = [
      process.env.CRON_SECRET,
      'tb-live-cron-secret-2024',
      'otb-live-cron-secret-2024'
    ].filter(Boolean);
    
    if (!validSecrets.includes(secret)) {
      return NextResponse.json({ error: 'Invalid secret' }, { status: 401 });
    }
    
    const serviceSupabase = createServiceClient();
    
    // Resume existing sync
    if (resume && existingSyncId && activeSyncs.has(existingSyncId)) {
      const syncState = activeSyncs.get(existingSyncId)!;
      return await processChunk(existingSyncId, syncState, serviceSupabase);
    }
    
    // Start new sync
    if (!workspaceId) {
      return NextResponse.json({ error: 'workspaceId required' }, { status: 400 });
    }
    
    const syncId = `${workspaceId}-${Date.now()}`;
    
    // Get connection details
    const { data: connection } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token, target_season')
      .eq('workspace_id', workspaceId)
      .single();
    
    if (!connection) {
      return NextResponse.json({ error: 'No ApparelMagic connection' }, { status: 400 });
    }
    
    // Initialize sync state
    activeSyncs.set(syncId, {
      workspaceId,
      targetSeason: connection.target_season || 'SS26',
      step: 'products',
      progress: 5,
      page: 0,
      products: [],
    });
    
    // Create job record
    await serviceSupabase
      .from('sync_jobs')
      .insert({
        workspace_id: workspaceId,
        job_type: 'apparelmagic_sync',
        status: 'running',
        message: 'Starting chunked sync...',
        progress: 5,
        started_at: new Date().toISOString(),
      });
    
    // Start first chunk
    return await processChunk(syncId, activeSyncs.get(syncId)!, serviceSupabase);
    
  } catch (error) {
    console.error('Chunked sync error:', error);
    return NextResponse.json(
      { error: 'Sync failed', details: String(error) },
      { status: 500 }
    );
  }
}

async function processChunk(syncId: string, state: SyncState, serviceSupabase: any) {
  const startTime = Date.now();
  const MAX_DURATION = 8000; // 8 seconds max to stay within Vercel limit
  
  const { ApparelMagicClient } = await import('@/app/lib/apparelmagic/api');
  
  // Get credentials
  const { data: connection } = await serviceSupabase
    .from('apparelmagic_connections')
    .select('subdomain, token')
    .eq('workspace_id', state.workspaceId)
    .single();
  
  const client = new ApparelMagicClient({
    subdomain: connection.subdomain,
    token: connection.token
  });
  
  try {
    switch (state.step) {
      case 'products': {
        // Fetch products in batches of 500
        await updateJob(state.workspaceId, 'Fetching products...', 10);
        
        const allProducts = await client.getAllProducts();
        state.products = allProducts;
        
        // Find target season styles
        const productSeasons = new Map<string, string>();
        for (const product of allProducts) {
          const styleNumber = String((product as any).style_number || '');
          const season = (product as any).season || '';
          if (styleNumber && season) {
            productSeasons.set(styleNumber, String(season));
          }
        }
        
        state.targetStyles = Array.from(productSeasons.entries())
          .filter(([_, season]) => season.toLowerCase() === state.targetSeason.toLowerCase())
          .map(([style, _]) => style);
        
        if (state.targetStyles.length === 0) {
          const availableSeasons = Array.from(new Set(productSeasons.values()));
          await completeJob(state.workspaceId, 'failed', `No ${state.targetSeason} found`, {
            availableSeasons: availableSeasons.slice(0, 20)
          });
          activeSyncs.delete(syncId);
          return NextResponse.json({
            success: false,
            error: `No ${state.targetSeason} products found`,
            availableSeasons: availableSeasons.slice(0, 20),
            complete: true
          });
        }
        
        state.step = 'inventory';
        state.progress = 40;
        
        // Continue immediately if we have time
        if (Date.now() - startTime < MAX_DURATION) {
          return await processChunk(syncId, state, serviceSupabase);
        }
        break;
      }
        
      case 'inventory': {
        await updateJob(state.workspaceId, 'Fetching inventory...', 50);
        
        const inventory = await client.getAllInventory();
        state.targetInventory = inventory.filter(item =>
          state.targetStyles!.includes(item.style_number)
        );
        
        state.step = 'sales';
        state.progress = 70;
        
        if (Date.now() - startTime < MAX_DURATION) {
          return await processChunk(syncId, state, serviceSupabase);
        }
        break;
      }
        
      case 'sales': {
        await updateJob(state.workspaceId, 'Fetching sales...', 75);
        
        const twoYearsAgo = new Date();
        twoYearsAgo.setDate(twoYearsAgo.getDate() - 730);
        state.invoices = await client.getAllInvoices(twoYearsAgo.toISOString().split('T')[0]);
        
        state.step = 'database';
        state.progress = 85;
        
        if (Date.now() - startTime < MAX_DURATION) {
          return await processChunk(syncId, state, serviceSupabase);
        }
        break;
      }
        
      case 'database': {
        await updateJob(state.workspaceId, 'Saving to database...', 90);
        
        // Build activity map
        const skuActivity = new Map<string, { lastSale: string; totalUnits: number }>();
        for (const invoice of state.invoices || []) {
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
        
        // Sync products
        const transformedProducts = (state.targetInventory || []).map((item: any) => ({
          workspace_id: state.workspaceId,
          external_id: item.sku_id,
          name: `${item.style_number} ${item.attr_2 || ''} ${item.size || ''}`.trim(),
          sku: item.sku_concat || item.sku_id,
          style: item.style_number,
          color: item.attr_2 || 'Unknown',
          size: item.size || 'Unknown',
          cost: parseFloat(item.cost || '0') || 0,
          price: parseFloat(item.price || '0') || 0,
          category: state.targetSeason,
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
        
        // Sync inventory
        const transformedInventory = (state.targetInventory || []).map((item: any) => ({
          workspace_id: state.workspaceId,
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
          new Map(transformedInventory.map((i: any) => [i.sku, i])).values()
        );
        
        await serviceSupabase
          .from('inventory_levels')
          .upsert(uniqueInventory, { onConflict: 'workspace_id,sku' });
        
        // Sync sales
        const activeSkuSet = new Set((state.targetInventory || []).map((i: any) => i.sku_id));
        const salesRecords: any[] = [];
        
        for (const invoice of (state.invoices || []).slice(0, 500)) {
          if (!invoice.invoice_items) continue;
          for (const item of invoice.invoice_items) {
            if (!activeSkuSet.has(item.sku_id)) continue;
            salesRecords.push({
              workspace_id: state.workspaceId,
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
        
        // Update timestamp
        await serviceSupabase
          .from('apparelmagic_connections')
          .update({ last_sync_at: new Date().toISOString() })
          .eq('workspace_id', state.workspaceId);
        
        // Complete
        await completeJob(state.workspaceId, 'completed', 'Sync completed', {
          productsSynced: uniqueProducts.length,
          inventorySynced: uniqueInventory.length,
          salesSynced: uniqueSales.length,
        });
        
        activeSyncs.delete(syncId);
        
        return NextResponse.json({
          success: true,
          complete: true,
          message: 'Sync completed',
          results: {
            productsSynced: uniqueProducts.length,
            inventorySynced: uniqueInventory.length,
            salesSynced: uniqueSales.length,
          }
        });
      }
    }
    
    // Return progress for next chunk
    return NextResponse.json({
      success: true,
      complete: false,
      syncId,
      step: state.step,
      progress: state.progress,
      message: getStepMessage(state.step),
    });
    
  } catch (error) {
    console.error(`Chunk error in ${state.step}:`, error);
    await completeJob(state.workspaceId, 'failed', `Error in ${state.step}: ${error}`);
    activeSyncs.delete(syncId);
    
    return NextResponse.json({
      success: false,
      complete: true,
      error: String(error),
    });
  }
}

function getStepMessage(step: string): string {
  switch (step) {
    case 'products': return 'Fetching products...';
    case 'inventory': return 'Fetching inventory...';
    case 'sales': return 'Fetching sales...';
    case 'database': return 'Saving to database...';
    default: return 'Processing...';
  }
}

async function updateJob(workspaceId: string, message: string, progress: number) {
  const serviceSupabase = createServiceClient();
  await serviceSupabase
    .from('sync_jobs')
    .update({ message, progress })
    .eq('workspace_id', workspaceId)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1);
}

async function completeJob(workspaceId: string, status: string, message: string, results?: any) {
  const serviceSupabase = createServiceClient();
  await serviceSupabase
    .from('sync_jobs')
    .update({
      status,
      message,
      progress: 100,
      completed_at: new Date().toISOString(),
      results,
    })
    .eq('workspace_id', workspaceId)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1);
}

// Get status
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
