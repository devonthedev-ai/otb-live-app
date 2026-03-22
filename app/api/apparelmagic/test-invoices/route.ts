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
    
    // Test 1: Invoices without pagination
    const url1 = `${baseUrl}/invoices?time=${time}&token=${connection.token}`;
    const resp1 = await fetch(url1, { headers: { 'User-Agent': 'OTB-Live/1.0' } });
    const data1 = await resp1.json();
    
    // Test 2: Invoices with page_size=1000
    const url2 = `${baseUrl}/invoices?time=${time}&token=${connection.token}&paginationpage_size=1000`;
    const resp2 = await fetch(url2, { headers: { 'User-Agent': 'OTB-Live/1.0' } });
    const data2 = await resp2.json();
    
    // Test 3: Invoices page 2 if available
    let data3 = null;
    const lastId1 = data1.meta?.pagination?.last_id;
    if (lastId1) {
      const url3 = `${baseUrl}/invoices?time=${time}&token=${connection.token}&paginationlast_id=${lastId1}`;
      const resp3 = await fetch(url3, { headers: { 'User-Agent': 'OTB-Live/1.0' } });
      data3 = await resp3.json();
    }
    
    return NextResponse.json({
      invoicesPage1: {
        itemCount: data1.response?.length || 0,
        lastId: data1.meta?.pagination?.last_id || null,
      },
      invoicesWithPageSize: {
        itemCount: data2.response?.length || 0,
        lastId: data2.meta?.pagination?.last_id || null,
      },
      invoicesPage2: data3 ? {
        itemCount: data3.response?.length || 0,
        lastId: data3.meta?.pagination?.last_id || null,
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
