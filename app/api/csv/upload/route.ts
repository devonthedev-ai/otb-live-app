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
      
      // Try to find Quantity (inventory fields from ApparelMagic)
      const qtyInventory = parseInt(
        record['Qty Inventory (on hand)'] || 
        record['QTY'] || 
        record['On Hand'] || 
        record['Quantity'] || 
        '0'
      ) || 0;

      // Qty Open Sales (demand not fulfilled)
      const qtyOpenSales = parseInt(
        record['Qty Open Sales (demand not fulfilled)'] ||
        record['Qty Open Sales'] ||
        record['Open Sales'] ||
        '0'
      ) || 0;

      // Qty WIP (in production)
      const qtyWIP = parseInt(
        record['Qty WIP (in production)'] ||
        record['Qty WIP'] ||
        record['WIP'] ||
        '0'
      ) || 0;

      // Qty Avail Sell (available)
      const qtyAvailSell = parseInt(
        record['Qty Avail Sell (available)'] ||
        record['Qty Avail Sell'] ||
        record['Available'] ||
        record['Qty Available'] ||
        '0'
      ) || 0;

      // Use Qty Avail Sell as primary quantity, fallback to Qty Inventory
      const qty = qtyAvailSell || qtyInventory;
      
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
        qty_on_hand: qtyInventory,
        qty_available: qtyAvailSell,
        qty_open_po: qtyWIP,
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
    console.log('[CSV Upload] Attempting to save', products.length, 'products');
    console.log('[CSV Upload] First product sample:', JSON.stringify(products[0], null, 2));
    
    const { data, error } = await serviceSupabase
      .from('products')
      .upsert(products, { onConflict: 'workspace_id,sku' });
    
    if (error) {
      console.error('[CSV Upload] Database error:', error);
      console.error('[CSV Upload] Error code:', error.code);
      console.error('[CSV Upload] Error details:', error.details);
      console.error('[CSV Upload] Error hint:', error.hint);
      return NextResponse.json(
        { 
          error: 'Failed to save products', 
          details: error.message,
          code: error.code,
          hint: error.hint
        },
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
