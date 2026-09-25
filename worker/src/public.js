// Public payload served by the Worker, built field by field from the fetched
// aggregates so that nothing else can leak into the response.

import { SCHEMA_VERSION } from "./github.js";
import { calculateRank } from "./rank.js";

export function publicData(activity) {
  const { contributions: c, activity: a } = activity;
  const rank = calculateRank(activity.rankInputs);
  return {
    schema: SCHEMA_VERSION,
    generatedAt: activity.generatedAt,
    contributions: {
      lastYear: c.lastYear,
      days: c.days,
    },
    activity: {
      commits: a.commits,
      pullRequests: a.pullRequests,
      mergedRate: a.mergedRate,
      reviews: a.reviews,
      repositories: a.repositories,
      organizations: a.organizations,
    },
    rank: { level: rank.level, percentile: Math.round(rank.percentile * 100) / 100 },
  };
}
