import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/app/lib/supabase/service';
import { parse } from 'csv-parse/sync';

export async function POST(request: NextRequest) {
  try {
    const serviceSupabase = createServiceClient();
    
    // Get workspace from auth or use first connection
    const { data: connection } = await serviceSupabase
      .from('apparelmagic_connections')
      .select('subdomain')
      .limit(1)
      .single();
    
    if (!connection) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 });
    }
    
    const workspaceId = connection.subdomain;
    
    // Get CSV file from request
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }
    
    // Read CSV content
    const csvText = await file.text();
    
    // Parse CSV - handle different ApparelMagic export formats
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    
    console.log(`[CSV Upload] Parsed ${records.length} records`);
    
    if (records.length === 0) {
      return NextResponse.json({ error: 'No records found in CSV' }, { status: 400 });
    }
    
    // Map CSV columns to database schema
    // ApparelMagic exports typically have: SKU, Style, Color, Size, Qty, etc.
    const products = records.map((record: any) => ({
      workspace_id: workspaceId,
      sku: record.SKU || record.sku || record['SKU #'] || '',
      name: `${record.Style || record.style || ''} ${record.Color || record.color || ''} ${record.Size || record.size || ''}`.trim(),
      style: record.Style || record.style || '',
      color: record.Color || record.color || 'Unknown',
      size: record.Size || record.size || 'Unknown',
      qty_on_hand: parseInt(record.Qty || record.QTY || record['On Hand'] || '0') || 0,
      cost: parseFloat(record.Cost || record.cost || '0') || 0,
      price: parseFloat(record.Price || record.price || '0') || 0,
      source: 'csv_upload',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })).filter((p: any) => p.sku); // Filter out records without SKU
    
    console.log(`[CSV Upload] Mapped ${products.length} valid products`);
    
    // Upsert to database
    const { data, error } = await serviceSupabase
      .from('products')
      .upsert(products, { onConflict: 'workspace_id,sku' });
    
    if (error) {
      console.error('[CSV Upload] Database error:', error);
      return NextResponse.json(
        { error: 'Failed to save products', details: error.message },
        { status: 500 }
      );
    }
    
    return NextResponse.json({
      success: true,
      message: `Uploaded ${products.length} products`,
      totalRecords: records.length,
      validProducts: products.length,
    });
    
  } catch (error) {
    console.error('[CSV Upload] Error:', error);
    return NextResponse.json(
      { error: 'Upload failed', details: String(error) },
      { status: 500 }
    );
  }
}
