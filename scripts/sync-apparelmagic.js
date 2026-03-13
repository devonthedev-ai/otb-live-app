// Standalone script to run ApparelMagic sync for OTB Live
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://xkhvmkhsjjniieoxjsoh.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error('Error: SUPABASE_SERVICE_ROLE_KEY environment variable required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

// ApparelMagic API Client
class ApparelMagicClient {
  constructor(credentials) {
    this.subdomain = credentials.subdomain;
    this.token = credentials.token;
    this.baseUrl = `https://${this.subdomain}.app.apparelmagic.com/api/json`;
  }

  getAuthParams() {
    return {
      time: String(Math.floor(Date.now() / 1000)),
      token: this.token,
    };
  }

  async request(endpoint, method = 'GET', body, pagination) {
    const authParams = this.getAuthParams();
    
    let url;
    let requestBody;
    let headers = {
      'User-Agent': 'OTB-Live/1.0',
      'Content-Type': 'application/json',
    };

    if (method === 'GET') {
      const params = new URLSearchParams(authParams);
      if (pagination?.lastId) {
        params.append('last_id', pagination.lastId);
      }
      url = `${this.baseUrl}/${endpoint}?${params.toString()}`;
    } else {
      url = `${this.baseUrl}/${endpoint}`;
      const requestData = { ...authParams, ...body };
      if (pagination?.pageSize) {
        requestData.pagination = { page_size: pagination.pageSize };
        if (pagination.lastId) requestData.pagination.last_id = pagination.lastId;
      }
      requestBody = JSON.stringify(requestData);
    }

    console.log('ApparelMagic API request:', { url: url.replace(this.token, '***TOKEN***'), method });

    const response = await fetch(url, { method, headers, body: requestBody });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details');
      console.error('ApparelMagic API error:', errorText);
      throw new Error(`ApparelMagic API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getProducts(pagination) {
    const response = await this.request('products', 'GET', undefined, pagination);
    return {
      products: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  async getInventory(pagination) {
    const response = await this.request('inventory', 'GET', undefined, pagination);
    return {
      inventory: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  async getAllInventory() {
    const allInventory = [];
    let lastId;
    
    while (true) {
      const { inventory, lastId: newLastId } = await this.getInventory(lastId ? { lastId } : undefined);
      allInventory.push(...inventory);
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    return allInventory;
  }

  async getInvoices(startDate, pagination) {
    let urlParams = '';
    if (startDate) {
      urlParams = `&parameters[0][field]=date&parameters[0][operator]=>=&parameters[0][value]=${startDate}`;
    }
    
    const response = await this.request('invoices' + (urlParams ? '?' + urlParams.slice(1) : ''), 'GET', undefined, pagination);
    return {
      invoices: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  async getAllInvoices(startDate) {
    const allInvoices = [];
    let lastId;
    
    while (true) {
      const { invoices, lastId: newLastId } = await this.getInvoices(startDate, lastId ? { lastId } : undefined);
      allInvoices.push(...invoices);
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    return allInvoices;
  }

  async getVendors(pagination) {
    const response = await this.request('vendors', 'GET', undefined, pagination);
    return {
      vendors: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  async getAllVendors() {
    const allVendors = [];
    let lastId;
    
    while (true) {
      const { vendors, lastId: newLastId } = await this.getVendors(lastId ? { lastId } : undefined);
      allVendors.push(...vendors);
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    return allVendors;
  }
}

async function runSync(workspaceId, targetSeason = 'SS26') {
  const startTime = Date.now();
  console.log(`\n🏁 Starting ApparelMagic sync for workspace ${workspaceId}`);
  console.log(`📅 Target season: ${targetSeason}`);
  console.log(`⏰ Start time: ${new Date().toISOString()}\n`);

  // Get credentials
  const { data: credentials } = await supabase
    .from('apparelmagic_connections')
    .select('subdomain, token')
    .eq('workspace_id', workspaceId)
    .single();

  if (!credentials) {
    throw new Error('ApparelMagic not connected for this workspace');
  }

  const client = new ApparelMagicClient(credentials);
  const results = {
    products: 0,
    inventory: 0,
    sales: 0,
    vendors: 0,
    archived: 0,
    filtered: 0,
    targetSeason: targetSeason,
  };

  // === FETCH PRODUCTS IN CHUNKS ===
  console.log(`🏷️ Fetching products to find ${targetSeason}...`);
  
  const targetStyleNumbers = new Set();
  const uniqueSeasons = new Set();
  let lastId;
  let pageCount = 0;
  const maxPages = 50; // Higher limit for cron

  while (pageCount < maxPages) {
    pageCount++;
    console.log(`  📄 Page ${pageCount}${lastId ? ` (after ${lastId})` : ''}`);
    
    const { products, lastId: newLastId } = await client.getProducts(lastId ? { lastId } : undefined);
    
    if (products.length === 0) {
      console.log('  ✓ No more products');
      break;
    }
    
    for (const product of products) {
      const styleNumber = String(product.style_number || '');
      const season = product.season || '';
      
      if (season) {
        uniqueSeasons.add(String(season));
        if (season.toLowerCase() === targetSeason.toLowerCase() && styleNumber) {
          targetStyleNumbers.add(styleNumber);
        }
      }
    }
    
    const hasTargetSeason = Array.from(uniqueSeasons).some(s => 
      s.toLowerCase() === targetSeason.toLowerCase()
    );
    
    // Continue a bit more after finding target season
    if (hasTargetSeason && targetStyleNumbers.size > 0 && pageCount > 10) {
      console.log(`  ✓ Found ${targetSeason} with ${targetStyleNumbers.size} styles, continuing...`);
    }
    
    if (!newLastId) {
      console.log('  ✓ No more pages');
      break;
    }
    lastId = newLastId;
  }

  console.log(`\n📋 All seasons found: ${Array.from(uniqueSeasons).slice(0, 20).join(', ')}${uniqueSeasons.size > 20 ? '...' : ''}`);
  console.log(`📊 ${targetSeason} styles found: ${targetStyleNumbers.size} (from ${pageCount} pages)\n`);

  if (targetStyleNumbers.size === 0) {
    return {
      success: true,
      ...results,
      message: `No ${targetSeason} products found.`,
      availableSeasons: Array.from(uniqueSeasons),
    };
  }

  // === FETCH INVENTORY ===
  console.log('📦 Fetching all inventory...');
  const inventory = await client.getAllInventory();
  console.log(`  ✓ Total inventory items: ${inventory.length}`);
  
  const targetInventory = inventory.filter(item =>
    targetStyleNumbers.has(item.style_number)
  );
  console.log(`  ✓ ${targetSeason} inventory items: ${targetInventory.length}\n`);

  // === FETCH SALES HISTORY ===
  const twoYearsAgo = new Date();
  twoYearsAgo.setDate(twoYearsAgo.getDate() - 730);
  
  console.log(`📊 Fetching sales since ${twoYearsAgo.toISOString().split('T')[0]}...`);
  const allInvoices = await client.getAllInvoices(twoYearsAgo.toISOString().split('T')[0]);
  console.log(`  ✓ Total invoices: ${allInvoices.length}`);

  // Build activity map
  const skuActivity = new Map();
  let totalSalesItems = 0;
  
  for (const invoice of allInvoices) {
    if (!invoice.invoice_items) continue;
    
    for (const item of invoice.invoice_items) {
      totalSalesItems++;
      const existing = skuActivity.get(item.sku_id);
      if (!existing || new Date(invoice.date) > new Date(existing.lastSale)) {
        skuActivity.set(item.sku_id, {
          lastSale: invoice.date,
          totalUnits: (existing?.totalUnits || 0) + (parseInt(item.qty) || 0)
        });
      } else {
        existing.totalUnits += parseInt(item.qty) || 0;
      }
    }
  }
  console.log(`  ✓ Total sales line items: ${totalSalesItems}`);
  console.log(`  ✓ Unique SKUs with sales: ${skuActivity.size}\n`);

  // === APPLY ARCHIVE LOGIC ===
  const archiveThreshold = 365; // 12 months
  const now = new Date();
  const activeInventory = [];
  const archivedSkus = [];

  for (const item of targetInventory) {
    const activity = skuActivity.get(item.sku_id);
    const daysSinceLastSale = activity 
      ? Math.floor((now.getTime() - new Date(activity.lastSale).getTime()) / (1000 * 60 * 60 * 24))
      : 9999;
    
    const shouldKeep = 
      (activity && daysSinceLastSale < archiveThreshold) ||
      (parseFloat(item.qty_inventory) || 0) > 0 ||
      (parseFloat(item.qty_open_po) || 0) > 0;
    
    if (shouldKeep) {
      activeInventory.push(item);
    } else {
      archivedSkus.push({
        sku: item.sku_concat || item.sku_id,
        style: item.style_number,
        lastSale: activity?.lastSale,
        daysSinceLastSale,
      });
    }
  }

  results.filtered = targetInventory.length - activeInventory.length;
  results.archived = archivedSkus.length;

  console.log(`📋 Archive Analysis:`);
  console.log(`  • Active items: ${activeInventory.length}`);
  console.log(`  • Archived items: ${archivedSkus.length}`);
  console.log(`  • Archive rate: ${((results.archived / targetInventory.length) * 100).toFixed(1)}%\n`);

  // === SYNC TO DATABASE ===
  console.log('💾 Syncing to Supabase...\n');

  // Mark archived items
  if (archivedSkus.length > 0) {
    console.log(`  🗃️ Archiving ${archivedSkus.length} items...`);
    for (const sku of archivedSkus) {
      await supabase
        .from('products')
        .upsert({
          workspace_id: workspaceId,
          sku: sku.sku,
          style: sku.style,
          is_archived: true,
          archived_at: new Date().toISOString(),
          archive_reason: sku.lastSale 
            ? `No sales in ${sku.daysSinceLastSale} days`
            : 'No sales history',
        }, { onConflict: 'workspace_id,sku' });
    }
  }

  // Un-archive active items
  if (activeInventory.length > 0) {
    console.log(`  🔄 Un-archiving ${activeInventory.length} active items...`);
    for (const item of activeInventory) {
      await supabase
        .from('inventory_levels')
        .update({ is_archived: false, archived_at: null })
        .eq('workspace_id', workspaceId)
        .eq('sku', item.sku_concat || item.sku_id);
    }
  }

  // Transform and sync products
  const transformedProducts = activeInventory.map((item) => ({
    workspace_id: workspaceId,
    external_id: item.sku_id,
    name: `${item.style_number} ${item.attr_2 || ''} ${item.size || ''}`.trim(),
    sku: item.sku_concat || item.sku_id,
    style: item.style_number,
    color: item.attr_2 || 'Unknown',
    size: item.size || 'Unknown',
    cost: parseFloat(item.cost || '0') || 0,
    price: parseFloat(item.price || '0') || 0,
    category: targetSeason,
    source: 'apparelmagic',
    is_archived: false,
    last_sale_date: skuActivity.get(item.sku_id)?.lastSale || null,
    total_sold_24mo: skuActivity.get(item.sku_id)?.totalUnits || 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }));

  const uniqueProducts = Array.from(
    new Map(transformedProducts.map(p => [p.sku, p])).values()
  );

  if (uniqueProducts.length > 0) {
    console.log(`  📝 Upserting ${uniqueProducts.length} products...`);
    const { error: productsError } = await supabase
      .from('products')
      .upsert(uniqueProducts, { onConflict: 'workspace_id,sku' });
    
    if (productsError) console.error('  ⚠️ Products error:', productsError.message);
  }
  results.products = uniqueProducts.length;

  // Transform and sync inventory
  const transformedInventory = activeInventory.map((item) => ({
    workspace_id: workspaceId,
    external_id: item.sku_id,
    sku: item.sku_concat || item.sku_id,
    style: item.style_number,
    color: item.attr_2 || 'Unknown',
    size: item.size || 'Unknown',
    qty_on_hand: parseFloat(item.qty_inventory) || 0,
    qty_available: parseFloat(item.qty_avail_sell) || 0,
    qty_allocated: parseFloat(item.qty_alloc) || 0,
    qty_reserved: parseFloat(item.qty_picked) || 0,
    qty_open_po: parseFloat(item.qty_open_po || '0') || 0,
    upc: item.upc_display || item.upc_11 || '',
    cost: parseFloat(item.cost || '0') || 0,
    price: parseFloat(item.price || '0') || 0,
    weight: parseFloat(item.weight || '0') || 0,
    source: 'apparelmagic',
    last_synced_at: new Date().toISOString(),
  }));

  const uniqueInventory = Array.from(
    new Map(transformedInventory.map(i => [i.sku, i])).values()
  );

  if (uniqueInventory.length > 0) {
    console.log(`  📦 Upserting ${uniqueInventory.length} inventory records...`);
    const { error: inventoryError } = await supabase
      .from('inventory_levels')
      .upsert(uniqueInventory, { onConflict: 'workspace_id,sku' });
    
    if (inventoryError) console.error('  ⚠️ Inventory error:', inventoryError.message);
  }
  results.inventory = uniqueInventory.length;

  // Sync sales
  const activeSkuSet = new Set(activeInventory.map(i => i.sku_id));
  const salesRecords = [];

  for (const invoice of allInvoices.slice(0, 500)) {
    if (!invoice.invoice_items) continue;
    
    for (const item of invoice.invoice_items) {
      if (!activeSkuSet.has(item.sku_id)) continue;
      
      salesRecords.push({
        workspace_id: workspaceId,
        external_id: item.id,
        invoice_id: invoice.invoice_id,
        sku: item.sku_id,
        style: item.style_number,
        color: item.attr_2 || 'Unknown',
        size: item.size || 'Unknown',
        units: parseInt(item.qty) || 0,
        unit_price: parseFloat(item.unit_price) || 0,
        net_sales: parseFloat(item.amount) || 0,
        sale_date: invoice.date,
        customer_id: invoice.customer_id,
        channel: 'wholesale',
        source: 'apparelmagic',
      });
    }
  }

  const uniqueSales = Array.from(
    new Map(salesRecords.map(s => [s.external_id, s])).values()
  );

  if (uniqueSales.length > 0) {
    console.log(`  💰 Upserting ${uniqueSales.length} sales records...`);
    const { error: salesError } = await supabase
      .from('sales')
      .upsert(uniqueSales, { onConflict: 'workspace_id,external_id' });
    
    if (salesError) console.error('  ⚠️ Sales error:', salesError.message);
  }
  results.sales = uniqueSales.length;

  // Sync vendors
  console.log('  🏢 Fetching vendors...');
  const vendors = await client.getAllVendors();
  results.vendors = vendors.length;
  console.log(`  ✓ Found ${vendors.length} vendors`);

  // Update sync timestamps
  const nowISO = new Date().toISOString();
  await supabase
    .from('apparelmagic_connections')
    .update({
      last_sync_at: nowISO,
      last_inventory_sync: nowISO,
      last_sales_sync: nowISO,
      last_vendor_sync: nowISO,
    })
    .eq('workspace_id', workspaceId);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`\n✅ Sync completed in ${duration}s`);
  console.log('='.repeat(50));
  console.log('SYNC SUMMARY');
  console.log('='.repeat(50));
  console.log(`Products synced:    ${results.products}`);
  console.log(`Inventory records:  ${results.inventory}`);
  console.log(`Sales records:      ${results.sales}`);
  console.log(`Vendors found:      ${results.vendors}`);
  console.log(`Items archived:     ${results.archived}`);
  console.log(`Target season:      ${results.targetSeason}`);
  console.log('='.repeat(50));

  return {
    success: true,
    ...results,
    duration: `${duration}s`,
    message: `Synced ${results.products} active ${targetSeason} products (${results.filtered} archived), ${results.sales} sales`,
  };
}

// Main execution
async function main() {
  // Find OTB Live workspace
  console.log('🔍 Looking for OTB Live workspace...');
  
  const { data: workspaces, error } = await supabase
    .from('workspaces')
    .select('id, name, slug')
    .ilike('name', '%otb%');

  if (error) {
    console.error('Database error:', error.message);
    process.exit(1);
  }

  if (!workspaces || workspaces.length === 0) {
    // Try any workspace with ApparelMagic connection
    const { data: allWorkspaces } = await supabase
      .from('apparelmagic_connections')
      .select('workspace_id');
    
    if (!allWorkspaces || allWorkspaces.length === 0) {
      console.error('No workspaces with ApparelMagic connections found');
      process.exit(1);
    }
    
    console.log(`Found ${allWorkspaces.length} workspace(s) with ApparelMagic`);
    
    for (const conn of allWorkspaces) {
      console.log(`\n🔄 Running sync for workspace: ${conn.workspace_id}`);
      const result = await runSync(conn.workspace_id, 'SS26');
      console.log('\nResult:', JSON.stringify(result, null, 2));
    }
  } else {
    console.log(`Found workspace: ${workspaces[0].name} (${workspaces[0].id})`);
    const result = await runSync(workspaces[0].id, 'SS26');
    console.log('\nResult:', JSON.stringify(result, null, 2));
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
