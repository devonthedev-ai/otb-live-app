import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/app/lib/supabase/service';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';

export async function GET(request: NextRequest) {
  try {
    const serviceSupabase = createServiceClient();
    
    // Get the first workspace with AM connection (like test-style)
    const { data: connection } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('workspace_id, subdomain, token, target_season')
      .limit(1)
      .single();
    
    if (!connection) {
      return NextResponse.json({ error: 'No connection found' }, { status: 404 });
    }
    
    console.log('Testing connection:', { workspace_id: connection.workspace_id, subdomain: connection.subdomain });
    
    const client = new ApparelMagicClient({
      subdomain: connection.subdomain,
      token: connection.token,
    });
    
    console.log('Calling getAllInventory...');
    const inventory = await client.getAllInventory();
    console.log(`Got ${inventory.length} items`);
    
    return NextResponse.json({
      workspaceId: connection.workspace_id,
      subdomain: connection.subdomain,
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
