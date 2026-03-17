import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/app/lib/supabase/service';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';

export async function GET(request: NextRequest) {
  try {
    const serviceSupabase = createServiceClient();
    
    // Get the first workspace with AM connection (like test-style)
    const { data: connection } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token')
      .limit(1)
      .single();
    
    if (!connection) {
      return NextResponse.json({ error: 'No connection found' }, { status: 404 });
    }
    
    console.log('Testing connection:', { subdomain: connection.subdomain });
    
    const client = new ApparelMagicClient({
      subdomain: connection.subdomain,
      token: connection.token,
    });
    
    console.log('Calling getInventory...');
    const { inventory, lastId } = await client.getInventory();
    console.log(`Got ${inventory.length} items, lastId: ${lastId}`);
    
    return NextResponse.json({
      subdomain: connection.subdomain,
      inventoryCount: inventory.length,
      lastId: lastId,
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
