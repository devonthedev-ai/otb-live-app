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
    const { workspaceId } = body;
    
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
    
    // Fetch all vendors
    console.log('Fetching vendors from ApparelMagic...');
    const vendors = await client.getAllVendors();
    console.log(`Fetched ${vendors.length} vendors`);
    
    // Create vendor lookup map
    const vendorMap = new Map<string, string>();
    for (const vendor of vendors) {
      vendorMap.set(vendor.id, vendor.name);
    }
    
    // Also fetch products to get vendor_id associations
    console.log('Fetching products for vendor associations...');
    const products = await client.getAllProducts();
    console.log(`Fetched ${products.length} products`);
    
    // Update product_settings with vendor info
    let updatedCount = 0;
    
    for (const product of products) {
      if (product.vendor_id && product.style_number) {
        const vendorName = vendorMap.get(product.vendor_id);
        if (vendorName) {
          // Find all SKUs for this style
          const { data: skus } = await serviceSupabase
            .from('inventory_levels')
            .select('sku, style')
            .eq('workspace_id', workspaceId)
            .eq('style', product.style_number);
          
          if (skus && skus.length > 0) {
            // Update or insert product_settings with vendor
            for (const sku of skus) {
              const { error: upsertError } = await serviceSupabase
                .from('product_settings')
                .upsert({
                  workspace_id: workspaceId,
                  sku: sku.sku,
                  style: sku.style,
                  vendor_id: product.vendor_id,
                  vendor_name: vendorName,
                }, {
                  onConflict: 'workspace_id,sku',
                });
              
              if (!upsertError) {
                updatedCount++;
              }
            }
          }
        }
      }
    }
    
    // Update sync timestamp
    await serviceSupabase
      .from('apparelmagic_connections')
      .update({ last_vendor_sync: new Date().toISOString() })
      .eq('workspace_id', workspaceId);
    
    return NextResponse.json({
      success: true,
      vendorsSynced: vendors.length,
      productsUpdated: updatedCount,
    });
    
  } catch (error) {
    console.error('Vendor sync error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
