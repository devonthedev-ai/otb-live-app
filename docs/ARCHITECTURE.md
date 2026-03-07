# OTB Live SaaS Architecture

## Overview
Multi-tenant inventory planning SaaS with workspace-based data isolation.

## Tech Stack

### Frontend
- Next.js 14+ (App Router)
- TypeScript
- Tailwind CSS
- React Context for state management

### Backend
- Supabase (PostgreSQL + Auth + Realtime)
- Row Level Security (RLS) for tenant isolation
- Supabase Edge Functions for webhooks

### Auth
- Supabase Auth (email/password + OAuth)
- Workspace-based multi-tenancy
- Role-based access control (owner/admin/buyer/viewer)

## Database Schema Highlights

### Multi-Tenant Pattern
Every table has `workspace_id` column. RLS policies ensure users can only access data from workspaces they belong to.

### Core Tables
- `workspaces` - Tenant isolation
- `workspace_members` - User-workspace linking with roles
- `products` - SKU definitions (style/color/size)
- `inventory` - Current stock levels
- `sales` - Historical sales data
- `recommendations` - Pre-calculated reorder suggestions
- `purchase_orders` - PO management
- `integrations` - Shopify/ApparelMagic connections
- `alerts` - Stockout warnings, trend changes

### Key Design Decisions

1. **Separate products and inventory**
   - Products = master data (cost, lead time, vendor)
   - Inventory = current state (on_hand, incoming)
   - Allows tracking inventory history

2. **Pre-calculated recommendations**
   - Background job calculates all metrics
   - UI reads from `recommendations` table (fast)
   - Separates calculation complexity from UI

3. **Sales table with channel**
   - Online/wholesale/retail split
   - Enables channel-specific velocity calculations
   - Source field tracks data origin (shopify, csv, etc)

4. **Import batches**
   - Track CSV uploads
   - Allows rollback/re-import
   - Audit trail for data changes

## Authentication Flow

### Sign Up
1. User creates account
2. Auto-creates "Personal Workspace"
3. User becomes owner

### Sign In
1. Supabase Auth validates credentials
2. Fetch user's workspaces
3. Load last selected workspace (or first)

### Workspace Switching
1. Context updates current workspace
2. All queries filter by workspace_id
3. RLS enforces data isolation

## Data Flow

### CSV Import (Current)
```
CSV Upload → Parse → Batch Insert → Trigger Recalculation
```

### Shopify Integration (Future)
```
Shopify Webhook → Edge Function → Insert Sale → Trigger Recalculation
```

### Recommendation Calculation
```
Scheduled Job / Trigger → Calculate Velocity → Apply Trends → Update Recommendations Table
```

## API Structure

### Client-Side Services
- `ProductService` - CRUD for products, categories, vendors
- `SalesService` - Import, query, summarize sales
- `InventoryService` - Stock levels, adjustments
- `POService` - Purchase order management
- `RecommendationService` - Read calculated suggestions
- `IntegrationService` - Connect Shopify, ApparelMagic

### Server-Side
- Edge Functions for webhooks (Shopify, etc)
- API routes for heavy calculations
- Background jobs via pg_cron or external scheduler

## Security

### Row Level Security (RLS)
All tables have policies like:
```sql
CREATE POLICY "Workspace data isolation"
ON products FOR ALL
USING (workspace_id IN (
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid()
));
```

### Roles
- **Owner** - Full access, billing, delete workspace
- **Admin** - Manage members, all data access
- **Buyer** - Create POs, view recommendations
- **Viewer** - Read-only access

## Migration Path

### From localStorage to Database
1. Add Supabase client
2. Create database schema
3. Build auth screens (signup/login)
4. Migrate CSV import to use database
5. Build workspace switcher UI
6. Remove localStorage persistence

### Preserving Existing Work
Current CSV parsing and calculations remain unchanged - just swap storage layer.

## Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Stripe (for billing)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=

# Shopify App
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_APP_URL=
```

## Next Steps

1. Set up Supabase project
2. Run schema.sql in Supabase SQL editor
3. Add environment variables
4. Build auth screens (signup/login)
5. Wrap app in AuthProvider + WorkspaceProvider
6. Migrate CSV upload to database
7. Build workspace switcher
8. Deploy

## Shopify App Architecture (Phase 2)

### OAuth Flow
1. Merchant clicks "Install" in Shopify App Store
2. Shopify redirects to your OAuth callback
3. Exchange code for access token
4. Create integration record in database
5. Subscribe to webhooks (orders, inventory)

### Webhook Handling
```
Shopify Order Created → Edge Function → Validate Signature 
→ Insert Sale → Update Recommendations
```

### App Store Requirements
- OAuth implementation
- Billing API integration
- GDPR webhooks
- App review (~2 weeks)

## Cost Estimates (Supabase)

**Free Tier:**
- 500MB database
- 500k requests/month
- 2GB bandwidth
- Perfect for first 10-50 customers

**Pro Tier ($25/mo):**
- 8GB database
- 5M requests/month
- 250GB bandwidth
- Scales to 500+ customers

**Pricing Alignment:**
- Free plan → Your free tier
- Starter ($29/mo) → Pro tier cost covered at 1 customer
- Growth ($99/mo) → Healthy margin
- Enterprise ($299/mo) → Dedicated resources
