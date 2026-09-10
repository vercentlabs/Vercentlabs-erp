import { evaluateLeadDuplicateRisk } from "./lead-duplicates.js";



export async function findCrmDuplicates(
  client,
  context,
  input,
  excludeId = null,
) {
  const evaluation = await evaluateLeadDuplicateRisk(client, context, input, {
    excludeLeadId: excludeId,
    lock: false,
  });
  // Compatibility shape for existing server-rendered Lead Detail callers.
  // Restricted matches deliberately contain no record identifier or PII.
  return evaluation.matches.map((match) =>
    match.restricted
      ? match
      : {
          ...match,
          fullName: match.name,
          companyName: match.company,
          status: match.lifecycleStage,
          matchScore: match.classification === "exact" ? 100 : 60,
        },
  );
}
