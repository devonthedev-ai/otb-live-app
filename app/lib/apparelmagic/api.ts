import { createClient } from '@/app/lib/supabase/client';

interface ApparelMagicCredentials {
  subdomain: string;
  token: string;
}

interface PaginationParams {
  pageSize?: number;
  lastId?: string;
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

  private async requestPost<T>(
    endpoint: string,
    pagination?: PaginationParams
  ): Promise<T> {
    const url = `${this.baseUrl}/${endpoint}`;
    
    // Build request body with auth and pagination (per ApparelMagic docs)
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

    console.log('ApparelMagic API POST:', { 
      url, 
      endpoint,
      pageSize: requestBody.pagination.page_size,
      lastId: requestBody.pagination.last_id || 'none'
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
      console.error('ApparelMagic API error:', errorText.substring(0, 200));
      throw new Error(`ApparelMagic API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  private async requestGet<T>(
    endpoint: string,
    pagination?: PaginationParams
  ): Promise<T> {
    const authParams = this.getAuthParams();
    const params = new URLSearchParams(authParams);
    
    // Add pagination params
    if (pagination?.pageSize) {
      params.append('page_size', String(pagination.pageSize));
    }
    if (pagination?.lastId) {
      params.append('last_id', pagination.lastId);
    }
    
    const url = `${this.baseUrl}/${endpoint}?${params.toString()}`;
    
    console.log('ApparelMagic API GET:', { 
      url: url.replace(this.token, '***TOKEN***'), 
      endpoint,
      pageSize: pagination?.pageSize,
      lastId: pagination?.lastId || 'none'
    });

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'OTB-Live/1.0',
        'Accept-Encoding': 'gzip, deflate',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details');
      console.error('ApparelMagic API error:', errorText.substring(0, 200));
      throw new Error(`ApparelMagic API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Test connection
  async testConnection(): Promise<boolean> {
    try {
      console.log('Testing ApparelMagic connection:', { subdomain: this.subdomain, url: this.baseUrl });
      const result = await this.requestGet('products', { pageSize: 1 });
      console.log('ApparelMagic connection test result:', JSON.stringify(result).slice(0, 200));
      return true;
    } catch (error) {
      console.error('ApparelMagic connection failed:', error);
      return false;
    }
  }

  // Get products with pagination (GET)
  async getProducts(pagination?: PaginationParams): Promise<{
    products: ApparelMagicProduct[];
    lastId: string | null;
  }> {
    const response = await this.requestGet<ApparelMagicProductsResponse>(
      'products',
      pagination
    );
    
    return {
      products: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get inventory/stock (GET - this endpoint works with GET)
  async getInventory(pagination?: PaginationParams): Promise<{
    inventory: ApparelMagicInventory[];
    lastId: string | null;
  }> {
    const response = await this.requestGet<ApparelMagicInventoryResponse>(
      'inventory',
      pagination
    );
    
    return {
      inventory: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get ALL inventory using proper POST pagination
  async getAllInventory(): Promise<ApparelMagicInventory[]> {
    const allInventory: ApparelMagicInventory[] = [];
    let lastId: string | undefined;
    let pageNum = 0;
    const maxPages = 20; // Safety limit (2000 items max)
    
    console.log('[ApparelMagic] Starting inventory fetch with POST pagination...');
    
    while (pageNum < maxPages) {
      pageNum++;
      
      try {
        console.log(`[ApparelMagic] Fetching page ${pageNum}${lastId ? ` (last_id: ${lastId})` : ''}...`);
        const { inventory, lastId: newLastId } = await this.getInventory(
          lastId ? { lastId, pageSize: 100 } : { pageSize: 100 }
        );
        
        console.log(`[ApparelMagic] Page ${pageNum}: got ${inventory.length} items, last_id: ${newLastId || 'null'}`);
        
        if (inventory.length === 0) {
          console.log('[ApparelMagic] Empty page, stopping');
          break;
        }
        
        allInventory.push(...inventory);
        
        // If no last_id, we're done
        if (!newLastId) {
          console.log('[ApparelMagic] No last_id returned, all pages fetched');
          break;
        }
        
        // Avoid infinite loop - check if last_id changed
        if (newLastId === lastId) {
          console.log('[ApparelMagic] last_id unchanged, stopping');
          break;
        }
        
        lastId = newLastId;
        
        // Rate limiting: max 4 requests per second
        await new Promise(r => setTimeout(r, 250));
        
      } catch (error: any) {
        if (error.message?.includes('429')) {
          console.log('[ApparelMagic] Rate limited, waiting 1 second...');
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        console.error(`[ApparelMagic] Error on page ${pageNum}:`, error);
        break;
      }
    }
    
    console.log(`[ApparelMagic] Total: ${allInventory.length} items from ${pageNum} pages`);
    return allInventory;
  }

  // Get all products (handles pagination)
  async getAllProducts(): Promise<ApparelMagicProduct[]> {
    return this.getAllProductsChunked();
  }

  // Get all products (handles pagination) - CHUNKED VERSION
  async getAllProductsChunked(
    onChunk?: (products: ApparelMagicProduct[], page: number) => Promise<boolean> | boolean,
    maxPages: number = 50
  ): Promise<ApparelMagicProduct[]> {
    const allProducts: ApparelMagicProduct[] = [];
    let lastId: string | undefined;
    let pageCount = 0;
    
    console.log(`[ApparelMagic] Starting product fetch with POST pagination, maxPages: ${maxPages}`);
    
    try {
      while (pageCount < maxPages) {
        pageCount++;
        
        console.log(`[ApparelMagic] Fetching page ${pageCount}${lastId ? ` (last_id: ${lastId})` : ''}`);
        
        const result = await this.getProducts(
          lastId ? { lastId, pageSize: 100 } : { pageSize: 100 }
        );
        
        const { products, lastId: newLastId } = result;
        
        console.log(`[ApparelMagic] Page ${pageCount}: got ${products.length} products, last_id: ${newLastId || 'null'}`);
        
        if (products.length === 0) {
          console.log(`[ApparelMagic] Empty page, stopping`);
          break;
        }
        
        allProducts.push(...products);
        
        if (onChunk) {
          const shouldContinue = await onChunk(products, pageCount);
          if (shouldContinue === false) {
            break;
          }
        }
        
        if (!newLastId) {
          console.log(`[ApparelMagic] No last_id, all pages fetched`);
          break;
        }
        
        // Avoid infinite loop
        if (newLastId === lastId) {
          console.log(`[ApparelMagic] last_id unchanged (${newLastId}), stopping`);
          break;
        }
        
        lastId = newLastId;
        
        // Rate limiting
        await new Promise(r => setTimeout(r, 250));
      }
    } catch (error) {
      console.error('[ApparelMagic] Error during pagination:', error);
    }
    
    console.log(`[ApparelMagic] Pagination complete. Total: ${allProducts.length} products from ${pageCount} pages`);
    return allProducts;
  }

  // Get invoices (sales) with date filter
  async getInvoices(startDate?: string, pagination?: PaginationParams): Promise<{
    invoices: ApparelMagicInvoice[];
    lastId: string | null;
  }> {
    // Build request body with auth, pagination, and optional date filter
    const requestBody: any = {
      ...this.getAuthParams(),
      pagination: {
        page_size: pagination?.pageSize || 100,
      },
    };
    
    if (pagination?.lastId) {
      requestBody.pagination.last_id = String(pagination.lastId);
    }
    
    // Add date filter if provided
    if (startDate) {
      requestBody.parameters = [
        {
          field: 'date',
          operator: '>=',
          value: startDate,
        },
      ];
    }

    const url = `${this.baseUrl}/invoices`;
    
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
      console.error('ApparelMagic API error:', errorText.substring(0, 200));
      throw new Error(`ApparelMagic API error: ${response.status} ${response.statusText}`);
    }

    const data: ApparelMagicInvoicesResponse = await response.json();
    
    return {
      invoices: data.response || [],
      lastId: data.meta?.pagination?.last_id || null,
    };
  }

  // Get all invoices (handles pagination)
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
        
        console.log(`[ApparelMagic] Invoices page ${pageCount}: got ${invoices.length} invoices`);
        
        if (invoices.length === 0) break;
        
        allInvoices.push(...invoices);
        
        if (!newLastId) break;
        if (newLastId === lastId) break;
        
        lastId = newLastId;
        
        // Rate limiting
        await new Promise(r => setTimeout(r, 250));
        
      } catch (error: any) {
        if (error.message?.includes('429')) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        console.error(`[ApparelMagic] Error fetching invoices page ${pageCount}:`, error);
        break;
      }
    }
    
    console.log(`[ApparelMagic] Total invoices: ${allInvoices.length} from ${pageCount} pages`);
    return allInvoices;
  }

  // Get vendors (GET)
  async getVendors(pagination?: PaginationParams): Promise<{
    vendors: ApparelMagicVendor[];
    lastId: string | null;
  }> {
    const response = await this.requestGet<ApparelMagicVendorsResponse>(
      'vendors',
      pagination
    );
    
    return {
      vendors: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get all vendors (handles pagination)
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

  // Get product attributes (GET)
  async getProductAttributes(pagination?: PaginationParams): Promise<{
    attributes: any[];
    lastId: string | null;
  }> {
    const response = await this.requestGet<any>(
      'product_attributes',
      pagination
    );
    
    return {
      attributes: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get all product attributes (handles pagination)
  async getAllProductAttributes(): Promise<any[]> {
    const allAttributes: any[] = [];
    let lastId: string | undefined;
    
    while (true) {
      const { attributes, lastId: newLastId } = await this.getProductAttributes(
        lastId ? { lastId } : undefined
      );
      
      allAttributes.push(...attributes);
      
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    return allAttributes;
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
