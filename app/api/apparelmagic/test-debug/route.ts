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
    
    // Test 2: Request with paginationlast_id=123
    const url2 = `${baseUrl}/inventory?time=${time}&token=${connection.token}&paginationlast_id=123`;
    console.log('Request 2 (last_id=123):', url2.replace(connection.token, '***TOKEN***'));
    
    const resp2 = await fetch(url2, {
      headers: { 'User-Agent': 'OTB-Live/1.0' },
    });
    const data2 = await resp2.json();
    
    // Test 3: Request with paginationlast_id=2
    const url3 = `${baseUrl}/inventory?time=${time}&token=${connection.token}&paginationlast_id=2`;
    console.log('Request 3 (last_id=2):', url3.replace(connection.token, '***TOKEN***'));
    
    const resp3 = await fetch(url3, {
      headers: { 'User-Agent': 'OTB-Live/1.0' },
    });
    const data3 = await resp3.json();
    
    // Test 4: Request with paginationlast_id=124 (next after 123)
    const url4 = `${baseUrl}/inventory?time=${time}&token=${connection.token}&paginationlast_id=124`;
    console.log('Request 4 (last_id=124):', url4.replace(connection.token, '***TOKEN***'));
    
    const resp4 = await fetch(url4, {
      headers: { 'User-Agent': 'OTB-Live/1.0' },
    });
    const data4 = await resp4.json();
    
    return NextResponse.json({
      request1: {
        itemCount: data1.response?.length || 0,
        lastId: data1.meta?.pagination?.last_id || null,
      },
      request2_lastId123: {
        itemCount: data2.response?.length || 0,
        lastId: data2.meta?.pagination?.last_id || null,
      },
      request3_lastId2: {
        itemCount: data3.response?.length || 0,
        lastId: data3.meta?.pagination?.last_id || null,
      },
      request4_lastId124: {
        itemCount: data4.response?.length || 0,
        lastId: data4.meta?.pagination?.last_id || null,
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
