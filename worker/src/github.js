// Fetch GitHub activity for one user and reduce it to public-safe aggregates.
//
// Uses the GitHub GraphQL API with a token that can see the user's private
// repositories, so the totals include private contributions. The returned
// object is built field by field and only ever contains numbers and dates: no
// repository, organization or pull request names leave this module.

const GRAPHQL_URL = "https://api.github.com/graphql";
const USER_AGENT = "github-stats-worker (+https://mathieu.scheltienne.net)";
const LEVELS = { NONE: 0, FIRST_QUARTILE: 1, SECOND_QUARTILE: 2, THIRD_QUARTILE: 3, FOURTH_QUARTILE: 4 };

export const SCHEMA_VERSION = 1;

async function graphql(token, query, variables) {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL: HTTP ${response.status}`);
  const json = await response.json();
  if (json.errors?.length) {
    throw new Error(`GitHub GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json.data;
}

const PROFILE_QUERY = (repos) => `
query ($login: String!, $prs: String!, $merged: String!) {
  user(login: $login) {
    followers { totalCount }
    contributionsCollection {
      contributionYears
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
  prs: search(type: ISSUE, query: $prs, first: 1) { issueCount }
  merged: search(type: ISSUE, query: $merged, first: 1) { issueCount }
  ${repos.map(([owner, name], i) => `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { stargazerCount }`).join("\n  ")}
}`;

// Per-repository contribution lists. The API caps each list at 100
// repositories per window, without pagination: a full list may be truncated,
// so its window is queried again in halves (see collectRepositories).
const MAX_REPOSITORIES = 100;
const BY_REPOSITORY = [
  "commitContributionsByRepository",
  "issueContributionsByRepository",
  "pullRequestContributionsByRepository",
  "pullRequestReviewContributionsByRepository",
];
const byRepositoryFields = (max) =>
  BY_REPOSITORY.map(
    (field) => `${field}(maxRepositories: ${max}) { repository { id owner { __typename login } } }`,
  ).join("\n  ");

const YEARS_QUERY = (windows, max) => `
query ($login: String!) {
  user(login: $login) {
    ${windows.map(({ year, from, to }) => `y${year}: contributionsCollection(from: "${from}", to: "${to}") { ...Year }`).join("\n    ")}
  }
}
fragment Year on ContributionsCollection {
  totalIssueContributions
  totalPullRequestContributions
  totalPullRequestReviewContributions
  ${byRepositoryFields(max)}
}`;

const REPOSITORIES_QUERY = (windows, max) => `
query ($login: String!) {
  user(login: $login) {
    ${windows.map(({ from, to }, i) => `w${i}: contributionsCollection(from: "${from}", to: "${to}") { ...Repositories }`).join("\n    ")}
  }
}
fragment Repositories on ContributionsCollection {
  ${byRepositoryFields(max)}
}`;

// Smallest window that is still split (the API accepts timestamps).
const MIN_WINDOW = 3600 * 1000;
// Windows per query; halved on the fly if GitHub rejects a query for its
// resource limits (each contributions collection is costly to compute).
const WINDOWS_PER_QUERY = 10;
// Upper bound on the extra queries: with the 3 base requests, stays below the
// Worker limit of 50 subrequests per invocation (free plan).
const MAX_SPLIT_QUERIES = 30;

// Distinct repositories and organizations over all windows. `collections` are
// the already fetched yearly collections (no extra query in the common case);
// any window with a full, possibly truncated, list is split in two halves and
// queried again until every list is complete. Overlapping halves are harmless:
// repositories are deduplicated by id.
async function collectRepositories(token, username, windows, collections, max, maxQueries) {
  const repositories = new Set();
  const organizations = new Set();
  const toSplit = [];
  let unsplittable = 0;
  const add = (window, collection) => {
    let full = false;
    for (const field of BY_REPOSITORY) {
      const list = collection[field];
      if (list.length >= max) full = true;
      for (const { repository } of list) {
        repositories.add(repository.id);
        if (repository.owner.__typename === "Organization") organizations.add(repository.owner.login.toLowerCase());
      }
    }
    const from = Date.parse(window.from);
    const to = Date.parse(window.to);
    if (full && to - from > MIN_WINDOW) {
      const middle = new Date(from + (to - from) / 2).toISOString();
      toSplit.push({ from: window.from, to: middle }, { from: middle, to: window.to });
    } else if (full) {
      unsplittable += 1;
    }
  };
  for (const [i, window] of windows.entries()) add(window, collections[i]);

  let queries = 0;
  let batchSize = WINDOWS_PER_QUERY;
  while (toSplit.length) {
    if (queries >= maxQueries) {
      console.warn(`repository counts may be incomplete: ${toSplit.length} windows left unsplit`);
      break;
    }
    const batch = toSplit.slice(0, batchSize);
    let data;
    queries += 1;
    try {
      data = await graphql(token, REPOSITORIES_QUERY(batch, max), { login: username });
    } catch (error) {
      if (batchSize > 1 && /resource limits/i.test(error.message)) {
        batchSize = Math.ceil(batchSize / 2);
        continue;
      }
      throw error;
    }
    toSplit.splice(0, batch.length);
    for (const [i, window] of batch.entries()) add(window, data.user[`w${i}`]);
  }
  if (unsplittable) {
    console.warn(`repository counts may be incomplete: ${unsplittable} windows full at the minimum window size`);
  }
  return { repositories: repositories.size, organizations: organizations.size, splitQueries: queries, unsplittable };
}

