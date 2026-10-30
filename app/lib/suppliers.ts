/** Supplier records: validation (pure). Persistence lives in `suppliers.server.ts`. */

export interface SupplierInput {
  name: string;
  vendor: string | null;
  email: string | null;
  leadTimeDays: number | null;
  notes: string | null;
}

export interface SupplierRecord extends SupplierInput {
  id: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Validate a supplier form. Returns field errors, or the cleaned values. */
export function sanitizeSupplier(
  input: Record<string, unknown>,
): { ok: true; value: SupplierInput } | { ok: false; errors: Partial<Record<keyof SupplierInput, string>> } {
  const errors: Partial<Record<keyof SupplierInput, string>> = {};
  const name = text(input.name, 120);
  const vendor = text(input.vendor, 255);
  const email = text(input.email, 254);
  const notes = text(input.notes, 1000);
  const leadRaw = text(input.leadTimeDays, 10);

  if (!name) {
    errors.name = "Enter the supplier's name.";
  }
  if (email && !EMAIL.test(email)) {
    errors.email = "Enter an email address like orders@supplier.com.";
  }
  let leadTimeDays: number | null = null;
  if (leadRaw !== "") {
    const days = Number(leadRaw);
    if (!Number.isInteger(days) || days < 0 || days > 365) {
      errors.leadTimeDays = "Lead time must be a whole number of days from 0 to 365.";
    } else {
      leadTimeDays = days;
    }
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { name, vendor: vendor || null, email: email || null, leadTimeDays, notes: notes || null },
  };
}

/** Vendors in the catalog that no supplier covers yet (for quick setup). */
export function uncoveredVendors(catalogVendors: string[], suppliers: Array<{ vendor: string | null }>): string[] {
  const covered = new Set(suppliers.map((s) => (s.vendor ?? "").trim().toLowerCase()).filter(Boolean));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const vendor of catalogVendors) {
    const name = vendor.trim();
    const key = name.toLowerCase();
    if (!name || covered.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(name);
  }
  return out.sort((a, b) => a.localeCompare(b));
}
