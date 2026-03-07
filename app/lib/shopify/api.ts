// lib/shopify/api.ts - Shopify Admin API client

export class ShopifyAPI {
  private shop: string;
  private accessToken: string;

  constructor(shop: string, accessToken: string) {
    this.shop = shop;
    this.accessToken = accessToken;
  }

  private async request(query: string, variables?: Record<string, unknown>) {
    const url = `https://${this.shop}/admin/api/2024-01/graphql.json`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': this.accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      throw new Error(`Shopify API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.errors) {
      throw new Error(data.errors[0].message);
    }

    return data.data;
  }

  /**
   * Fetch all products with variants
   */
  async getProducts(cursor?: string) {
    const query = `
      query GetProducts($cursor: String) {
        products(first: 100, after: $cursor) {
          edges {
            node {
              id
              title
              productType
              vendor
              tags
              variants(first: 100) {
                edges {
                  node {
                    id
                    title
                    sku
                    price
                    inventoryQuantity
                    inventoryItem {
                      id
                      cost {
                        amount
                      }
                    }
                  }
                }
              }
            }
            cursor
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `;

    return this.request(query, { cursor });
  }

  /**
   * Fetch recent orders
   */
  async getOrders(since: string, cursor?: string) {
    const query = `
      query GetOrders($since: String, $cursor: String) {
        orders(
          first: 100, 
          after: $cursor,
          query: "created_at:>$since"
        ) {
          edges {
            node {
              id
              name
              createdAt
              lineItems(first: 100) {
                edges {
                  node {
                    title
                    quantity
                    variant {
                      id
                      sku
                      price
                    }
                  }
                }
              }
            }
            cursor
          }
          pageInfo {
            hasNextPage
          }
        }
      }
    `;

    return this.request(query, { since, cursor });
  }

  /**
   * Fetch inventory levels for specific items
   */
  async getInventoryLevels(inventoryItemIds: string[]) {
    const query = `
      query GetInventory($ids: [ID!]!) {
        inventoryItems(first: 100, ids: $ids) {
          edges {
            node {
              id
              variant {
                id
                sku
              }
              inventoryLevel {
                available
                incoming
              }
            }
          }
        }
      }
    `;

    return this.request(query, { ids: inventoryItemIds });
  }

  /**
   * Get shop info
   */
  async getShopInfo() {
    const query = `
      query {
        shop {
          id
          name
          email
          currencyCode
          timezone
        }
      }
    `;

    return this.request(query);
  }

  /**
   * Subscribe to webhooks
   */
  async subscribeWebhook(topic: string, address: string) {
    const query = `
      mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $address: URL!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: {callbackUrl: $address}) {
          userErrors {
            field
            message
          }
          webhookSubscription {
            id
          }
        }
      }
    `;

    return this.request(query, { topic, address });
  }
}