// One window per calendar year with contributions (the API spans at most one
// year per query); the current year ends now.
function yearWindows(years, now) {
  return [...years].sort().map((year) => {
    const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59));
    return { year, from: `${year}-01-01T00:00:00Z`, to: (end < now ? end : now).toISOString() };
  });
}

const sum = (values) => values.reduce((total, value) => total + value, 0);

// Commits authored by the user on the default branch of every repository the
// token can see (commit search only indexes default branches). Verified to
// match the default-branch commit history exactly; GitHub's "commit
// contributions" follow different rules and are not a commit count.
async function searchCommitCount(token, username) {
  const url = `https://api.github.com/search/commits?per_page=1&q=${encodeURIComponent(`author:${username}`)}`;
  const response = await fetch(url, {
    headers: { Authorization: `bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": USER_AGENT },
  });
  if (!response.ok) throw new Error(`GitHub commit search: HTTP ${response.status}`);
  return (await response.json()).total_count;
}

/**
 * @param {object} options
 * @param {string} options.token GitHub token (classic, `repo` + `read:user`).
 * @param {string} options.username GitHub login.
 * @param {string[]} options.maintainedRepos "owner/name" of maintained projects (stars count in the rank).
 * @param {Date} [options.now]
 * @param {number} [options.maxRepositories] Per-list cap (API maximum); lower
 *   only to test the window splitting.
 * @param {number} [options.maxSplitQueries] Budget of extra queries; raise only
 *   for tests, outside the Worker.
 */
export async function fetchActivity({
  token,
  username,
  maintainedRepos,
  now = new Date(),
  maxRepositories = MAX_REPOSITORIES,
  maxSplitQueries = MAX_SPLIT_QUERIES,
}) {
  const repos = maintainedRepos.map((full) => full.split("/"));
  const profile = await graphql(token, PROFILE_QUERY(repos), {
    login: username,
    prs: `is:pr author:${username}`,
    merged: `is:pr is:merged author:${username}`,
  });
  if (!profile.user) throw new Error("GitHub GraphQL: user not found");
  const collection = profile.user.contributionsCollection;

  const windows = yearWindows(collection.contributionYears, now);
  const [yearly, commits] = await Promise.all([
    graphql(token, YEARS_QUERY(windows, maxRepositories), { login: username }),
    searchCommitCount(token, username),
  ]);
  const perYear = windows.map(({ year }) => yearly.user[`y${year}`]);
  const reach = await collectRepositories(token, username, windows, perYear, maxRepositories, maxSplitQueries);

  // Pull request, review and issue contribution counts (pull requests verified
  // to match the pull request search). The merged rate comes from search, as
  // contributions do not track merges.
  const pullRequests = sum(perYear.map((y) => y.totalPullRequestContributions));
  const issues = sum(perYear.map((y) => y.totalIssueContributions));
  const reviews = sum(perYear.map((y) => y.totalPullRequestReviewContributions));
  const mergedRate = profile.prs.issueCount ? profile.merged.issueCount / profile.prs.issueCount : 0;
  const stars = sum(repos.map((_, i) => profile[`r${i}`]?.stargazerCount ?? 0));
  const followers = profile.user.followers.totalCount;

  return {
    schema: SCHEMA_VERSION,
    generatedAt: now.toISOString(),
    // Rolling year, same window as the GitHub profile heatmap.
    contributions: {
      lastYear: collection.contributionCalendar.totalContributions,
      days: collection.contributionCalendar.weeks
        .flatMap((week) => week.contributionDays)
        .map((d) => [d.date, d.contributionCount, LEVELS[d.contributionLevel] ?? 0]),
    },
    activity: {
      commits,
      pullRequests,
      mergedRate: Math.round(mergedRate * 1000) / 1000,
      reviews,
      repositories: reach.repositories,
      organizations: reach.organizations,
    },
    rankInputs: { commits, prs: pullRequests, issues, reviews, stars, followers },
    // Internal (not published): extra queries used to complete truncated lists.
    splitQueries: reach.splitQueries,
  };
}
