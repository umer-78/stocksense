/**
 * Small, cheap Admin API reads. The catalog and order history are far too
 * large for regular queries; they come from bulk operations (`bulk.ts`,
 * `snapshot.server.ts`).
 */
import type { GraphqlClient } from "./bulk";
import { LOCATIONS_QUERY } from "./queries";
import type { LocationInfo } from "./types";

export async function fetchLocations(admin: GraphqlClient): Promise<LocationInfo[]> {
  const response = await admin.graphql(LOCATIONS_QUERY, { tries: 3 });
  const json = (await response.json()) as {
    data?: { locations?: { edges: Array<{ node: { id: string; name: string } }> } };
  };
  return (json.data?.locations?.edges ?? []).map((e) => e.node);
}
