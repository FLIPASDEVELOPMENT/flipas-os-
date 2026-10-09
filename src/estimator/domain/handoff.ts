export function handoffDiagnostic(e: {
  status: string;
  customerId: string;
  opportunityId: string | null;
  opportunity: { id: string; stage: string; customerId: string } | null;
}) {
  if (e.status !== "ACCEPTED")
    return {
      code: "ESTIMATE_NOT_ACCEPTED",
      message:
        "This exact estimate revision must be ACCEPTED before project creation.",
    };
  if (!e.opportunityId)
    return {
      code: "NO_OPPORTUNITY_LINK",
      message:
        "This accepted revision has no opportunity linked. A WON card with the same customer name does not establish a link.",
    };
  if (!e.opportunity || e.opportunity.id !== e.opportunityId)
    return {
      code: "OPPORTUNITY_UNAVAILABLE",
      message:
        "The linked opportunity is unavailable. Review its internal identifier.",
    };
  if (e.opportunity.customerId !== e.customerId)
    return {
      code: "CUSTOMER_ID_MISMATCH",
      message:
        "The estimate and linked opportunity have different customer IDs. Do not merge them by name.",
    };
  if (e.opportunity.stage !== "WON")
    return {
      code: "LINKED_OPPORTUNITY_NOT_WON",
      message: `The linked opportunity is ${e.opportunity.stage}, not WON. Review the specific linked record.`,
    };
  return {
    code: "READY",
    message:
      "Accepted revision and matching WON opportunity are linked correctly.",
  };
}
