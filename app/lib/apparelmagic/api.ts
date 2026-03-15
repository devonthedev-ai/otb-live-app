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

  private async request<T>(
    endpoint: string,
    method: 'GET' | 'POST' = 'GET',
    body?: Record<string, unknown>,
    pagination?: PaginationParams
  ): Promise<T> {
    const authParams = this.getAuthParams();
    
    let url: string;
    let requestBody: string | undefined;
    let headers: Record<string, string> = {
      'User-Agent': 'OTB-Live/1.0',
      'Content-Type': 'application/json',
    };

    if (method === 'GET') {
      const params = new URLSearchParams(authParams);
      // Try page parameter instead of last_id
      if (pagination?.lastId) {
        params.append('page', pagination.lastId);
      }
      url = `${this.baseUrl}/${endpoint}?${params.toString()}`;
    } else {
      url = `${this.baseUrl}/${endpoint}`;
      const requestData = {
        ...authParams,
        ...body,
      };
      if (pagination?.pageSize) {
        requestData.pagination = {
          page_size: pagination.pageSize,
          ...(pagination.lastId && { page: pagination.lastId }),
        };
      }
      requestBody = JSON.stringify(requestData);
    }

    console.log('ApparelMagic API request:', { url: url.replace(this.token, '***TOKEN***'), method, hasPagination: !!pagination?.lastId });

    const response = await fetch(url, {
      method,
      headers,
      body: requestBody,
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
      const result = await this.request('products', 'GET', undefined, { pageSize: 1 });
      console.log('ApparelMagic connection test result:', JSON.stringify(result).slice(0, 200));
      return true;
    } catch (error) {
      console.error('ApparelMagic connection failed:', error);
      return false;
    }
  }

  // Get products with pagination
  async getProducts(pagination?: PaginationParams): Promise<{
    products: ApparelMagicProduct[];
    lastId: string | null;
  }> {
    const response = await this.request<ApparelMagicProductsResponse>(
      'products',
      'GET',
      undefined,
      pagination
    );
    
    return {
      products: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get inventory/stock
  async getInventory(pagination?: PaginationParams): Promise<{
    inventory: ApparelMagicInventory[];
    lastId: string | null;
  }> {
    const response = await this.request<ApparelMagicInventoryResponse>(
      'inventory',
      'GET',
      undefined,
      pagination
    );
    
    return {
      inventory: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get ALL inventory using PAGE numbers
  async getAllInventory(): Promise<ApparelMagicInventory[]> {
    const allInventory: ApparelMagicInventory[] = [];
    let pageNum = 1;
    let hasMore = true;
    
    console.log('[ApparelMagic] Starting inventory fetch with page numbers...');
    
    while (hasMore && pageNum <= 10) { // Max 10 pages (1000 items)
      try {
        console.log(`[ApparelMagic] Fetching page ${pageNum}...`);
        const { inventory } = await this.getInventory(
          pageNum > 1 ? { lastId: String(pageNum) } : undefined
        );
        
        console.log(`[ApparelMagic] Page ${pageNum}: got ${inventory.length} items`);
        
        if (inventory.length === 0) {
          hasMore = false;
          break;
        }
        
        allInventory.push(...inventory);
        
        // If we got less than 100, this is the last page
        if (inventory.length < 100) {
          hasMore = false;
        } else {
          pageNum++;
        }
        
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
    
    console.log(`[ApparelMagic] GET pagination v3, maxPages: ${maxPages}`);
    
    try {
      while (pageCount < maxPages) {
        pageCount++;
        
        console.log(`[ApparelMagic] GET page ${pageCount}, lastId: ${lastId || 'none'}`);
        
        const result = await this.getProducts(
          lastId ? { lastId } : undefined
        );
        
        const { products, lastId: newLastId } = result;
        
        console.log(`[ApparelMagic] GET page ${pageCount}: got ${products.length} products`);
        
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
          console.log(`[ApparelMagic] No lastId in response, stopping`);
          break;
        }
        
        // Debug: check if lastId is actually incrementing
        if (newLastId === lastId) {
          console.log(`[ApparelMagic] lastId didn't change (${newLastId}), stopping`);
          break;
        }
        
        lastId = newLastId;
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
    const params: Record<string, string> = {};
    if (startDate) {
      params['parameters[0][field]'] = 'date';
      params['parameters[0][operator]'] = '>=';
      params['parameters[0][value]'] = startDate;
    }
    
    const response = await this.request<ApparelMagicInvoicesResponse>(
      'invoices',
      'GET',
      undefined,
      pagination
    );
    
    return {
      invoices: response.response || [],
      lastId: response.meta?.pagination?.last_id || null,
    };
  }

  // Get all invoices (handles pagination)
  async getAllInvoices(startDate?: string): Promise<ApparelMagicInvoice[]> {
    const allInvoices: ApparelMagicInvoice[] = [];
    let lastId: string | undefined;
    
    while (true) {
      const { invoices, lastId: newLastId } = await this.getInvoices(startDate, 
        lastId ? { lastId } : undefined
      );
      
      allInvoices.push(...invoices);
      
      if (!newLastId) break;
      lastId = newLastId;
    }
    
    return allInvoices;
  }

  // Get vendors
  async getVendors(pagination?: PaginationParams): Promise<{
    vendors: ApparelMagicVendor[];
    lastId: string | null;
  }> {
    const response = await this.request<ApparelMagicVendorsResponse>(
      'vendors',
      'GET',
      undefined,
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

  // Get product attributes
  async getProductAttributes(pagination?: PaginationParams): Promise<{
    attributes: any[];
    lastId: string | null;
  }> {
    const response = await this.request<any>(
      'product_attributes',
      'GET',
      undefined,
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
type ApparelMagicOrdersResponse = ApparelMagicResponse<ApparelMagicOrder>;
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

interface ApparelMagicOrder {
  id: string;
  order_id: string;
  customer_id: string;
  date: string;
  total: string;
  status: string;
  [key: string]: unknown;
}
