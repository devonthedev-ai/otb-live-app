-- Supabase database schema for OTB Live SaaS
-- Multi-tenant with row-level security (RLS)

-- Enable RLS
alter table auth.users enable row level security;

-- === WORKSPACES (Tenants) ===
create table workspaces (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  slug text unique not null, -- URL-friendly name
  plan text default 'free' check (plan in ('free', 'starter', 'growth', 'enterprise')),
  stripe_customer_id text,
  stripe_subscription_id text,
  settings jsonb default '{}',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- === WORKSPACE MEMBERS (User-Workspace linking) ===
create table workspace_members (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role text default 'member' check (role in ('owner', 'admin', 'buyer', 'viewer')),
  invited_email text,
  status text default 'active' check (status in ('active', 'invited', 'disabled')),
  created_at timestamp with time zone default now(),
  unique(workspace_id, user_id)
);

-- === INVITATIONS (For team invites) ===
create table invitations (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  email text not null,
  role text default 'buyer',
  invited_by uuid references auth.users(id),
  token text unique not null,
  expires_at timestamp with time zone not null,
  created_at timestamp with time zone default now()
);

-- === PRODUCTS ===
create table products (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  
  -- Core fields
  style text not null,
  color text not null,
  size text not null,
  
  -- Categorization
  category text,
  subcategory text,
  
  -- Planning data
  season text default 'Core',
  lead_time_days integer default 90,
  cost decimal(10,2) default 0,
  vendor text,
  weather_sensitive boolean default false,
  
  -- Metadata
  metadata jsonb default '{}',
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  -- Unique constraint: one SKU per workspace
  unique(workspace_id, style, color, size)
);

-- === INVENTORY ===
create table inventory (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  product_id uuid references products(id) on delete cascade not null,
  
  on_hand integer default 0,
  incoming_qty integer default 0,
  reserved_qty integer default 0,
  available_qty integer generated always as (on_hand + incoming_qty - reserved_qty) stored,
  
  last_synced_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  unique(workspace_id, product_id)
);

-- === SALES ===
create table sales (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  product_id uuid references products(id) on delete cascade not null,
  
  units integer not null,
  net_sales decimal(10,2),
  sale_date date not null,
  channel text default 'online' check (channel in ('online', 'wholesale', 'retail', 'other')),
  
  -- For CSV import tracking
  source text, -- 'shopify', 'apparel_magic', 'csv_upload'
  import_batch_id uuid,
  
  created_at timestamp with time zone default now()
);

-- === CALCULATED RECOMMENDATIONS (Cache) ===
-- Pre-calculated so the UI is fast, updated by background job
create table recommendations (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  product_id uuid references products(id) on delete cascade not null,
  
  -- Calculated fields
  current_stock integer,
  daily_velocity decimal(8,4),
  days_until_stockout integer,
  suggested_qty integer default 0,
  reason text,
  is_core boolean default true,
  
  -- Smart projections
  confidence integer default 50, -- 0-100
  volatility text default 'medium' check (volatility in ('low', 'medium', 'high')),
  trend text default 'stable' check (trend in ('accelerating', 'decelerating', 'stable')),
  
  -- Channel breakdown (stored as JSON for flexibility)
  channel_breakdown jsonb,
  
  calculated_at timestamp with time zone default now(),
  
  unique(workspace_id, product_id)
);

-- === PURCHASE ORDERS ===
create table purchase_orders (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  
  po_number text not null,
  vendor text not null,
  status text default 'draft' check (status in ('draft', 'sent', 'confirmed', 'received', 'cancelled')),
  
  order_date date default current_date,
  delivery_date date,
  
  total_qty integer default 0,
  total_cost decimal(12,2) default 0,
  
  notes text,
  metadata jsonb default '{}',
  
  created_by uuid references auth.users(id),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table purchase_order_items (
  id uuid default gen_random_uuid() primary key,
  po_id uuid references purchase_orders(id) on delete cascade not null,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  product_id uuid references products(id) on delete cascade not null,
  
  qty integer not null,
  cost decimal(10,2) not null,
  extended_cost decimal(12,2) generated always as (qty * cost) stored,
  
  received_qty integer default 0,
  
  unique(po_id, product_id)
);

-- === IMPORT BATCHES (Track CSV uploads) ===
create table import_batches (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  
  source text not null, -- 'inventory_csv', 'sales_csv', 'shopify', 'apparel_magic'
  filename text,
  record_count integer,
  status text default 'processing' check (status in ('processing', 'completed', 'failed')),
  error_message text,
  
  started_at timestamp with time zone default now(),
  completed_at timestamp with time zone
);

-- === ALERTS (Stockout warnings, etc) ===
create table alerts (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  product_id uuid references products(id) on delete cascade not null,
  
  type text not null check (type in ('critical', 'reorder', 'trend_change', 'size_run_broken')),
  severity text default 'medium' check (severity in ('high', 'medium', 'low')),
  message text not null,
  
  read boolean default false,
  read_at timestamp with time zone,
  read_by uuid references auth.users(id),
  
  created_at timestamp with time zone default now()
);

-- === INTEGRATIONS (Shopify, ApparelMagic creds) ===
create table integrations (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  
  provider text not null check (provider in ('shopify', 'apparel_magic', 'netsuite', 'cin7')),
  
  -- OAuth/encrypted credentials (use Supabase Vault or encrypt in app)
  credentials jsonb not null, -- encrypted access tokens, etc
  
  settings jsonb default '{}', -- sync frequency, filters, etc
  
  last_sync_at timestamp with time zone,
  last_sync_status text,
  last_error text,
  
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  
  unique(workspace_id, provider)
);

-- === WEBHOOK EVENTS (For Shopify, etc) ===
create table webhook_events (
  id uuid default gen_random_uuid() primary key,
  workspace_id uuid references workspaces(id) on delete cascade not null,
  integration_id uuid references integrations(id) on delete cascade,
  
  provider text not null,
  event_type text not null, -- 'order.created', 'inventory.updated', etc
  payload jsonb not null,
  
  processed boolean default false,
  processed_at timestamp with time zone,
  error_message text,
  
  created_at timestamp with time zone default now()
);

-- === ROW LEVEL SECURITY POLICIES ===

-- Users can only see workspaces they belong to
create policy "Users can view their workspaces"
  on workspaces for select
  using (exists (
    select 1 from workspace_members 
    where workspace_id = workspaces.id and user_id = auth.uid()
  ));

-- Only owners/admins can update workspace
create policy "Owners and admins can update workspace"
  on workspaces for update
  using (exists (
    select 1 from workspace_members 
    where workspace_id = workspaces.id 
    and user_id = auth.uid() 
    and role in ('owner', 'admin')
  ));

-- Workspace members can view other members
create policy "View workspace members"
  on workspace_members for select
  using (exists (
    select 1 from workspace_members as wm
    where wm.workspace_id = workspace_members.workspace_id 
    and wm.user_id = auth.uid()
  ));

-- Products, inventory, sales, etc - scoped to workspace
create policy "Workspace data isolation"
  on products for all
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

create policy "Workspace data isolation"
  on inventory for all
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

create policy "Workspace data isolation"
  on sales for all
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

create policy "Workspace data isolation"
  on purchase_orders for all
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

create policy "Workspace data isolation"
  on recommendations for all
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

create policy "Workspace data isolation"
  on alerts for all
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

create policy "Workspace data isolation"
  on integrations for all
  using (workspace_id in (
    select workspace_id from workspace_members where user_id = auth.uid()
  ));

-- === INDEXES FOR PERFORMANCE ===
create index idx_products_workspace on products(workspace_id, style, color, size);
create index idx_sales_workspace_date on sales(workspace_id, sale_date desc);
create index idx_sales_product on sales(product_id, sale_date desc);
create index idx_inventory_product on inventory(workspace_id, product_id);
create index idx_recommendations_workspace on recommendations(workspace_id, suggested_qty desc);
create index idx_alerts_workspace_read on alerts(workspace_id, read, created_at desc);
create index idx_webhook_events_unprocessed on webhook_events(processed, created_at) where processed = false;

-- === FUNCTIONS ===

-- Update updated_at timestamp
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Triggers for updated_at
create trigger update_workspaces_updated_at before update on workspaces
  for each row execute function update_updated_at_column();

create trigger update_products_updated_at before update on products
  for each row execute function update_updated_at_column();

create trigger update_inventory_updated_at before update on inventory
  for each row execute function update_updated_at_column();

create trigger update_purchase_orders_updated_at before update on purchase_orders
  for each row execute function update_updated_at_column();

create trigger update_integrations_updated_at before update on integrations
  for each row execute function update_updated_at_column();
