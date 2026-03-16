import { createClient } from '@/app/lib/supabase/client';

interface ApparelMagicCredentials {
  subdomain: string;
  token: string;
}

interface PaginationParams {
  pageSize?: number;
  lastId?: string;
}

interface FilterParams {
  field: string;
  operator: string;
  value: string;
}

export class ApparelMagicClient {
  private subdomain: string;
  private token: string;
  private baseUrl: string;

  constructor(credentials: ApparelMagicCredentials) {
    this.subdomain = credentials.subdomain;
    this.token = credentials.token;
    this.baseUrl = `https://${this.subdomain}.app.apparelmagic.com/api/json`;
  }

  private getAuthParams(): Record<string, string> {
    return {
      time: String(Math.floor(Date.now() / 1000)),
      token: this.token,
    };
  }

  // POST request with pagination in body (per AM docs)
  private async requestPost<T>(
    endpoint: string,
    pagination?: PaginationParams,
    filters?: FilterParams[]
  ): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    
    // Build request body per ApparelMagic docs
    const requestBody: any = {
      ...this.getAuthParams(),
      pagination: {
        page_size: pagination?.pageSize || 100,
      },
    };
    
    // Add last_id for pagination (must be string per docs)
    if (pagination?.lastId) {
      requestBody.pagination.last_id = String(pagination.lastId);
    }
    
    // Add filters if provided
    if (filters && filters.length > 0) {
      requestBody.parameters = filters.map((f, index) => ({
        field: f.field,
        operator: f.operator,
        value: f.value,
      }));
    }

