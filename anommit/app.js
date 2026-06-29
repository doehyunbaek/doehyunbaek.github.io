const app = document.querySelector("#app");
const form = document.querySelector("#lookup-form");
const input = document.querySelector("#commit-url");

const GITHUB_HEADERS = Object.freeze({
  Accept: "application/vnd.github+json",
});

let activeRequest = 0;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const targetUrl = input.value.trim();
  if (!targetUrl) return;
  navigateTo(targetUrl);
});

window.addEventListener("popstate", renderFromLocation);
window.addEventListener("hashchange", renderFromLocation);

renderFromLocation();

function renderFromLocation() {
  const targetUrl = readTargetUrl();
  input.value = "";

  if (!targetUrl) {
    renderEmptyState();
    return;
  }

  normalizeLocationToEncodedHash(targetUrl);
  renderCommitUrl(targetUrl);
}

function readTargetUrl() {
  const hashTarget = readTargetFromHash(window.location.hash);
  if (hashTarget) return hashTarget;

  const search = window.location.search;
  if (!search || search === "?") return "";

  const params = new URLSearchParams(search);
  const encoded = params.get("u") || params.get("b64") || params.get("base64");
  if (encoded) return decodeTargetUrl(encoded);
  if (params.has("url")) return params.get("url")?.trim() || "";

  const raw = search.slice(1);
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

function readTargetFromHash(hash) {
  if (!hash || hash === "#") return "";

  const raw = hash.slice(1).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;

  const params = new URLSearchParams(raw);
  const encoded = params.get("u") || params.get("b64") || params.get("base64");
  if (encoded) return decodeTargetUrl(encoded);

  if (/^[A-Za-z0-9_-]+={0,2}$/.test(raw)) return decodeTargetUrl(raw);
  return "";
}

function navigateTo(targetUrl) {
  input.value = "";
  const nextUrl = `${window.location.pathname}#u=${encodeTargetUrl(targetUrl)}`;
  history.pushState({ targetUrl }, "", nextUrl);
  renderCommitUrl(targetUrl);
}

function encodeTargetUrl(targetUrl) {
  const bytes = new TextEncoder().encode(String(targetUrl));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeTargetUrl(encodedTargetUrl) {
  try {
    const normalized = String(encodedTargetUrl || "").trim().replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes).trim();
  } catch {
    return "";
  }
}

function normalizeLocationToEncodedHash(targetUrl) {
  if (locationHasEncodedTarget()) return;
  history.replaceState({ targetUrl }, "", `${window.location.pathname}#u=${encodeTargetUrl(targetUrl)}`);
}

function locationHasEncodedTarget() {
  const hash = window.location.hash;
  if (!hash || hash === "#") return false;
  const raw = hash.slice(1).trim();
  if (!raw || /^https?:\/\//i.test(raw)) return false;

  const params = new URLSearchParams(raw);
  return params.has("u") || params.has("b64") || params.has("base64") || /^[A-Za-z0-9_-]+={0,2}$/.test(raw);
}

async function renderCommitUrl(targetUrl) {
  const requestId = ++activeRequest;
  let target;

  try {
    target = parseGitHubCommitUrl(targetUrl);
  } catch (error) {
    renderError("That does not look like a GitHub commit URL.", error.message);
    return;
  }

  document.title = "Loading commit… · anommit";
  renderLoading();

  try {
    const commit = await fetchCommit(target);
    if (requestId !== activeRequest) return;

    const refInfo = await fetchRefInfo(target, commit.sha || target.sha).catch(() => ({
      branches: [],
      tags: [],
    }));
    if (requestId !== activeRequest) return;

    const aliases = createAliasBook(commit);
    renderCommit(target, commit, aliases, refInfo);
  } catch (error) {
    if (requestId !== activeRequest) return;
    renderError("Could not load this commit.", error.message);
  }
}

function parseGitHubCommitUrl(rawUrl) {
  const value = rawUrl.trim();
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("Use a full URL such as https://github.com/owner/repo/commit/sha.");
  }

  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (host !== "github.com" && host !== "www.github.com") {
    throw new Error("Only public github.com commit URLs are supported by this static app.");
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || !["commit", "commits"].includes(parts[2])) {
    throw new Error("Expected /owner/repo/commit/sha in the URL path.");
  }

  const [owner, repo, , sha] = parts;
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error("The commit SHA should be 7 to 40 hexadecimal characters.");
  }

  return {
    owner: decodeURIComponent(owner),
    repo: decodeURIComponent(repo).replace(/\.git$/i, ""),
    sha: sha.toLowerCase(),
  };
}

