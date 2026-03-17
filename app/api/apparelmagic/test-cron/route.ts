import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/app/lib/supabase/service';

export async function GET(request: NextRequest) {
  try {
    const serviceSupabase = createServiceClient();
    
    // Get all connections (like cron job does)
    const { data: connections } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('workspace_id, subdomain, token, target_season');
    
    if (!connections || connections.length === 0) {
      return NextResponse.json({ error: 'No connections found' }, { status: 404 });
    }
    
    const { ApparelMagicClient } = await import('@/app/lib/apparelmagic/api');
    
    // Test the first connection (like cron job)
    const conn = connections[0];
    console.log('Testing connection:', { workspace_id: conn.workspace_id, subdomain: conn.subdomain });
    
    const client = new ApparelMagicClient({
      subdomain: conn.subdomain,
      token: conn.token,
    });
    
    console.log('Calling getAllInventory...');
    const inventory = await client.getAllInventory();
    console.log(`Got ${inventory.length} items`);
    
    return NextResponse.json({
      workspaceId: conn.workspace_id,
      subdomain: conn.subdomain,
      inventoryCount: inventory.length,
      firstFewItems: inventory.slice(0, 3).map((i: any) => ({
        sku_id: i.sku_id,
        style: i.style_number,
      })),
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}
