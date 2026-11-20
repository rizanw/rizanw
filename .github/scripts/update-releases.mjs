// Rewrites the block between the recent_releases markers in README.md with the
// latest release of each public, non-fork, non-archived repo, newest first.
import { readFile, writeFile } from "node:fs/promises";

const USER = process.env.GH_USER || "rizanw";
const LIMIT = Number(process.env.RELEASE_LIMIT || 6);
const README = new URL("../../README.md", import.meta.url);
const START = "<!-- recent_releases starts -->";
const END = "<!-- recent_releases ends -->";

const headers = {
  Accept: "application/vnd.github+json",
  "User-Agent": "profile-readme-updater",
  ...(process.env.GITHUB_TOKEN && { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }),
};

async function api(path) {
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const repos = (await api(`/users/${USER}/repos?type=owner&per_page=100`)).filter(
  (r) => !r.fork && !r.archived && !r.private,
);

const releases = (
  await Promise.all(
    repos.map(async (repo) => {
      const rel = await api(`/repos/${repo.full_name}/releases/latest`);
      if (rel) {
        return { repo: repo.name, tag: rel.tag_name, url: rel.html_url, date: rel.published_at.slice(0, 10) };
      }
      // No published release: fall back to the newest tag, dated by its commit.
      const [tag] = (await api(`/repos/${repo.full_name}/tags?per_page=1`)) ?? [];
      if (!tag) return null;
      const commit = await api(`/repos/${repo.full_name}/commits/${tag.commit.sha}`);
      return {
        repo: repo.name,
        tag: tag.name,
        url: `${repo.html_url}/releases/tag/${encodeURIComponent(tag.name)}`,
        date: commit.commit.committer.date.slice(0, 10),
      };
    }),
  )
)
  .filter(Boolean)
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, LIMIT);

if (releases.length === 0) throw new Error("No releases found; leaving README untouched.");

const block = releases.map((r) => `• [${r.repo} ${r.tag}](${r.url}) - ${r.date}`).join("<br>");

const readme = await readFile(README, "utf8");
const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1 || end < start) throw new Error("Release markers not found in README.md");

const updated = `${readme.slice(0, start + START.length)}\n${block}\n${readme.slice(end)}`;
if (updated === readme) {
  console.log("README already up to date.");
} else {
  await writeFile(README, updated);
  console.log(`Updated README with ${releases.length} releases.`);
}