async function fetchCommit({ owner, repo, sha }) {
  const endpoint = new URL(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
      repo,
    )}/commits/${encodeURIComponent(sha)}`,
  );
  endpoint.searchParams.set("per_page", "100");

  const firstResponse = await fetch(endpoint, { headers: GITHUB_HEADERS });
  const commit = await readJsonResponse(firstResponse);
  const files = Array.isArray(commit.files) ? [...commit.files] : [];
  const seenPages = new Set([endpoint.href]);
  let nextPage = nextLink(firstResponse.headers.get("Link"));

  while (nextPage && !seenPages.has(nextPage)) {
    seenPages.add(nextPage);
    const response = await fetch(nextPage, { headers: GITHUB_HEADERS });
    const page = await readJsonResponse(response);
    if (Array.isArray(page.files)) files.push(...page.files);
    nextPage = nextLink(response.headers.get("Link"));
  }

  return { ...commit, files };
}

async function fetchRefInfo(target, commitSha) {
  const [repoInfo, headBranches] = await Promise.all([
    fetchGitHubJson(repoApiUrl(target, "")),
    fetchGitHubJson(repoApiUrl(target, `/commits/${encodeURIComponent(commitSha)}/branches-where-head`)).catch(
      () => [],
    ),
  ]);

  const branches = new Set();
  for (const branch of Array.isArray(headBranches) ? headBranches : []) {
    if (branch?.name) branches.add(branch.name);
  }

  if (repoInfo?.default_branch) {
    const defaultRef = `refs/heads/${repoInfo.default_branch}`;
    if (await refContainsCommit(target, commitSha, defaultRef)) {
      branches.add(repoInfo.default_branch);
    }
  }

  const tags = await containingTags(target, commitSha);
  return {
    branches: [...branches],
    tags,
  };
}

async function containingTags(target, commitSha) {
  const tagsUrl = new URL(repoApiUrl(target, "/tags"));
  tagsUrl.searchParams.set("per_page", "30");
  const tags = await fetchGitHubJson(tagsUrl.href).catch(() => []);
  const matches = [];

  for (const tag of Array.isArray(tags) ? tags.slice(0, 12) : []) {
    if (!tag?.name) continue;
    if (tag.commit?.sha?.toLowerCase() === commitSha.toLowerCase()) {
      matches.push(tag.name);
    } else if (await refContainsCommit(target, commitSha, `refs/tags/${tag.name}`)) {
      matches.push(tag.name);
    }
    if (matches.length >= 2) break;
  }

  return matches;
}

async function refContainsCommit(target, commitSha, refName) {
  const compareUrl = repoApiUrl(
    target,
    `/compare/${encodeURIComponent(commitSha)}...${encodeURIComponent(refName)}`,
  );
  const comparison = await fetchGitHubJson(compareUrl).catch(() => null);
  return comparison?.behind_by === 0;
}

function repoApiUrl({ owner, repo }, suffix) {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
}

async function fetchGitHubJson(url) {
  const response = await fetch(url, { headers: GITHUB_HEADERS });
  return readJsonResponse(response);
}

async function readJsonResponse(response) {
  const rateRemaining = response.headers.get("x-ratelimit-remaining");
  const rateReset = response.headers.get("x-ratelimit-reset");
  let payload = null;

  try {
    payload = await response.json();
  } catch {
    // Keep payload null; a clearer network error is thrown below.
  }

  if (!response.ok) {
    let message = payload?.message || `${response.status} ${response.statusText}`;
    if (response.status === 403 && rateRemaining === "0" && rateReset) {
      message += ` GitHub's unauthenticated API rate limit resets at ${formatDateTime(
        Number(rateReset) * 1000,
      )}.`;
    }
    throw new Error(message);
  }

  return payload;
}

function nextLink(linkHeader) {
  if (!linkHeader) return "";
  const links = linkHeader.split(",");
  for (const link of links) {
    const match = link.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return "";
}

function createAliasBook(commit) {
  const identities = [];
  const byEmail = new Map();
  const byLogin = new Map();
  const byName = new Map();
  const byId = new Map();

  addIdentity({
    name: commit.commit?.author?.name,
    email: commit.commit?.author?.email,
    login: commit.author?.login,
    id: commit.author?.id,
    htmlUrl: commit.author?.html_url,
    avatarUrl: commit.author?.avatar_url,
  });

  addIdentity({
    name: commit.commit?.committer?.name,
    email: commit.commit?.committer?.email,
    login: commit.committer?.login,
    id: commit.committer?.id,
    htmlUrl: commit.committer?.html_url,
    avatarUrl: commit.committer?.avatar_url,
  });

  for (const person of peopleFromMessage(commit.commit?.message || "")) {
    addIdentity(person);
  }

  const replacements = buildReplacements(identities);
  const residualEmails = new Map();

  return {
    identities,
    anonymize(text) {
      return anonymizeText(text, replacements, residualEmails);
    },
    find(info) {
      return findIdentity(info) || identities[0];
    },
  };

  function addIdentity(info) {
    const clean = normalizeIdentity(info);
    if (!clean.name && !clean.email && !clean.login && !clean.id) return null;

    let identity = findIdentity(clean, true);
    if (!identity) {
      const number = identities.length + 1;
      const seed = clean.email || clean.login || clean.name || String(clean.id) || String(number);
      identity = {
        number,
        actual: {
          names: new Set(),
          emails: new Set(),
          logins: new Set(),
          ids: new Set(),
          urls: new Set(),
        },
        alias: {
          name: `Author ${number}`,
          login: `anonymous-author-${number}`,
          email: `author-${number}@example.invalid`,
          initials: `A${number}`,
          hue: hashString(seed) % 360,
        },
      };
      identities.push(identity);
    }

    remember(identity, clean);
    return identity;
  }

  function findIdentity(info, conservative = false) {
    const clean = normalizeIdentity(info);
    const idKey = clean.id != null ? String(clean.id) : "";
    const emailKey = clean.email.toLowerCase();
    const loginKey = clean.login.toLowerCase();
    const nameKey = clean.name.toLowerCase();

    if (emailKey && byEmail.has(emailKey)) return byEmail.get(emailKey);
    if (loginKey && byLogin.has(loginKey)) return byLogin.get(loginKey);
    if (idKey && byId.has(idKey)) return byId.get(idKey);

    const hasStrongerKey = emailKey || loginKey || idKey;
    if (nameKey && (!conservative || !hasStrongerKey) && byName.has(nameKey)) {
      return byName.get(nameKey);
    }

    return null;
  }

  function remember(identity, info) {
    if (info.name) {
      identity.actual.names.add(info.name);
      byName.set(info.name.toLowerCase(), identity);
    }
    if (info.email) {
      identity.actual.emails.add(info.email);
      byEmail.set(info.email.toLowerCase(), identity);
    }
    if (info.login) {
      identity.actual.logins.add(info.login);
      byLogin.set(info.login.toLowerCase(), identity);
      identity.actual.urls.add(`https://github.com/${info.login}`);
      identity.actual.urls.add(`http://github.com/${info.login}`);
    }
    if (info.id != null) {
      identity.actual.ids.add(String(info.id));
      byId.set(String(info.id), identity);
    }
    if (info.htmlUrl) identity.actual.urls.add(info.htmlUrl);
    if (info.avatarUrl) identity.actual.urls.add(info.avatarUrl);
  }
}

