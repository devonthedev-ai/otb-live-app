import { NextRequest, NextResponse } from 'next/server';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';
import { createServiceClient } from '@/app/lib/supabase/service';

export async function GET(request: NextRequest) {
  try {
    const serviceSupabase = createServiceClient();
    
    // Get the first workspace with AM connection
    const { data: connection } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token')
      .limit(1)
      .single();
    
    if (!connection) {
      return NextResponse.json({ error: 'No ApparelMagic connection found' }, { status: 404 });
    }
    
    const client = new ApparelMagicClient({
      subdomain: connection.subdomain,
      token: connection.token,
    });
    
    // Test first page
    console.log('Testing page 1...');
    const page1 = await client.getProducts({ pageSize: 100 });
    
    // Test second page if we have last_id
    let page2: any = null;
    if (page1.lastId) {
      console.log(`Testing page 2 with last_id: ${page1.lastId}...`);
      page2 = await client.getProducts({ pageSize: 100, lastId: page1.lastId });
    }
    
    return NextResponse.json({
      page1: {
        count: page1.products.length,
        lastId: page1.lastId,
        firstProduct: page1.products[0]?.style_number || 'none',
        lastProduct: page1.products[page1.products.length - 1]?.style_number || 'none',
      },
      page2: page2 ? {
        count: page2.products.length,
        lastId: page2.lastId,
        firstProduct: page2.products[0]?.style_number || 'none',
        lastProduct: page2.products[page2.products.length - 1]?.style_number || 'none',
      } : null,
      totalIfBothPages: page1.products.length + (page2?.products?.length || 0),
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}
