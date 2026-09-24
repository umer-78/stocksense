import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionFunctionArgs } from "@remix-run/node";

import { action } from "../routes/app.import";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  stockyImportCreate: vi.fn(),
}));

vi.mock("../lib/auth", () => ({
  authenticateAdmin: mocks.authenticateAdmin,
}));

vi.mock("../db.server", () => ({
  default: {
    stockyImport: { create: mocks.stockyImportCreate },
  },
}));

const SHOP = "test-shop.myshopify.com";

function args(request: Request): ActionFunctionArgs {
  return { request, context: {}, params: {} };
}

function postForm(formData: FormData): Request {
  return new Request("https://example.com/app/import", {
    method: "POST",
    body: formData,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticateAdmin.mockResolvedValue({
    missingCredentials: false,
    admin: null,
    session: { shop: SHOP },
    billing: null,
  });
  mocks.stockyImportCreate.mockResolvedValue({ id: 1 });
});

describe("app.import action limits", () => {
  it("rejects payloads larger than 5 MB with a friendly error", async () => {
    const form = new FormData();
    form.set("fileName", "huge.csv");
    // Oversized payload is rejected before JSON parsing, so it need not be valid JSON.
    form.set("rows", "x".repeat(5 * 1024 * 1024 + 1));

    const response = await action(args(postForm(form)));

    expect(response.status).toBe(413);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain("5 MB");
    expect(mocks.stockyImportCreate).not.toHaveBeenCalled();
  });

  it("rejects imports with more than 50,000 rows", async () => {
    const rows = JSON.stringify(
      Array.from({ length: 50_001 }, (_, i) => ({ sku: `SKU-${i}` })),
    );
    const form = new FormData();
    form.set("fileName", "big.csv");
    form.set("rows", rows);

    const response = await action(args(postForm(form)));

    expect(response.status).toBe(413);
    const body = (await response.json()) as { error?: string };
    expect(body.error).toContain("50,000");
    expect(mocks.stockyImportCreate).not.toHaveBeenCalled();
  });

  it("accepts a payload within the limits", async () => {
    const rows = JSON.stringify([{ sku: "A" }, { sku: "B" }]);
    const form = new FormData();
    form.set("fileName", "ok.csv");
    form.set("rows", rows);

    const response = await action(args(postForm(form)));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ saved: true, rowCount: 2 });
    expect(mocks.stockyImportCreate).toHaveBeenCalledWith({
      data: { shop: SHOP, fileName: "ok.csv", rowCount: 2, data: rows },
    });
  });

  it("rejects a non-array rows payload", async () => {
    const form = new FormData();
    form.set("fileName", "bad.csv");
    form.set("rows", JSON.stringify({ not: "an array" }));

    const response = await action(args(postForm(form)));

    expect(response.status).toBe(400);
    expect(mocks.stockyImportCreate).not.toHaveBeenCalled();
  });
});