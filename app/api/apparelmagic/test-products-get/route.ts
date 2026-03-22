import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/app/lib/supabase/service';

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
    
    const baseUrl = `https://${connection.subdomain}.app.apparelmagic.com/api/json`;
    const time = String(Math.floor(Date.now() / 1000));
    
    // Test GET /products with page_size=1000
    const url1 = `${baseUrl}/products?time=${time}&token=${connection.token}&paginationpage_size=1000`;
    
    const resp1 = await fetch(url1, {
      headers: { 'User-Agent': 'OTB-Live/1.0' },
    });
    const data1 = await resp1.json();
    
    // Test page 2
    let data2 = null;
    const lastId1 = data1.meta?.pagination?.last_id;
    
    if (lastId1 && data1.response?.length > 0) {
      const url2 = `${baseUrl}/products?time=${time}&token=${connection.token}&paginationpage_size=1000&paginationlast_id=${lastId1}`;
      
      const resp2 = await fetch(url2, {
        headers: { 'User-Agent': 'OTB-Live/1.0' },
      });
      
      data2 = await resp2.json();
    }
    
    return NextResponse.json({
      productsPage1: {
        itemCount: data1.response?.length || 0,
        lastId: data1.meta?.pagination?.last_id || null,
      },
      productsPage2: data2 ? {
        itemCount: data2.response?.length || 0,
        lastId: data2.meta?.pagination?.last_id || null,
      } : null,
      totalProducts: (data1.response?.length || 0) + (data2?.response?.length || 0),
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}
