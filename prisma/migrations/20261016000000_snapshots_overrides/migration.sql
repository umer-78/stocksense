-- AlterTable
ALTER TABLE "ShopSettings" ADD COLUMN     "safetyStockMethod" TEXT NOT NULL DEFAULT 'percent',
ADD COLUMN     "serviceLevel" DOUBLE PRECISION NOT NULL DEFAULT 0.95;

-- CreateTable
CREATE TABLE "VariantSettings" (
    "shop" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "leadTime" INTEGER,
    "safetyStockPct" DOUBLE PRECISION,
    "targetDays" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VariantSettings_pkey" PRIMARY KEY ("shop","variantId")
);

-- CreateTable
CREATE TABLE "ShopSnapshot" (
    "shop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "stage" TEXT,
    "bulkOperationId" TEXT,
    "pendingVariants" BYTEA,
    "data" BYTEA,
    "lookbackDays" INTEGER NOT NULL DEFAULT 60,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSnapshot_pkey" PRIMARY KEY ("shop")
);

