// app/api/apparelmagic/sync-sales/route.ts
import { createClient } from '@/app/lib/supabase/server';
import { createServiceClient } from '@/app/lib/supabase/service';
import { NextRequest, NextResponse } from 'next/server';
import { ApparelMagicClient } from '@/app/lib/apparelmagic/api';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    
    // Get current user
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    const { workspaceId, daysBack = 90 } = body;
    
    if (!workspaceId) {
      return NextResponse.json(
        { error: 'Workspace ID required' },
        { status: 400 }
      );
    }
    
    // Check permissions
    const { data: membership } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();
    
    if (!membership || !['owner', 'admin', 'buyer'].includes(membership.role)) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    
    // Get credentials
    const serviceSupabase = createServiceClient();
    const { data: credentials } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain, token')
      .eq('workspace_id', workspaceId)
      .single();
    
    if (!credentials) {
      return NextResponse.json(
        { error: 'ApparelMagic not connected' },
        { status: 400 }
      );
    }
    
    const client = new ApparelMagicClient(credentials);
    
    // Fetch invoices (sales) for last N days
    console.log(`Fetching invoices from last ${daysBack} days...`);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    const startDateStr = startDate.toISOString().split('T')[0];
    
    const invoices = await client.getAllInvoices(startDateStr);
    console.log(`Fetched ${invoices.length} invoices`);
    
    // Transform invoice items to sales records
    const salesRecords: any[] = [];
    
    for (const invoice of invoices) {
      if (!invoice.invoice_items || !Array.isArray(invoice.invoice_items)) continue;
      
      for (const item of invoice.invoice_items) {
        salesRecords.push({
          workspace_id: workspaceId,
          external_id: item.id,
          invoice_id: invoice.invoice_id,
          sku: item.sku_id,
          style: item.style_number,
          color: item.attr_2 || 'Unknown',
          size: item.size || 'Unknown',
          qty: parseInt(item.qty) || 0,
          unit_price: parseFloat(item.unit_price) || 0,
          amount: parseFloat(item.amount) || 0,
          sale_date: invoice.date,
          customer_id: invoice.customer_id,
          channel: 'wholesale', // Default, could be mapped
          source: 'apparelmagic',
        });
      }
    }
    
    // Deduplicate
    const uniqueSales = Array.from(
      new Map(salesRecords.map(s => [s.external_id, s])).values()
    );
    
    // Upsert to database
    const { error: salesError } = await serviceSupabase
      .from('sales')
      .upsert(uniqueSales, {
        onConflict: 'workspace_id,external_id',
        ignoreDuplicates: false,
      });
    
    if (salesError) {
      console.error('Sales sync error:', salesError);
      return NextResponse.json(
        { error: `Failed to sync sales: ${salesError.message}` },
        { status: 500 }
      );
    }
    
    // Update sync time
    await serviceSupabase
      .from('apparelmagic_connections')
      .update({ last_sales_sync: new Date().toISOString() })
      .eq('workspace_id', workspaceId);
    
    return NextResponse.json({
      success: true,
      invoicesSynced: invoices.length,
      salesRecordsSynced: uniqueSales.length,
    });
    
  } catch (error) {
    console.error('Sales sync error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
