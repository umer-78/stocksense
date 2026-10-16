import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "@remix-run/node";

import { action as dataRequestAction } from "../routes/webhooks.customers.data_request";
import { action as shopRedactAction } from "../routes/webhooks.shop.redact";
import { action as uninstalledAction } from "../routes/webhooks.app.uninstalled";

const mocks = vi.hoisted(() => ({
  authenticateWebhook: vi.fn(),
  privacyEventCreate: vi.fn(),
  transaction: vi.fn(),
  shopSettingsDeleteMany: vi.fn(),
  stockyImportDeleteMany: vi.fn(),
  privacyEventDeleteMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
  variantSettingsDeleteMany: vi.fn(),
  shopSnapshotDeleteMany: vi.fn(),
  webhook: vi.fn(),
}));

vi.mock("../shopify.server", () => ({
  authenticate: { webhook: mocks.webhook },
}));

vi.mock("../lib/auth", () => ({
  authenticateWebhook: mocks.authenticateWebhook,
}));

vi.mock("../db.server", () => ({
  default: {
    privacyEvent: {
      create: mocks.privacyEventCreate,
      deleteMany: mocks.privacyEventDeleteMany,
    },
    $transaction: mocks.transaction,
    shopSettings: { deleteMany: mocks.shopSettingsDeleteMany },
    stockyImport: { deleteMany: mocks.stockyImportDeleteMany },
    session: { deleteMany: mocks.sessionDeleteMany },
    variantSettings: { deleteMany: mocks.variantSettingsDeleteMany },
    shopSnapshot: { deleteMany: mocks.shopSnapshotDeleteMany },
  },
}));

const SHOP = "test-shop.myshopify.com";

function args(request: Request): ActionFunctionArgs {
  return { request, context: {}, params: {} };
}

describe("webhooks.customers.data_request", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the customer/orders payload at the ROOT of the response body with 200", async () => {
    mocks.authenticateWebhook.mockResolvedValue({
      missingCredentials: false,
      payload: {
        shop_id: 954889,
        shop_domain: SHOP,
        orders_requested: [299938, 280263, 220458],
        customer: { id: 191167, email: "john@example.com", phone: "555-625-1199" },
        data_request: { id: 9999 },
      },
      shop: SHOP,
      topic: "customers/data_request",
    });
    mocks.privacyEventCreate.mockResolvedValue({ id: 1 });

    const response = await dataRequestAction(
      args(new Request(`https://example.com/webhooks/customers/data_request`, { method: "POST" })),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      customer: Record<string, unknown> | null;
      orders: unknown[];
      data?: unknown;
    };
    // Root-level shape: no `data` wrapper.
    expect(body).toEqual({
      customer: { id: 191167, email: "john@example.com", phone: "555-625-1199" },
      orders: [],
    });
    expect(body.data).toBeUndefined();
  });

  it("keeps the identifying customer fields (id/email) and an orders array", async () => {
    mocks.authenticateWebhook.mockResolvedValue({
      missingCredentials: false,
      payload: {
        shop_id: 954889,
        shop_domain: SHOP,
        orders_requested: [299938],
        customer: { id: 191167, email: "john@example.com" },
        data_request: { id: 9999 },
      },
      shop: SHOP,
      topic: "customers/data_request",
    });
    mocks.privacyEventCreate.mockResolvedValue({ id: 1 });

    const response = await dataRequestAction(
      args(new Request(`https://example.com/webhooks/customers/data_request`, { method: "POST" })),
    );
    const body = (await response.json()) as {
      customer: Record<string, unknown> | null;
      orders: unknown[];
    };

    expect(body.customer?.id).toBe(191167);
    expect(body.customer?.email).toBe("john@example.com");
    expect(Array.isArray(body.orders)).toBe(true);
    expect(body.orders).toHaveLength(0);
  });

  it("logs the request as a privacy event", async () => {
    mocks.authenticateWebhook.mockResolvedValue({
      missingCredentials: false,
      payload: { customer: { id: 1, email: "a@b.com" } },
      shop: SHOP,
      topic: "customers/data_request",
    });
    mocks.privacyEventCreate.mockResolvedValue({ id: 1 });

    await dataRequestAction(
      args(new Request(`https://example.com/webhooks/customers/data_request`, { method: "POST" })),
    );

    expect(mocks.privacyEventCreate).toHaveBeenCalledWith({
      data: {
        shop: SHOP,
        topic: "customers/data_request",
        payload: JSON.stringify({ customer: { id: 1, email: "a@b.com" } }),
      },
    });
  });

  it("still returns the root shape when credentials are missing", async () => {
    mocks.authenticateWebhook.mockResolvedValue({
      missingCredentials: true,
      payload: null,
      shop: "",
      topic: "",
    });

    const response = await dataRequestAction(
      args(new Request(`https://example.com/webhooks/customers/data_request`, { method: "POST" })),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { customer: unknown; orders: unknown[]; data?: unknown };
    expect(body).toEqual({ customer: null, orders: [] });
    expect(body.data).toBeUndefined();
  });
});

