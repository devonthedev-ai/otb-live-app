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
    
    // Test 1: Request without pagination params
    const url1 = `${baseUrl}/inventory?time=${time}&token=${connection.token}`;
    console.log('Request 1:', url1.replace(connection.token, '***TOKEN***'));
    
    const resp1 = await fetch(url1, {
      headers: { 'User-Agent': 'OTB-Live/1.0' },
    });
    const data1 = await resp1.json();
    
    // Test 2: Request with paginationlast_id if we got one
    let data2 = null;
    const lastId1 = data1.meta?.pagination?.last_id;
    
    if (lastId1) {
      const url2 = `${baseUrl}/inventory?time=${time}&token=${connection.token}&paginationlast_id=${lastId1}`;
      console.log('Request 2:', url2.replace(connection.token, '***TOKEN***'));
      
      const resp2 = await fetch(url2, {
        headers: { 'User-Agent': 'OTB-Live/1.0' },
      });
      data2 = await resp2.json();
    }
    
    return NextResponse.json({
      request1: {
        url: url1.replace(connection.token, '***TOKEN***'),
        itemCount: data1.response?.length || 0,
        lastId: data1.meta?.pagination?.last_id || null,
      },
      request2: data2 ? {
        url: `${baseUrl}/inventory?time=${time}&token=***TOKEN***&paginationlast_id=${lastId1}`,
        itemCount: data2.response?.length || 0,
        lastId: data2.meta?.pagination?.last_id || null,
      } : null,
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}
