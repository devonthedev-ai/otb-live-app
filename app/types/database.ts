// types/database.ts - Supabase database types

// === AUTH / WORKSPACE ===

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'starter' | 'growth' | 'enterprise';
  stripe_customer_id?: string;
  stripe_subscription_id?: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'buyer' | 'viewer';
  invited_email?: string;
  status: 'active' | 'invited' | 'disabled';
  created_at: string;
  
  // Joined fields
  user?: {
    email: string;
    raw_user_meta_data?: {
      full_name?: string;
      avatar_url?: string;
    };
  };
}

export interface Invitation {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  invited_by: string;
  token: string;
  expires_at: string;
  created_at: string;
}

// === CORE DATA ===

export interface DbProduct {
  id: string;
  workspace_id: string;
  style: string;
  color: string;
  size: string;
  category?: string;
  subcategory?: string;
  season: string;
  lead_time_days: number;
  cost: number;
  vendor?: string;
  weather_sensitive: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DbInventory {
  id: string;
  workspace_id: string;
  product_id: string;
  on_hand: number;
  incoming_qty: number;
  reserved_qty: number;
  available_qty: number;
  last_synced_at?: string;
  created_at: string;
  updated_at: string;
}

export interface DbSale {
  id: string;
  workspace_id: string;
  product_id: string;
  units: number;
  net_sales?: number;
  sale_date: string;
  channel: 'online' | 'wholesale' | 'retail' | 'other';
  source?: string;
  import_batch_id?: string;
  created_at: string;
}

// === CALCULATIONS ===

export interface DbRecommendation {
  id: string;
  workspace_id: string;
  product_id: string;
  current_stock: number;
  daily_velocity: number;
  days_until_stockout: number;
  suggested_qty: number;
  reason: string;
  is_core: boolean;
  confidence: number;
  volatility: 'low' | 'medium' | 'high';
  trend: 'accelerating' | 'decelerating' | 'stable';
  channel_breakdown?: Record<string, { velocity: number; trend: number }>;
  calculated_at: string;
  
  // Seasonal analysis
  seasonal_classification?: 'core' | 'seasonal' | 'holiday' | 'declining' | 'emerging';
  seasonal_confidence?: number;
  peak_months?: number[];
  seasonal_multiplier?: number;
  
  // Joined fields
  product?: DbProduct;
  inventory?: DbInventory;
}

// === SEASONAL PATTERNS ===

export interface SeasonalPattern {
  id: string;
  workspace_id: string;
  product_id: string;
  
  // Analysis results
  is_seasonal: boolean;
  peak_months: number[];
  trough_months: number[];
  seasonality_score: number; // 0-1
  classification: 'core' | 'seasonal' | 'holiday';
  confidence: number;
  
  // YoY trend
  yoy_growth_rate?: number;
  yoy_is_growing?: boolean;
  yoy_confidence?: number;
  
  // Metadata
  analysis_date: string;
  data_points: number;
  
  // Override (user can mark as core/seasonal)
  user_override?: 'core' | 'seasonal' | null;
}

// === PURCHASE ORDERS ===

export interface DbPurchaseOrder {
  id: string;
  workspace_id: string;
  po_number: string;
  vendor: string;
  status: 'draft' | 'sent' | 'confirmed' | 'received' | 'cancelled';
  order_date: string;
  delivery_date?: string;
  total_qty: number;
  total_cost: number;
  notes?: string;
  metadata: Record<string, unknown>;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface DbPurchaseOrderItem {
  id: string;
  po_id: string;
  workspace_id: string;
  product_id: string;
  qty: number;
  cost: number;
  extended_cost: number;
  received_qty: number;
  
  // Joined fields
  product?: DbProduct;
}

// === IMPORTS ===

export interface DbImportBatch {
  id: string;
  workspace_id: string;
  source: string;
  filename?: string;
  record_count?: number;
  status: 'processing' | 'completed' | 'failed';
  error_message?: string;
  started_at: string;
  completed_at?: string;
}

// === ALERTS ===

export interface DbAlert {
  id: string;
  workspace_id: string;
  product_id: string;
  type: 'critical' | 'reorder' | 'trend_change' | 'size_run_broken';
  severity: 'high' | 'medium' | 'low';
  message: string;
  read: boolean;
  read_at?: string;
  read_by?: string;
  created_at: string;
  
  // Joined fields
  product?: DbProduct;
}

// === INTEGRATIONS ===

export interface DbIntegration {
  id: string;
  workspace_id: string;
  provider: 'shopify' | 'apparel_magic' | 'netsuite' | 'cin7';
  credentials: {
    // Encrypted stored credentials
    access_token?: string;
    refresh_token?: string;
    shop_domain?: string; // for Shopify
    api_key?: string;
    api_secret?: string;
    [key: string]: unknown;
  };
  settings: {
    sync_frequency?: 'hourly' | 'daily' | 'manual';
    auto_import?: boolean;
    default_channel?: string;
    [key: string]: unknown;
  };
  last_sync_at?: string;
  last_sync_status?: string;
  last_error?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbWebhookEvent {
  id: string;
  workspace_id: string;
  integration_id?: string;
  provider: string;
  event_type: string;
  payload: Record<string, unknown>;
  processed: boolean;
  processed_at?: string;
  error_message?: string;
  created_at: string;
}

// === API RESPONSE TYPES ===

export interface PaginatedResponse<T> {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface DashboardStats {
  totalSKUs: number;
  coreSKUs: number;
  criticalCount: number;
  reorderCount: number;
  okCount: number;
  deadStockCount: number;
  avgWeeksOfSupply: number;
  totalInventoryValue: number;
  pendingAlerts: number;
}

// === SYNC TYPES ===

export interface SyncResult {
  success: boolean;
  recordsProcessed: number;
  recordsCreated: number;
  recordsUpdated: number;
  errors: string[];
}
