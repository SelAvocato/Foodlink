import { parseDonationParam } from "./assignments-logic";
import { AssignmentsView } from "./assignments-view";

/** Figma p33: the assign-volunteer screen; the list and detail load in the client. */
export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { donation } = await searchParams;
  const route = parseDonationParam(donation);
  // Keyed by target so list, detail and not-found never inherit each other's state.
  const key = route.kind === "detail" ? route.donationId : route.kind;
  return <AssignmentsView key={key} route={route} />;
}
