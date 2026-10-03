-- Postgres baseline (replaces the earlier SQLite migrations).
-- Tables are created in the schema named by ?schema= in DATABASE_URL.

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL,
    "defaultLeadTime" INTEGER NOT NULL DEFAULT 14,
    "safetyStockPct" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "targetDays" INTEGER NOT NULL DEFAULT 30,
    "lookbackDays" INTEGER NOT NULL DEFAULT 60,
    "locationId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopSettings_pkey" PRIMARY KEY ("shop")
);

-- CreateTable
CREATE TABLE "StockyImport" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockyImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivacyEvent" (
    "id" SERIAL NOT NULL,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrivacyEvent_pkey" PRIMARY KEY ("id")
);
