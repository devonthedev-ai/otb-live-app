import { createServiceClient } from '@/app/lib/supabase/service';
import { NextRequest, NextResponse } from 'next/server';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';

// Vercel Cron Job - runs daily at 6 AM ET
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
    // Get connection (using .single() like test-cron)
    const { data: connection, error: connError } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token')
      .limit(1)
      .single();
    
    if (connError || !connection) {
      console.log('[Vercel Cron] No ApparelMagic connection found');
      return NextResponse.json({
        success: true,
        message: 'No workspaces to sync',
        workspaces: 0,
      });
    }
    
    console.log('[Vercel Cron] Syncing subdomain:', connection.subdomain);
    
    // Create client
    const client = new ApparelMagicClient({
      subdomain: connection.subdomain,
      token: connection.token,
    });
    
    // Fetch inventory (inline like test-cron)
    console.log('[Vercel Cron] Fetching inventory...');
    const { inventory, lastId } = await client.getInventory();
    console.log(`[Vercel Cron] Got ${inventory.length} items, lastId: ${lastId}`);
    
    if (inventory.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No products found',
        results: [{ subdomain: connection.subdomain, success: false, error: 'No products found' }],
      });
    }
    
    // Save to database
    console.log('[Vercel Cron] Saving to database...');
    
    const transformedProducts = inventory.map((item: any) => ({
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
