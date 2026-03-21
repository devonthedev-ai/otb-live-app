import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/app/lib/supabase/service';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get('workspaceId');
  
  // If workspaceId provided, return status
  if (workspaceId) {
    try {
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
  
  // Otherwise run the cron job
  console.log('[Vercel Cron] Starting daily ApparelMagic sync...');
  
  const serviceSupabase = createServiceClient();
  
  try {
    // Get connection
    const { data: connection } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token')
      .limit(1)
      .single();
    
    if (!connection) {
      console.log('[Vercel Cron] No ApparelMagic connection found');
      return NextResponse.json({
        success: true,
        message: 'No workspaces to sync',
        workspaces: 0,
      });
    }
    
    console.log('[Vercel Cron] Syncing subdomain:', connection.subdomain);
    
    const client = new ApparelMagicClient({
      subdomain: connection.subdomain,
      token: connection.token,
    });
    
    // Fetch ALL inventory with pagination
    console.log('[Vercel Cron] Fetching all inventory...');
    const allInventory: any[] = [];
    let lastId: string | undefined;
    let pageNum = 0;
    const maxPages = 20; // Safety limit (2000 items max)
    
    while (pageNum < maxPages) {
      pageNum++;
      const { inventory, lastId: newLastId } = lastId
        ? await client.getInventory({ lastId })
        : await client.getInventory();
      
      console.log(`[Vercel Cron] Page ${pageNum}: ${inventory.length} items, lastId: ${newLastId}`);
      
      if (inventory.length === 0) break;
      
      allInventory.push(...inventory);
      
      if (!newLastId || newLastId === lastId) break;
      lastId = newLastId;
      
      // Rate limiting - wait 250ms between requests
      await new Promise(r => setTimeout(r, 250));
    }
    
    console.log(`[Vercel Cron] Total: ${allInventory.length} items from ${pageNum} pages`);
    
    if (allInventory.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No products found',
        results: [{ subdomain: connection.subdomain, success: false, error: 'No products found' }],
      });
    }
    
    // Save to database
    console.log('[Vercel Cron] Saving to database...');
    
    const transformedProducts = allInventory.map((item: any) => ({
      workspace_id: connection.subdomain,
      external_id: item.sku_id,
      name: `${item.style_number} ${item.attr_2 || ''} ${item.size || ''}`.trim(),
      sku: item.sku_concat || item.sku_id,
      style: item.style_number,
      color: item.attr_2 || 'Unknown',
      size: item.size || 'Unknown',
      cost: parseFloat(item.cost || '0') || 0,
      price: parseFloat(item.price || '0') || 0,
      category: 'ApparelMagic',
      source: 'apparelmagic',
      is_archived: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
    
    const uniqueProducts = Array.from(
      new Map(transformedProducts.map((p: any) => [p.sku, p])).values()
    );
    
    await serviceSupabase
      .from('products')
      .upsert(uniqueProducts, { onConflict: 'workspace_id,sku' });
    
    console.log(`[Vercel Cron] Saved ${uniqueProducts.length} products`);
    
    return NextResponse.json({
      success: true,
      message: 'Sync completed',
      results: [{
        subdomain: connection.subdomain,
        success: true,
        productsSynced: uniqueProducts.length,
        pagesFetched: pageNum,
      }],
    });
    
  } catch (error) {
    console.error('[Vercel Cron] Fatal error:', error);
    return NextResponse.json(
      { error: 'Cron job failed', details: String(error) },
      { status: 500 }
    );
  }
}
