-- Enable row level security on every StockSense table, with no policies.
-- Supabase's API roles (anon, authenticated) then cannot read or write these
-- tables even if the schema is ever exposed. The app connects as the tables'
-- owner, which RLS does not restrict (FORCE ROW LEVEL SECURITY is not set).
-- Idempotent: enabling RLS on a table that already has it is a no-op.
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StockyImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PrivacyEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VariantSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ShopSnapshot" ENABLE ROW LEVEL SECURITY;
