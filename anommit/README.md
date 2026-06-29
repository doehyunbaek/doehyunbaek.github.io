# anommit

`anommit/` is a client-only GitHub Pages app for viewing public GitHub commits with author information anonymized.

Preferred Base64URL fragment form:

```text
https://doehyunbaek.github.io/anommit/#u=<base64url-github-commit-url>
```

Legacy raw-query links still work and are automatically rewritten in the address bar to `#u=<base64url>`:

```text
https://doehyunbaek.github.io/anommit?https://github.com/owner/repo/commit/sha
```

## How it works

- Parses a public `github.com/owner/repo/commit/sha` URL from a Base64URL fragment, Base64 query parameter, raw hash, or legacy raw query string.
- Fetches commit metadata, refs, and patches directly from the public GitHub REST API in the browser.
- Replaces known author/committer names, logins, emails, avatars, Linux-style `Message-ID`/lore email patterns, and matching commit-message identities with deterministic aliases.
- Renders a GitHub-inspired commit summary and file diff view without a backend or build step.

Base64URL obfuscates the target URL from casual viewing, but it is not a security boundary: the decoded target and GitHub API requests are still available to someone inspecting the client.

## Files

- `index.html` — static page shell
- `styles.css` — GitHub-inspired responsive styling
- `app.js` — URL parsing, GitHub API fetching, anonymization, Base64URL link handling, and diff rendering
