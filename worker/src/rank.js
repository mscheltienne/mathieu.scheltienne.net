// Rank formula of github-readme-stats / github-stats-extended (calculateRank),
// with all-time commits. Shared by the website and the Cloudflare Worker.

const exponentialCdf = (x) => 1 - 2 ** -x;
const logNormalCdf = (x) => x / (1 + x);

const THRESHOLDS = [1, 12.5, 25, 37.5, 50, 62.5, 75, 87.5, 100];
const LEVELS = ["S", "A+", "A", "A-", "B+", "B", "B-", "C+", "C"];

export function calculateRank({ commits, prs, issues, reviews, stars, followers }) {
  const terms = [
    [2, exponentialCdf(commits / 1000)],
    [3, exponentialCdf(prs / 50)],
    [1, exponentialCdf(issues / 25)],
    [1, exponentialCdf(reviews / 2)],
    [4, logNormalCdf(stars / 50)],
    [1, logNormalCdf(followers / 10)],
  ];
  const totalWeight = terms.reduce((sum, [weight]) => sum + weight, 0);
  const score = terms.reduce((sum, [weight, value]) => sum + weight * value, 0) / totalWeight;
  const percentile = 100 * (1 - score);
  return { level: LEVELS[THRESHOLDS.findIndex((t) => percentile <= t)], percentile };
}
