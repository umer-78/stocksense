import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useActionData, useLoaderData, useNavigation } from "@remix-run/react";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  DataTable,
  FormLayout,
  InlineStack,
  Layout,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { useEffect, useState } from "react";

import { MissingCredentials } from "../components/MissingCredentials";
import { authenticateAdmin } from "../lib/auth";
import { canUseFeature } from "../lib/billing/plans";
import { currentPlan, isAuthed } from "../lib/context.server";
import { rememberPlan } from "../lib/plan-cache.server";
import { getStoredSnapshot } from "../lib/shopify/snapshot.server";
import { sanitizeSupplier, uncoveredVendors, type SupplierInput, type SupplierRecord } from "../lib/suppliers";
import { createSupplier, deleteSupplier, getSupplier, listSuppliers, updateSupplier } from "../lib/suppliers.server";

interface LoaderData {
  missingCredentials: boolean;
  blocked: boolean;
  suppliers: SupplierRecord[];
  vendors: string[];
  editing: SupplierRecord | null;
}

type FieldErrors = Partial<Record<keyof SupplierInput, string>>;

const EMPTY: LoaderData = {
  missingCredentials: false,
  blocked: false,
  suppliers: [],
  vendors: [],
  editing: null,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json<LoaderData>({ ...EMPTY, missingCredentials: true });
  }
  const shop = auth.session.shop;
  const plan = await currentPlan(auth);
  await rememberPlan(shop, plan);
  if (!canUseFeature(plan, "poBuilder")) {
    return json<LoaderData>({ ...EMPTY, blocked: true });
  }
  const url = new URL(request.url);
  const editId = Number(url.searchParams.get("edit"));
  const [suppliers, snapshot, editing] = await Promise.all([
    listSuppliers(shop),
    getStoredSnapshot(shop),
    Number.isInteger(editId) && editId > 0 ? getSupplier(shop, editId) : Promise.resolve(null),
  ]);
  const catalogVendors = (snapshot?.variants ?? []).map((v) => v.vendor ?? "");
  return json<LoaderData>({
    ...EMPTY,
    suppliers,
    vendors: uncoveredVendors(catalogVendors, suppliers),
    editing,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const auth = await authenticateAdmin(request);
  if (!isAuthed(auth)) {
    return json({ errors: {} as FieldErrors }, { status: 401 });
  }
  const shop = auth.session.shop;
  if (!canUseFeature(await currentPlan(auth), "poBuilder")) {
    return json({ errors: {} as FieldErrors }, { status: 403 });
  }
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const id = Number(form.get("id"));

  if (intent === "delete" && Number.isInteger(id)) {
    await deleteSupplier(shop, id);
    return redirect("/app/suppliers");
  }

  const result = sanitizeSupplier(Object.fromEntries(form));
  if (!result.ok) {
    return json({ errors: result.errors }, { status: 400 });
  }
  if (intent === "update" && Number.isInteger(id)) {
    await updateSupplier(shop, id, result.value);
  } else {
    await createSupplier(shop, result.value);
  }
  return redirect("/app/suppliers");
};

const BLANK = { name: "", vendor: "", email: "", leadTimeDays: "", notes: "" };

export default function Suppliers() {
  const data = useLoaderData<LoaderData>();
  const actionData = useActionData<{ errors: FieldErrors }>();
  const navigation = useNavigation();
  const saving = navigation.state === "submitting";
  const errors = actionData?.errors ?? {};

  const initial = data.editing
    ? {
        name: data.editing.name,
        vendor: data.editing.vendor ?? "",
        email: data.editing.email ?? "",
        leadTimeDays: data.editing.leadTimeDays == null ? "" : String(data.editing.leadTimeDays),
        notes: data.editing.notes ?? "",
      }
    : BLANK;
  const [values, setValues] = useState(initial);
  useEffect(() => setValues(initial), [data.editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (key: keyof typeof BLANK) => (value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  if (data.missingCredentials) {
    return <MissingCredentials />;
  }

  if (data.blocked) {
    return (
      <Page>
        <TitleBar title="Suppliers" />
        <Banner tone="warning" title="Suppliers are a Growth or Pro feature">
          <InlineStack gap="300" blockAlign="center">
            <Text as="p">Upgrade to save suppliers, set lead times per supplier and send purchase orders.</Text>
            <Button url="/app/billing" variant="primary">
              See plans
            </Button>
          </InlineStack>
        </Banner>
      </Page>
    );
  }

  return (
    <Page>
      <TitleBar title="Suppliers" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="400">
            <Card padding="0">
              <Box padding="400">
                <BlockStack gap="100">
                  <Text as="h2" variant="headingMd">
                    Your suppliers
                  </Text>
                  <Text as="p" tone="subdued">
                    Products whose Shopify vendor matches a supplier use that supplier&apos;s lead time, unless the product has its own.
                  </Text>
                </BlockStack>
              </Box>
              {data.suppliers.length === 0 ? (
                <Box padding="400" paddingBlockStart="0">
                  <Text as="p">No suppliers yet. Add your first one with the form.</Text>
                </Box>
              ) : (
                <DataTable
                  columnContentTypes={["text", "text", "text", "numeric", "text"]}
                  headings={["Supplier", "Shopify vendor", "Email", "Lead time", ""]}
                  rows={data.suppliers.map((s) => [
                    s.name,
                    s.vendor ?? "—",
                    s.email ?? "—",
                    s.leadTimeDays == null ? "Shop default" : `${s.leadTimeDays} days`,
                    <ButtonGroup key={`actions-${s.id}`}>
                      <Button size="slim" url={`/app/suppliers?edit=${s.id}`}>
                        Edit
                      </Button>
                      <Form method="post">
                        <input type="hidden" name="intent" value="delete" />
                        <input type="hidden" name="id" value={s.id} />
                        <Button size="slim" submit tone="critical" variant="plain">
                          Delete
                        </Button>
                      </Form>
                    </ButtonGroup>,
                  ])}
                />
              )}
            </Card>

            {data.vendors.length > 0 && (
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">
                    Vendors in your catalog without a supplier
                  </Text>
                  <InlineStack gap="200" wrap>
                    {data.vendors.slice(0, 30).map((vendor) => (
                      <Button key={vendor} size="slim" onClick={() => setValues({ ...BLANK, name: vendor, vendor })}>
                        {`Add ${vendor}`}
                      </Button>
                    ))}
                  </InlineStack>
                </BlockStack>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <Form method="post">
              <input type="hidden" name="intent" value={data.editing ? "update" : "create"} />
              {data.editing && <input type="hidden" name="id" value={data.editing.id} />}
              <FormLayout>
                <Text as="h2" variant="headingMd">
                  {data.editing ? `Edit ${data.editing.name}` : "Add a supplier"}
                </Text>
                <TextField label="Name" name="name" value={values.name} onChange={set("name")} error={errors.name} autoComplete="organization" />
                <TextField
                  label="Shopify vendor"
                  name="vendor"
                  value={values.vendor}
                  onChange={set("vendor")}
                  helpText="Exactly as it appears in the product's Vendor field. Leave blank if the supplier covers no vendor."
                  autoComplete="off"
                />
                <TextField label="Email for orders" name="email" type="email" value={values.email} onChange={set("email")} error={errors.email} autoComplete="email" />
                <TextField
                  label="Lead time (days)"
                  name="leadTimeDays"
                  type="number"
                  min={0}
                  max={365}
                  value={values.leadTimeDays}
                  onChange={set("leadTimeDays")}
                  error={errors.leadTimeDays}
                  helpText="Days from placing an order to having the stock. Blank uses the shop default."
                  autoComplete="off"
                />
                <TextField label="Notes" name="notes" value={values.notes} onChange={set("notes")} multiline={3} autoComplete="off" />
                <InlineStack gap="200">
                  <Button submit variant="primary" loading={saving}>
                    {data.editing ? "Save supplier" : "Add supplier"}
                  </Button>
                  {data.editing && <Button url="/app/suppliers">Cancel</Button>}
                </InlineStack>
              </FormLayout>
            </Form>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