    console.log('[ApparelMagic] POST:', { 
      endpoint,
      pageSize: requestBody.pagination.page_size,
      lastId: requestBody.pagination.last_id || 'none',
      hasFilters: !!filters,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'User-Agent': 'OTB-Live/1.0',
        'Content-Type': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details');
      console.error('[ApparelMagic] API error:', errorText.substring(0, 200));
      throw new Error(`ApparelMagic API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Test connection
  async testConnection(): Promise<boolean> {
    try {
      console.log('Testing ApparelMagic connection:', { subdomain: this.subdomain });
      const result = await this.requestPost('products', { pageSize: 1 });
      console.log('Connection test:', JSON.stringify(result).slice(0, 200));
      return true;
    } catch (error) {
      console.error('Connection failed:', error);
      return false;
    }
  }

  // Get inventory with POST pagination
  async getInventory(pagination?: PaginationParams): Promise<{
    inventory: ApparelMagicInventory[];
    lastId: string | null;
  }> {
    const response = await this.requestPost<ApparelMagicInventoryResponse>(
      'inventory',
      pagination
    );
    
    return {
      inventory: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get inventory filtered by style number
  async getInventoryByStyle(styleNumber: string): Promise<ApparelMagicInventory[]> {
    const response = await this.requestPost<ApparelMagicInventoryResponse>(
      'inventory',
      { pageSize: 1000 },
      [{ field: 'style_number', operator: '=', value: styleNumber }]
    );
    
    return response.response || [];
  }

  // Get ALL inventory with proper POST pagination
  async getAllInventory(): Promise<ApparelMagicInventory[]> {
    const allInventory: ApparelMagicInventory[] = [];
    let lastId: string | undefined;
    let pageNum = 0;
    const maxPages = 50; // Safety limit (5000 items max with page_size 100)
    
    console.log('[ApparelMagic] Starting inventory fetch with POST pagination...');
    
    while (pageNum < maxPages) {
      pageNum++;
      
      try {
        console.log(`[ApparelMagic] Page ${pageNum}${lastId ? ` (last_id: ${lastId})` : ''}`);
        const { inventory, lastId: newLastId } = await this.getInventory(
          lastId ? { lastId, pageSize: 100 } : { pageSize: 100 }
        );
        
        console.log(`[ApparelMagic] Page ${pageNum}: ${inventory.length} items, last_id: ${newLastId || 'null'}`);
        
        if (inventory.length === 0) {
          console.log('[ApparelMagic] Empty page, stopping');
          break;
        }
        
        allInventory.push(...inventory);
        
        // If no last_id, we're done
        if (!newLastId) {
          console.log('[ApparelMagic] No last_id, all pages fetched');
          break;
        }
        
        // Avoid infinite loop
        if (newLastId === lastId) {
          console.log('[ApparelMagic] last_id unchanged, stopping');
          break;
        }
        
        lastId = newLastId;
        
        // Rate limiting: max 4 requests per second
        await new Promise(r => setTimeout(r, 250));
        
      } catch (error: any) {
        if (error.message?.includes('429')) {
          console.log('[ApparelMagic] Rate limited, waiting...');
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        console.error(`[ApparelMagic] Error on page ${pageNum}:`, error);
        break;
      }
    }
    
    console.log(`[ApparelMagic] Complete: ${allInventory.length} items from ${pageNum} pages`);
    return allInventory;
  }

  // Get products with POST pagination
  async getProducts(pagination?: PaginationParams): Promise<{
    products: ApparelMagicProduct[];
    lastId: string | null;
  }> {
    const response = await this.requestPost<ApparelMagicProductsResponse>(
      'products',
      pagination
    );
    
    return {
      products: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get ALL products with pagination
  async getAllProducts(): Promise<ApparelMagicProduct[]> {
    const allProducts: ApparelMagicProduct[] = [];
    let lastId: string | undefined;
    let pageCount = 0;
    const maxPages = 50;
    
    console.log('[ApparelMagic] Fetching all products...');
    
    while (pageCount < maxPages) {
      pageCount++;
      
      try {
        const { products, lastId: newLastId } = await this.getProducts(
          lastId ? { lastId, pageSize: 100 } : { pageSize: 100 }
        );
        
        console.log(`[ApparelMagic] Products page ${pageCount}: ${products.length} items`);
        
        if (products.length === 0) break;
        
        allProducts.push(...products);
        
        if (!newLastId || newLastId === lastId) break;
        
        lastId = newLastId;
        await new Promise(r => setTimeout(r, 250));
        
      } catch (error: any) {
        if (error.message?.includes('429')) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        throw error;
      }
    }
    
    console.log(`[ApparelMagic] Total products: ${allProducts.length}`);
    return allProducts;
  }

  // Get invoices with POST pagination
  async getInvoices(startDate?: string, pagination?: PaginationParams): Promise<{
    invoices: ApparelMagicInvoice[];
    lastId: string | null;
  }> {
    const filters: FilterParams[] = [];
    if (startDate) {
      filters.push({ field: 'date', operator: '>=', value: startDate });
    }
    
    const response = await this.requestPost<ApparelMagicInvoicesResponse>(
      'invoices',
      pagination,
      filters.length > 0 ? filters : undefined
    );
    
    return {
      invoices: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get all invoices
  async getAllInvoices(startDate?: string): Promise<ApparelMagicInvoice[]> {
    const allInvoices: ApparelMagicInvoice[] = [];
    let lastId: string | undefined;
    let pageCount = 0;
    const maxPages = 50;
    
    while (pageCount < maxPages) {
      pageCount++;
      
      try {
        const { invoices, lastId: newLastId } = await this.getInvoices(
          startDate,
          lastId ? { lastId, pageSize: 100 } : { pageSize: 100 }
        );
        
        if (invoices.length === 0) break;
        
        allInvoices.push(...invoices);
        
        if (!newLastId || newLastId === lastId) break;
        
        lastId = newLastId;
        await new Promise(r => setTimeout(r, 250));
        
      } catch (error: any) {
        if (error.message?.includes('429')) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        break;
      }
    }
    
    return allInvoices;
  }

  // Get vendors
  async getVendors(pagination?: PaginationParams): Promise<{
    vendors: ApparelMagicVendor[];
    lastId: string | null;
  }> {
    const response = await this.requestPost<ApparelMagicVendorsResponse>(
      'vendors',
      pagination
    );
    
    return {
      vendors: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get all vendors
  async getAllVendors(): Promise<ApparelMagicVendor[]> {
    const allVendors: ApparelMagicVendor[] = [];
    let lastId: string | undefined;
    
    while (true) {
      const { vendors, lastId: newLastId } = await this.getVendors(
        lastId ? { lastId } : undefined
      );
      
      allVendors.push(...vendors);
      
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    return allVendors;
  }
}

// Types
interface ApparelMagicResponse<T> {
  response: T[];
  meta: {
    pagination: {
      last_id: string | null;
    };
    errors: string[];
  };
}

interface ApparelMagicProduct {
  id: string;
  name: string;
  sku: string;
  style_number?: string;
  color?: string;
  size?: string;
  cost?: number;
  price?: number;
  category?: string;
  vendor_id?: string;
  season?: string;
  [key: string]: unknown;
}

interface ApparelMagicInventory {
  sku_id: string;
  product_id: string;
  style_number: string;
  attr_2?: string;
  size?: string;
  sku_concat?: string;
  cost?: string;
  price?: string;
  season?: string;
  qty_inventory?: string;
  qty_avail_sell?: string;
  qty_alloc?: string;
  qty_picked?: string;
  qty_open_po?: string;
  upc_display?: string;
  upc_11?: string;
  weight?: string;
  [key: string]: unknown;
}

interface ApparelMagicInvoice {
  invoice_id: string;
  date: string;
  customer_id: string;
  invoice_items?: Array<{
    id: string;
    sku_id: string;
    style_number: string;
    attr_2?: string;
    size?: string;
    qty: string;
    unit_price: string;
    amount: string;
  }>;
  [key: string]: unknown;
}

interface ApparelMagicVendor {
  id: string;
  name: string;
  code?: string;
  [key: string]: unknown;
}

type ApparelMagicProductsResponse = ApparelMagicResponse<ApparelMagicProduct>;
type ApparelMagicInventoryResponse = ApparelMagicResponse<ApparelMagicInventory>;
type ApparelMagicVendorsResponse = ApparelMagicResponse<ApparelMagicVendor>;
type ApparelMagicInvoicesResponse = ApparelMagicResponse<ApparelMagicInvoice>;

// Database functions
import { createServiceClient } from '@/app/lib/supabase/service';

export async function getApparelMagicCredentials(workspaceId: string): Promise<ApparelMagicCredentials | null> {
  const supabase = createClient();
  
  const { data, error } = await supabase
    .from('apparelmagic_connections')
    .select('subdomain, token')
    .eq('workspace_id', workspaceId)
    .single();
  
  if (error || !data) {
    console.error('Error fetching ApparelMagic credentials:', error);
    return null;
  }
  
  return {
    subdomain: data.subdomain,
    token: data.token,
  };
}

export async function saveApparelMagicCredentials(
  workspaceId: string,
  credentials: ApparelMagicCredentials
): Promise<{ error?: any }> {
  const supabase = createClient();
  
  const { error } = await supabase
    .from('apparelmagic_connections')
    .upsert({
      workspace_id: workspaceId,
      subdomain: credentials.subdomain,
      token: credentials.token,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id' });
  
  if (error) {
    console.error('Error saving ApparelMagic credentials:', error);
    return { error };
  }
  
  return {};
}
