import { createServiceClient } from '@/app/lib/supabase/service';
import { NextRequest, NextResponse } from 'next/server';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';

// Cron webhook endpoint - accepts a secret key for authentication
export async function POST(request: NextRequest) {
  try {
    // Check secret key
    const body = await request.json();
    const { secret, workspaceId } = body;
    
    // Support both old and new secret for backward compatibility
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
    
    // If no workspaceId provided, find all workspaces with AM connections
    const serviceSupabase = createServiceClient();
    
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
        workspacesSynced: 0,
      });
    }
    
    // Sync each workspace
    const results = [];
    
    for (const wsId of workspaces) {
      console.log(`🔄 Syncing workspace: ${wsId}`);
      
      // Get credentials and target_season
      const { data: connection } = await serviceSupabase
        .from('apparelmagic_connections')
        .select('subdomain, token, target_season')
        .eq('workspace_id', wsId)
        .single();
      
      if (!connection) {
        results.push({ workspaceId: wsId, error: 'No credentials found' });
        continue;
      }
      
      const credentials = { subdomain: connection.subdomain, token: connection.token };
      const targetSeason = connection.target_season || 'SS26';
      
      // Run sync (simplified version without chunking for cron - uses full pagination)
      const client = new ApparelMagicClient(credentials);
      
      try {
        // Fetch all products with pagination (no timeout in cron!)
        const allProducts = await client.getAllProducts();
        
        // Build season map
        const productSeasons = new Map<string, string>();
        for (const product of allProducts) {
          const styleNumber = String((product as any).style_number || '');
          const season = (product as any).season || '';
          if (styleNumber && season) {
            productSeasons.set(styleNumber, String(season));
          }
        }
        
        // Find target styles
        const targetStyles = new Set(
          Array.from(productSeasons.entries())
            .filter(([_, season]) => season.toLowerCase() === targetSeason.toLowerCase())
            .map(([style, _]) => style)
        );
        
        if (targetStyles.size === 0) {
          // Return available seasons so we can pick one
          const availableSeasons = Array.from(new Set(productSeasons.values()));
          results.push({
            workspaceId: wsId,
            error: `No ${targetSeason} products found`,
            availableSeasons: availableSeasons.slice(0, 20),
            totalProducts: allProducts.length,
          });
          continue;
        }
        
        // Fetch and filter inventory
        const inventory = await client.getAllInventory();
        const targetInventory = inventory.filter(item =>
          targetStyles.has(item.style_number)
        );
        
        // Fetch sales for activity check
        const twoYearsAgo = new Date();
        twoYearsAgo.setDate(twoYearsAgo.getDate() - 730);
        const allInvoices = await client.getAllInvoices(twoYearsAgo.toISOString().split('T')[0]);
        
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
        
        // Sync products to database
        const transformedProducts = targetInventory.map((item) => ({
          workspace_id: wsId,
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
          workspace_id: wsId,
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
        
        // Sync sales
        const activeSkuSet = new Set(targetInventory.map(i => i.sku_id));
        const salesRecords: any[] = [];
        
        for (const invoice of allInvoices.slice(0, 500)) {
          if (!invoice.invoice_items) continue;
          for (const item of invoice.invoice_items) {
            if (!activeSkuSet.has(item.sku_id)) continue;
            salesRecords.push({
              workspace_id: wsId,
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
        
        // Update last_sync timestamp
        await serviceSupabase
          .from('apparelmagic_connections')
          .update({ last_sync_at: new Date().toISOString() })
          .eq('workspace_id', wsId);
        
        results.push({
          workspaceId: wsId,
          success: true,
          productsSynced: uniqueProducts.length,
          inventorySynced: uniqueInventory.length,
          salesSynced: uniqueSales.length,
          season: targetSeason,
          totalProductsFetched: allProducts.length,
        });
        
      } catch (syncError) {
        results.push({
          workspaceId: wsId,
          error: String(syncError),
        });
      }
    }
    
    return NextResponse.json({
      success: true,
      workspacesSynced: results.length,
      results,
    });
    
  } catch (error) {
    console.error('Cron sync error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    );
  }
}

// Also support GET for simple health checks
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: 'ApparelMagic cron webhook is ready',
    timestamp: new Date().toISOString(),
  });
}
