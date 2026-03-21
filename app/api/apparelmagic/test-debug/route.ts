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
    
    // Test 2: Request with paginationpage_size=1000
    const url2 = `${baseUrl}/inventory?time=${time}&token=${connection.token}&paginationpage_size=1000`;
    console.log('Request 2 (page_size=1000):', url2.replace(connection.token, '***TOKEN***'));
    
    const resp2 = await fetch(url2, {
      headers: { 'User-Agent': 'OTB-Live/1.0' },
    });
    const data2 = await resp2.json();
    
    // Test 3: Request with both page_size=1000 AND last_id=123
    const url3 = `${baseUrl}/inventory?time=${time}&token=${connection.token}&paginationpage_size=1000&paginationlast_id=123`;
    console.log('Request 3 (page_size=1000 + last_id=123):', url3.replace(connection.token, '***TOKEN***'));
    
    const resp3 = await fetch(url3, {
      headers: { 'User-Agent': 'OTB-Live/1.0' },
    });
    const data3 = await resp3.json();
    
    return NextResponse.json({
      request1_default: {
        itemCount: data1.response?.length || 0,
        lastId: data1.meta?.pagination?.last_id || null,
      },
      request2_pageSize1000: {
        itemCount: data2.response?.length || 0,
        lastId: data2.meta?.pagination?.last_id || null,
      },
      request3_pageSize1000_and_lastId: {
        itemCount: data3.response?.length || 0,
        lastId: data3.meta?.pagination?.last_id || null,
      },
    });
    
  } catch (error) {
    console.error('Test error:', error);
    return NextResponse.json(
      { error: 'Test failed', details: String(error) },
      { status: 500 }
    );
  }
}
