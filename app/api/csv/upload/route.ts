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
    
    // Parse CSV
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
    
    console.log(`[CSV Upload] Parsed ${records.length} records`);
    console.log('[CSV Upload] Columns found:', Object.keys(records[0] || {}));
    
    if (records.length === 0) {
      return NextResponse.json({ error: 'No records found in CSV' }, { status: 400 });
    }
    
    // Map ApparelMagic CSV columns to database schema
    const products = records.map((record: any) => {
      // Try to find SKU in various column names
      const sku = record['SKU ID'] || record['SKU'] || record['SKU (style + color + size encoded)'] || '';
      
      // Try to find Style
      const style = record['Style'] || '';
      
      // Try to find Color
      const color = record['Color'] || 'Unknown';
      
      // Try to find Size
      const size = record['Size'] || 'Unknown';
      
      // Try to find Description
      const description = record['Description'] || '';
      
      // Try to find Category
      const category = record['Category'] || '';
      
      // Try to find Season
      const season = record['Season'] || '';
      
      // Try to find Attr 2 Name (fit/dimension)
      const attr2 = record['Attr 2 Name'] || '';
      
      // Try to find Cost (check multiple possible column names)
      const cost = parseFloat(
        record['Cost'] || 
        record['Cost Price'] || 
        record['Pricing + cost'] || 
        '0'
      ) || 0;
      
      // Try to find Price (check multiple possible column names)
      const price = parseFloat(
        record['Price'] || 
        record['Retail Price'] || 
        record['Price Retail Price'] || 
        '0'
      ) || 0;
      
      // Try to find Quantity (might not be in the export - default to 0)
      const qty = parseInt(
        record['Qty'] || 
        record['QTY'] || 
        record['On Hand'] || 
        record['Quantity'] || 
        '0'
      ) || 0;
      
      // Build product name from components
      const nameParts = [style, color, size, attr2].filter(Boolean);
      const name = nameParts.join(' ') || description || sku;
      
      return {
        workspace_id: workspaceId,
        external_id: sku,
        sku: sku,
        name: name,
        style: style,
        color: color,
        size: size,
        category: category,
        cost: cost,
        price: price,
        source: 'csv_upload',
        is_archived: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }).filter((p: any) => p.sku); // Filter out records without SKU
    
    console.log(`[CSV Upload] Mapped ${products.length} valid products`);
    
    if (products.length === 0) {
      return NextResponse.json({ 
        error: 'No valid products found. Check CSV format.',
        columns: Object.keys(records[0] || {})
      }, { status: 400 });
    }
    
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
