/**
 * Fixture data for the Shopify adapter tests — mirrors the raw GraphQL
 * response shapes from `app/lib/shopify/types.ts`.
 */
import type { RawOrdersResponse, RawVariantsResponse } from "./types";

export const variantsFixture: RawVariantsResponse = {
  productVariants: {
    pageInfo: { hasNextPage: false, endCursor: null },
    edges: [
      {
        node: {
          id: "gid://shopify/ProductVariant/1001",
          title: "Large",
          sku: "SKU-001",
          price: "19.99",
          product: { id: "gid://shopify/Product/9001", title: "T-Shirt", status: "ACTIVE" },
          inventoryItem: {
            id: "gid://shopify/InventoryItem/8001",
            unitCost: { amount: "8.50", currencyCode: "USD" },
            inventoryLevels: {
              edges: [
                {
                  node: {
                    id: "gid://shopify/InventoryLevel/7001",
                    quantities: [
                      { name: "available", quantity: 20 },
                      { name: "committed", quantity: 5 },
                      { name: "incoming", quantity: 10 },
                      { name: "on_hand", quantity: 25 },
                    ],
                    location: { id: "gid://shopify/Location/6001", name: "Main Warehouse" },
                  },
                },
                {
                  node: {
                    id: "gid://shopify/InventoryLevel/7002",
                    quantities: [
                      { name: "available", quantity: 3 },
                      { name: "committed", quantity: 1 },
                      { name: "incoming", quantity: 0 },
                      { name: "on_hand", quantity: 4 },
                    ],
                    location: { id: "gid://shopify/Location/6002", name: "Retail Store" },
                  },
                },
              ],
            },
          },
        },
      },
      {
        node: {
          id: "gid://shopify/ProductVariant/1002",
          title: "Default Title",
          sku: null,
          price: null,
          product: { id: "gid://shopify/Product/9002", title: "Mug", status: "ACTIVE" },
          inventoryItem: {
            id: "gid://shopify/InventoryItem/8002",
            unitCost: null,
            inventoryLevels: { edges: [] },
          },
        },
      },
      {
        node: {
          id: "gid://shopify/ProductVariant/1003",
          title: "Small",
          sku: "SKU-003",
          price: "5.00",
          product: null,
          inventoryItem: null,
        },
      },
    ],
  },
};

export const ordersFixture: RawOrdersResponse = {
  orders: {
    pageInfo: { hasNextPage: false, endCursor: null },
    edges: [
      {
        node: {
          id: "gid://shopify/Order/5001",
          createdAt: "2025-01-05T14:30:00Z",
          lineItems: {
            edges: [
              { node: { id: "gid://shopify/LineItem/4001", quantity: 2, variant: { id: "gid://shopify/ProductVariant/1001" } } },
              { node: { id: "gid://shopify/LineItem/4002", quantity: 1, variant: { id: "gid://shopify/ProductVariant/1002" } } },
              // Custom line item without a variant — must be skipped.
              { node: { id: "gid://shopify/LineItem/4003", quantity: 5, variant: null } },
            ],
          },
        },
      },
      {
        node: {
          id: "gid://shopify/Order/5002",
          createdAt: "2025-01-06T09:00:00Z",
          lineItems: {
            edges: [
              { node: { id: "gid://shopify/LineItem/4004", quantity: 3, variant: { id: "gid://shopify/ProductVariant/1001" } } },
            ],
          },
        },
      },
    ],
  },
};