function normalizeIdentity(info = {}) {
  return {
    name: collapseWhitespace(info.name || ""),
    email: String(info.email || "").trim(),
    login: String(info.login || "").trim(),
    id: info.id ?? null,
    htmlUrl: String(info.htmlUrl || "").trim(),
    avatarUrl: String(info.avatarUrl || "").trim(),
  };
}

function peopleFromMessage(message) {
  const people = [];
  const angleEmailPattern = /([^<>\r\n]*?)<([^<>\s@]+@[^<>\s]+)>/g;
  const nonPersonHeaderPattern = /^\s*(?:message-id|in-reply-to|references)\s*:/i;

  for (const line of message.split(/\r?\n/)) {
    if (nonPersonHeaderPattern.test(line)) continue;

    let match;
    while ((match = angleEmailPattern.exec(line)) !== null) {
      const name = cleanupAttributionName(match[1]);
      const email = match[2].trim();
      if (name || email) people.push({ name, email });
    }
  }

  return people;
}

function cleanupAttributionName(value) {
  return collapseWhitespace(value)
    .replace(
      /^(?:[A-Za-z][A-Za-z-]*-by|Co-authored-by|Co-developed-by|Cc|CC|From|To|Reply-To|Sender):\s*/i,
      "",
    )
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

function buildReplacements(identities) {
  const replacements = [];

  for (const identity of identities) {
    for (const url of identity.actual.urls) {
      replacements.push({
        kind: "url",
        needle: url,
        replacement: url.replace(/github\.com\/[^/?#]+/i, `github.com/${identity.alias.login}`),
      });
    }
    for (const email of identity.actual.emails) {
      replacements.push({ kind: "email", needle: email, replacement: identity.alias.email });
    }
    for (const name of identity.actual.names) {
      if (name.length >= 3) {
        replacements.push({ kind: "name", needle: name, replacement: identity.alias.name });
      }
    }
    for (const login of identity.actual.logins) {
      if (login.length >= 3) {
        replacements.push({ kind: "login", needle: login, replacement: identity.alias.login });
      }
    }
  }

  return replacements
    .filter((item) => item.needle && item.needle !== item.replacement)
    .sort((a, b) => b.needle.length - a.needle.length);
}

function anonymizeText(text, replacements, residualEmails = new Map()) {
  let result = String(text ?? "");
  for (const replacement of replacements) {
    result = replaceNeedle(result, replacement);
  }
  return anonymizeResidualEmailPatterns(result, residualEmails);
}

function anonymizeResidualEmailPatterns(text, residualEmails) {
  const rawEmailPattern = /[A-Z0-9.!#$%&'*+=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;
  const encodedEmailPattern = /[A-Z0-9.!#$%&'*+\-_=~%]+%40[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/gi;

  return text
    .replace(rawEmailPattern, (email) => residualEmailAlias(email, residualEmails, false))
    .replace(encodedEmailPattern, (email) => residualEmailAlias(email, residualEmails, true));
}

function residualEmailAlias(email, residualEmails, encoded) {
  const decoded = encoded ? decodeURIComponent(email.replace(/%40/i, "@")) : email;
  if (/@example\.invalid$/i.test(decoded)) return email;

  const key = decoded.toLowerCase();
  if (!residualEmails.has(key)) {
    residualEmails.set(key, `redacted-email-${residualEmails.size + 1}@example.invalid`);
  }

  const alias = residualEmails.get(key);
  return encoded ? encodeURIComponent(alias) : alias;
}

function replaceNeedle(text, { kind, needle, replacement }) {
  const escaped = escapeRegExp(needle);

  if (kind === "email" || kind === "login") {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])(${escaped})(?=$|[^A-Za-z0-9_-])`, "gi");
    return text.replace(pattern, (_match, prefix) => `${prefix}${replacement}`);
  }

  if (kind === "name") {
    const pattern = new RegExp(`(^|[^A-Za-z0-9_-])(${escaped})(?=$|[^A-Za-z0-9_-])`, "g");
    return text.replace(pattern, (_match, prefix) => `${prefix}${replacement}`);
  }

  return text.replace(new RegExp(escaped, "g"), replacement);
}

function renderEmptyState() {
  document.title = "anommit — anonymous GitHub commits";
  app.innerHTML = `
    <section class="hero-card">
      <p class="eyebrow">anonymous commit review</p>
      <h1>Render a public GitHub commit with author details anonymized.</h1>
      <p class="hero-copy">
        Paste a GitHub commit URL. anommit rewrites the page URL to a Base64URL fragment like
        <code>#u=...</code>, fetches the public commit data in your browser, and redraws a
        GitHub-style commit view using deterministic aliases like <strong>Author 1</strong>.
      </p>
      <div class="hero-actions">
        <code>${escapeHtml(`${window.location.origin}${window.location.pathname}#u=<base64url-github-commit-url>`)}</code>
      </div>
      <ul class="feature-list">
        <li>No backend or build step.</li>
        <li>Author names, logins, emails, avatars, and matching message text are replaced locally.</li>
        <li>Diffs are rendered from GitHub's public commit API.</li>
      </ul>
    </section>
  `;
}

function renderLoading() {
  app.innerHTML = `
    <section class="state-card">
      <div class="spinner" aria-hidden="true"></div>
      <div>
        <h1>Fetching commit…</h1>
        <p>Calling the public GitHub API and preparing anonymized aliases.</p>
      </div>
    </section>
  `;
}

function renderError(title, detail) {
  document.title = "Error · anommit";
  app.innerHTML = `
    <section class="state-card error-card">
      <div class="error-icon" aria-hidden="true">!</div>
      <div>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(detail || "Unknown error")}</p>
      </div>
    </section>
  `;
}

function renderCommit(target, commit, aliases, refInfo = { branches: [], tags: [] }) {
  const gitCommit = commit.commit || {};
  const message = gitCommit.message || "";
  const [titleLine, ...bodyLines] = message.split(/\r?\n/);
  const body = bodyLines.join("\n").trim();
  const author = aliases.find({
    name: gitCommit.author?.name,
    email: gitCommit.author?.email,
    login: commit.author?.login,
    id: commit.author?.id,
  });
  const committer = aliases.find({
    name: gitCommit.committer?.name,
    email: gitCommit.committer?.email,
    login: commit.committer?.login,
    id: commit.committer?.id,
  });
  const sameAuthorAndCommitter = author === committer;
  const files = Array.isArray(commit.files) ? commit.files : [];
  const additions = commit.stats?.additions ?? sum(files, "additions");
  const deletions = commit.stats?.deletions ?? sum(files, "deletions");
  const shortSha = shortHash(commit.sha || target.sha);
  const anonOwner = aliases.anonymize(target.owner);
  const anonRepo = aliases.anonymize(target.repo);
  const parents = Array.isArray(commit.parents) ? commit.parents : [];

  document.title = `${aliases.anonymize(titleLine || shortSha)} · anommit`;

  app.innerHTML = `
    <section class="repo-header">
      <div class="repo-path" aria-label="repository">
        <span class="repo-icon" aria-hidden="true">⌘</span>
        <span>${escapeHtml(anonOwner)}</span>
        <span class="slash">/</span>
        <strong>${escapeHtml(anonRepo)}</strong>
      </div>
      <div class="repo-actions">
        <span class="anon-badge">authors anonymized</span>
      </div>
    </section>

    <article class="commit-panel">
      <div class="commit-title-row">
        ${renderAvatar(author.alias)}
        <div>
          <h1>${escapeHtml(aliases.anonymize(titleLine || `Commit ${shortSha}`))}</h1>
          <p class="commit-subtitle">
            <strong>${escapeHtml(author.alias.name)}</strong>
            authored ${escapeHtml(formatDateTime(gitCommit.author?.date))}
            ${sameAuthorAndCommitter ? "" : ` · committed by <strong>${escapeHtml(committer.alias.name)}</strong>`}
          </p>
        </div>
      </div>
      ${body ? `<pre class="commit-body">${escapeHtml(aliases.anonymize(body))}</pre>` : ""}
      <dl class="commit-facts">
        <div><dt>Commit</dt><dd><code>${escapeHtml(commit.sha || target.sha)}</code></dd></div>
        ${renderRefsFact(refInfo)}
        ${parents
          .map(
            (parent, index) =>
              `<div><dt>${parents.length > 1 ? `Parent ${index + 1}` : "Parent"}</dt><dd><code>${escapeHtml(
                shortHash(parent.sha),
              )}</code></dd></div>`,
          )
          .join("")}
        <div><dt>Verification</dt><dd>${renderVerification(gitCommit.verification)}</dd></div>
      </dl>
    </article>

    <section class="diff-overview">
      <div>
        <h2>${files.length} changed ${plural(files.length, "file")}</h2>
        <p>
          <span class="additions">+${additions}</span>
          <span class="deletions">−${deletions}</span>
          across this commit
        </p>
      </div>
    </section>

    <section class="file-list" aria-label="Files changed">
      ${files.length ? files.map((file) => renderFile(file, aliases)).join("") : renderNoFiles()}
    </section>
  `;
}

function renderVerification(verification = {}) {
  if (verification.verified) {
    return `<span class="verified">Verified</span>`;
  }
  const reason = verification.reason ? ` (${verification.reason})` : "";
  return `<span class="muted">Unverified${escapeHtml(reason)}</span>`;
}

function renderRefsFact(refInfo = { branches: [], tags: [] }) {
  const refs = [
    ...(refInfo.branches || []).map((name) => ({ kind: "branch", name })),
    ...(refInfo.tags || []).map((name) => ({ kind: "tag", name })),
  ];

  if (!refs.length) return "";

  return `
    <div>
      <dt>Refs</dt>
      <dd class="ref-list">
        ${refs
          .map(
            (ref, index) =>
              `${index ? '<span class="ref-separator">·</span>' : ""}<span class="ref-label ref-${escapeAttr(
                ref.kind,
              )}">${escapeHtml(ref.name)}</span>`,
          )
          .join("")}
      </dd>
    </div>
  `;
}

function renderFile(file, aliases) {
  const filename = aliases.anonymize(file.filename || "Unknown file");
  const previous = file.previous_filename ? aliases.anonymize(file.previous_filename) : "";
  const patch = file.patch || "";
  const status = file.status || "modified";

  return `
    <details class="file-card" open>
      <summary class="file-header">
        <span class="status-pill status-${escapeAttr(status)}">${escapeHtml(status)}</span>
        <span class="file-name" title="${escapeAttr(filename)}">${escapeHtml(filename)}</span>
        <span class="file-spacer"></span>
        <span class="file-count additions">+${file.additions ?? 0}</span>
        <span class="file-count deletions">−${file.deletions ?? 0}</span>
        <span class="mini-bars" aria-hidden="true">${renderDiffstatBars(
          file.additions || 0,
          file.deletions || 0,
          5,
        )}</span>
      </summary>
      ${previous ? `<div class="rename-note">Renamed from <code>${escapeHtml(previous)}</code></div>` : ""}
      ${patch ? renderDiffTable(patch, aliases) : renderUnavailableDiff(status)}
    </details>
  `;
}

function renderDiffTable(patch, aliases) {
  const rows = [];
  const lines = patch.split("\n");
  let oldLine = null;
  let newLine = null;

  lines.forEach((line, index) => {
    if (index === lines.length - 1 && line === "") return;

    const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      rows.push(`
        <tr class="diff-hunk">
          <td class="line-num"></td>
          <td class="line-num"></td>
          <td class="code-cell">${escapeHtml(aliases.anonymize(line))}</td>
        </tr>
      `);
      return;
    }

    if (line.startsWith("\\")) {
      rows.push(`
        <tr class="diff-note">
          <td class="line-num"></td>
          <td class="line-num"></td>
          <td class="code-cell">${escapeHtml(aliases.anonymize(line))}</td>
        </tr>
      `);
      return;
    }

    const marker = line[0] || " ";
    const content = line.length > 0 ? line.slice(1) : "";
    let type = "context";
    let oldNumber = oldLine;
    let newNumber = newLine;

    if (marker === "+") {
      type = "addition";
      oldNumber = "";
      if (newLine != null) newLine += 1;
    } else if (marker === "-") {
      type = "deletion";
      newNumber = "";
      if (oldLine != null) oldLine += 1;
    } else {
      if (oldLine != null) oldLine += 1;
      if (newLine != null) newLine += 1;
    }

    rows.push(`
      <tr class="diff-line ${type}">
        <td class="line-num">${oldNumber || ""}</td>
        <td class="line-num">${newNumber || ""}</td>
        <td class="code-cell"><span class="marker">${escapeHtml(marker === " " ? " " : marker)}</span>${escapeHtml(
          aliases.anonymize(content),
        )}</td>
      </tr>
    `);
  });

  return `
    <div class="diff-scroll">
      <table class="diff-table">
        <tbody>${rows.join("")}</tbody>
      </table>
    </div>
  `;
}

function renderUnavailableDiff(status) {
  return `
    <div class="empty-diff">
      The ${escapeHtml(status)} diff is binary, too large, or not included in GitHub's public commit API response.
    </div>
  `;
}

function renderNoFiles() {
  return `
    <div class="empty-diff standalone">
      GitHub did not return file-level diff data for this commit.
    </div>
  `;
}

function renderAvatar(alias) {
  return `
    <div class="avatar" style="--avatar-hue: ${Number(alias.hue) || 0}" aria-hidden="true">
      ${escapeHtml(alias.initials)}
    </div>
  `;
}

function renderDiffstatBars(additions, deletions, slots) {
  const total = additions + deletions;
  if (!total) return Array.from({ length: slots }, () => `<span class="bar neutral"></span>`).join("");

  let addSlots = Math.round((additions / total) * slots);
  if (additions > 0 && addSlots === 0) addSlots = 1;
  if (deletions > 0 && addSlots === slots) addSlots = slots - 1;
  const delSlots = slots - addSlots;

  return [
    ...Array.from({ length: addSlots }, () => `<span class="bar add"></span>`),
    ...Array.from({ length: delSlots }, () => `<span class="bar del"></span>`),
  ].join("");
}

function formatDateTime(value) {
  if (!value) return "an unknown date";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "an unknown date";
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function shortHash(value = "") {
  return String(value).slice(0, 7);
}

function sum(items, key) {
  return items.reduce((total, item) => total + (Number(item[key]) || 0), 0);
}

function plural(count, singular) {
  return count === 1 ? singular : `${singular}s`;
}

function collapseWhitespace(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character];
  });
}

function escapeAttr(value) {
  return escapeHtml(value);
}
