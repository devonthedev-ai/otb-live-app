import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/app/lib/supabase/service';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';

export async function GET(request: NextRequest) {
  try {
    const serviceSupabase = createServiceClient();
    
    const { data: connection } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token')
      .limit(1)
      .single();
    
    if (!connection) {
      return NextResponse.json({ error: 'No connection' }, { status: 404 });
    }
    
    const client = new ApparelMagicClient({
      subdomain: connection.subdomain,
      token: connection.token,
    });
    
    // Fetch all inventory with pagination
    const allInventory: any[] = [];
    let lastId: string | undefined;
    let pageNum = 0;
    const maxPages = 20; // Safety limit
    
    while (pageNum < maxPages) {
      pageNum++;
      // First request without pagination params, subsequent with last_id
      const { inventory, lastId: newLastId } = lastId 
        ? await client.getInventory({ lastId })
        : await client.getInventory();
      
      console.log(`Page ${pageNum}: ${inventory.length} items, lastId: ${newLastId}`);
      
      if (inventory.length === 0) break;
      
      allInventory.push(...inventory);
      
      if (!newLastId || newLastId === lastId) break;
      lastId = newLastId;
    }
    
    return NextResponse.json({
      totalItems: allInventory.length,
      pagesFetched: pageNum,
      lastId: lastId || null,
      uniqueStyles: Array.from(new Set(allInventory.map((i: any) => i.style_number))).length,
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}
