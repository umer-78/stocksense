-- CreateTable
CREATE TABLE "Supplier" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "email" TEXT,
    "leadTimeDays" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "supplierId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" SERIAL NOT NULL,
    "poId" INTEGER NOT NULL,
    "variantId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "receivedQty" INTEGER NOT NULL DEFAULT 0,
    "unitCost" DOUBLE PRECISION,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAlert" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "variantTitle" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "available" INTEGER NOT NULL,
    "daysToStockout" DOUBLE PRECISION,
    "suggestedOrderQty" INTEGER NOT NULL,
    "flowSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopPlan" (
    "shop" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopPlan_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "shop" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "hint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("shop")
);

-- CreateIndex
CREATE INDEX "Supplier_shop_idx" ON "Supplier"("shop");

-- CreateIndex
CREATE INDEX "PurchaseOrder_shop_status_idx" ON "PurchaseOrder"("shop", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_shop_number_key" ON "PurchaseOrder"("shop", "number");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_poId_idx" ON "PurchaseOrderLine"("poId");

-- CreateIndex
CREATE INDEX "StockAlert_shop_variantId_createdAt_idx" ON "StockAlert"("shop", "variantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_poId_fkey" FOREIGN KEY ("poId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Same as the other tables: only the app server (table owner) can read or write these.
ALTER TABLE "Supplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PurchaseOrderLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockAlert" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