describe("webhooks.shop.redact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shopSettingsDeleteMany.mockReturnValue("shopSettings-delete");
    mocks.stockyImportDeleteMany.mockReturnValue("stockyImport-delete");
    mocks.privacyEventDeleteMany.mockReturnValue("privacyEvent-delete");
    mocks.sessionDeleteMany.mockReturnValue("session-delete");
    mocks.variantSettingsDeleteMany.mockReturnValue("variantSettings-delete");
    mocks.shopSnapshotDeleteMany.mockReturnValue("shopSnapshot-delete");
  });

  it("deletes every per-shop table in one transaction", async () => {
    mocks.authenticateWebhook.mockResolvedValue({
      missingCredentials: false,
      payload: { shop_id: 954889, shop_domain: SHOP },
      shop: SHOP,
      topic: "shop/redact",
    });
    mocks.privacyEventCreate.mockResolvedValue({ id: 1 });
    mocks.transaction.mockResolvedValue([{ count: 1 }, { count: 1 }, { count: 1 }, { count: 1 }]);

    const response = await shopRedactAction(
      args(new Request(`https://example.com/webhooks/shop/redact`, { method: "POST" })),
    );

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledWith([
      "shopSettings-delete",
      "variantSettings-delete",
      "shopSnapshot-delete",
      "stockyImport-delete",
      "privacyEvent-delete",
      "session-delete",
    ]);
    expect(mocks.variantSettingsDeleteMany).toHaveBeenCalledWith({ where: { shop: SHOP } });
    expect(mocks.shopSnapshotDeleteMany).toHaveBeenCalledWith({ where: { shop: SHOP } });
    expect(mocks.shopSettingsDeleteMany).toHaveBeenCalledWith({ where: { shop: SHOP } });
    expect(mocks.stockyImportDeleteMany).toHaveBeenCalledWith({ where: { shop: SHOP } });
    expect(mocks.privacyEventDeleteMany).toHaveBeenCalledWith({ where: { shop: SHOP } });
    expect(mocks.sessionDeleteMany).toHaveBeenCalledWith({ where: { shop: SHOP } });
  });

  it("acknowledges with 200 when credentials are missing", async () => {
    mocks.authenticateWebhook.mockResolvedValue({
      missingCredentials: true,
      payload: null,
      shop: "",
      topic: "",
    });

    const response = await shopRedactAction(
      args(new Request(`https://example.com/webhooks/shop/redact`, { method: "POST" })),
    );

    expect(response.status).toBe(200);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
describe("webhooks.app.uninstalled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shopSettingsDeleteMany.mockReturnValue("shopSettings-delete");
    mocks.stockyImportDeleteMany.mockReturnValue("stockyImport-delete");
    mocks.privacyEventDeleteMany.mockReturnValue("privacyEvent-delete");
    mocks.sessionDeleteMany.mockReturnValue("session-delete");
    mocks.variantSettingsDeleteMany.mockReturnValue("variantSettings-delete");
    mocks.shopSnapshotDeleteMany.mockReturnValue("shopSnapshot-delete");
    mocks.transaction.mockResolvedValue([]);
  });

  it("deletes the shop's settings, overrides, snapshot, imports and sessions, keeping the privacy log", async () => {
    mocks.webhook.mockResolvedValue({ shop: SHOP, topic: "APP_UNINSTALLED", session: null });

    const response = await uninstalledAction(
      args(new Request(`https://example.com/webhooks/app/uninstalled`, { method: "POST" })),
    );

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledWith([
      "shopSettings-delete",
      "variantSettings-delete",
      "shopSnapshot-delete",
      "stockyImport-delete",
      "session-delete",
    ]);
    expect(mocks.privacyEventDeleteMany).not.toHaveBeenCalled();
  });
});
