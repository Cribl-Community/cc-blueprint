# Decisions

One line per non-obvious choice. Sources: [Apps docs](https://docs.cribl.io/apps/) (v4.20), scaffold `AGENTS.md` (`@cribl/apps` 1.1.0), workspace `openapi.json` (4.20.1), and existing apps in [Cribl-Community](https://github.com/Cribl-Community).

## Phase 0 — verify items

| Item | Answer | Source |
| --- | --- | --- |
| App packaging | No separate manifest: metadata in `package.json` (`cribl.type: "app"`, `displayName`, `minLogStreamVersion`, `tags.product`), plus `config/{policies,proxies,backend,schedules}.yml`. Scaffolded with `npx @cribl/apps@latest create`; `npm run package` (`apps package`) builds the `.tgz` and bumps the patch version. | [builder-guide](https://docs.cribl.io/apps/builder-guide/), AGENTS.md |
| Install scope | Apps install per Workspace, not per Worker Group; install needs Org Admin; deleting an app deletes its KV data. Clean-install test = delete app, reinstall `.tgz`. | [admin-guide](https://docs.cribl.io/apps/admin-guide/) |
| API auth | Relative `fetch(window.CRIBL_API_URL + path)`; the iframe proxy injects auth. Calls run as the signed-in member, plus grants declared in `config/policies.yml`. No stored token. | AGENTS.md, [runtime-and-security](https://docs.cribl.io/apps/runtime-and-security/) |
| Config endpoints | Groups: `GET /master/groups`. Per group: `/m/{gid}/routes`, `/m/{gid}/pipelines`, `/m/{gid}/system/inputs`, `/m/{gid}/system/outputs`, `/m/{gid}/packs`. Route write: `PATCH /m/{gid}/routes/{id}` (full table). Commit: `POST /m/{gid}/version/commit`; deploy: `PATCH /master/groups/{gid}/deploy`. | openapi.json; commit/deploy pattern from cc-cribl-power-tools |
| Uncommitted vs deployed | Config GETs carry no commit or deploy marker. Blueprint reports the working config as returned and, in Phase 2, calls `GET /m/{gid}/version/status` to show a "has uncommitted changes" banner. Not blocking. | fixture: `test/fixtures/workspace-default.json` |
| KV API | GET/PUT/DELETE `CRIBL_API_URL + '/kvstore/<key>'`; list keys via `POST /kvstore/keys {prefix}`. 1,000 keys default quota. Shared per app per workspace (not per user). | AGENTS.md, builder-guide |
| KV limits | Probe (4.20.1, 2026-09-26): 100 KB PUT → 201, 128 KB → 413, so chunks are capped at 90 KB. `/` and `.` in keys work; `:` → 404. PUT with `application/json` stores `"[object Object]"`, so always send `JSON.stringify(v)` as `text/plain`. `POST /kvstore/keys` returns a plain `string[]`. In Live Preview the app ID is `__dev__cc-blueprint`, so dev KV data is separate from the installed app's. | `test/fixtures/raw/blueprint-kv-probe.json` (git-ignored) |
| Backend function | Not needed for v1. Frontend-only: delete `config/backend.yml` and `backend/` in Phase 1. | AGENTS.md |
| Proxy hosts | None; `config/proxies.yml` stays empty. | — |
| Diagram / CDN | No CSP docs; bundle everything. File downloads (Blob + `<a download>`) work (probe downloads succeeded). Clipboard is **denied** (`NotAllowedError`), so Markdown export is download-only. No localStorage/cookies. | builder-guide; KV probe |

## Product

- Positioning pivot (Steve, 2026-09-26): cc-di-configquest-for-cribl already lints unreachable routes, orphan pipelines and dead-end destinations. Blueprint leads with the as-built handoff document, risk rules no other app has (L02, L05, L07, L08), suppressions, labelled snapshot diffs, and the L01 fix-it. L03/L04 are optional and needed mainly for the flow diagram.
- L05 simplified: in the 4.20 schema `onBackpressure` is `block | drop | queue`, and `queue` *is* the persistent queue, so L05 fires on `onBackpressure === "drop"`.
- References counted for orphan/diagram purposes: Route `pipeline`/`output`, Source `pipeline`, Source QuickConnect `connections[].pipeline/output` (bypasses Routes), Destination `pipeline`, Output Router rules, and pack references (`pack:<id>`). Routes with `enableOutputExpression` make destination reachability unknowable; such outputs are never flagged orphan.
- L01 "equivalent to true": `true`, `!false`, `1`, empty/whitespace filter. Nothing cleverer.

## API shapes (from fixture)

- Every list endpoint returns `{ items, count }`. `/routes` returns one table: `items[0] = { id: "default", routes: [...], groups: {}, comments }`; route fields `id, name, filter, final, pipeline, output, disabled, groupId?`.
- `/pipelines` also lists packs as pseudo-pipelines `pack:<packId>` with no functions. They are references, not pipelines: exempt from L03/L06 and drawn as packs.
- The built-in `passthru` pipeline is intentionally empty: exempt from L06.
- The `default` destination is an alias: `{ type: "default", defaultId: "devnull" }`. Resolve it before L02/L04 and in the diagram. In the lab workspace the Default route resolves to devnull, which is a real L02 hit.
- Function shape: `{ id, filter, conf, description?, disabled?, final? }`; `id` is the function type (e.g. `eval`).
- Correction (Phase 3): the lab route `Cribl_Logs` is not dangling. It uses an output expression (`enableOutputExpression: true`); its `output: "false"` field is ignored by Cribl. Its expression `__outputId=="criblvision"` evaluates to a boolean, not a destination id, which is likely a real misconfiguration but out of scope.
- No QuickConnect `connections` in the lab workspace; the demo group must seed one to test that path.

## As-Built (Phase 2)

- Flow diagram is hand-rolled SVG (no library): 4 columns, with Sources feeding a vertical "routing bus" instead of N×M source→route edges. QuickConnect is drawn as dotted edges that skip the Routes column. Pipeline→Destination edges are de-duplicated per pair, and hovering a node traces the flows through it.
- Unreferenced pipelines and destinations are drawn dashed. This is a visual preview of L03/L04 from the same reference graph. Destinations are never marked unreferenced when any enabled route uses an output expression.
- Markdown export embeds a Mermaid flowchart, so the handoff doc renders on GitHub, GitLab and Confluence. Table cells escape only `|`, because other backslash escapes would corrupt regex filters inside code spans.
- Cribl version isn't in the report: `/system/info` was dropped from policies, and `/master/groups` doesn't carry it. Revisit if judges ask.
- Demo config is code (`demo/seed.ts`). The same data is the "bad" test fixture.
- Extra Worker Groups need Cribl Enterprise (Steve's lab has only `default`), so the demo target is the `default` group of a spare free workspace. That workspace also provides the clean fixture (captured before seeding) and the clean-install test.
- The seeder guard is content-based, not name-based, since every workspace has a `default` group. It shows the workspace host, and if the Routing table holds routes the seed doesn't own, it requires typing that host to proceed.

## Linter (Phase 3)

- One file per rule in `src/lint/rules/`, pure functions of Inventory + reference graph. The runner assigns severity and a stable key, `<rule>/<kind>/<id>[/<detail>]`, which suppressions will use.
- L01 reports only the first shadowing route; later catch-alls are themselves shadowed.
- L02 only considers the first enabled Final catch-all, the only reachable one (a non-Final catch-all only clones), and needs at least one enabled route above it, so a fresh group's lone Default route doesn't fire. Earlier versions also flagged an unreachable Default route below another catch-all, which was a false positive.
- L01 counts only shadowed routes with specific filters. A catch-all below a catch-all is redundant, not lost logic, and counting it made the fix-it unable to clear L01.
- L03 counts Chain function (`conf.processor`) references and exempts the 9 pipelines a fresh 4.20 group ships with (confirmed from the demo workspace before seeding: passthru, main, devnull, cribl_metrics_rollup, prometheus_metrics, cisco_asa, cisco_estreamer, palo_alto_traffic, wineventlogs). Collector jobs aren't read; the fix text says so.
- L04 stands down entirely when any enabled route uses an output expression, and the Linter tab says why.
- L07 checks eval assignments to secret-named fields with a quoted literal, `key=value` patterns, and known token formats (AWS, GitHub, Slack, Bearer, JWT). Candidates need letters plus digits to avoid matching field references. Evidence shows at most the first 4 characters.
- L08 checks conf keys `regex`/`matchRegex` (including `regexList` and mask rules) for a leading `.*` or `.*?`, also inside opening groups.

## Snapshots, suppressions, fix-it (Phase 4)

- Snapshots are the normalized Inventory, redacted with L07's detector (the secret is replaced by its first 4 characters plus an 8-hex FNV-1a fingerprint, so diffs still notice a changed secret). Chunks are written first and meta last; listing only shows snapshots with meta.
- "Compare against current config" redacts the live inventory the same way, so masked values compare like-for-like.
- Suppressions are one document per group (`suppress/<group>`), keyed by the stable finding key. Each write re-reads the document to merge concurrent edits. Stale suppressions are shown and removable.
- L01 fix-it: the shadowing route moves to just above the next enabled Final catch-all (or to the end). The write re-fetches the raw table, refuses if its order changed since load, preserves every raw field, and never commits or deploys. It's the app's only config write (`PATCH /m/:gid/routes/*`).
- The demo's `catch_all_early` now sends to devnull, so L01 and L02 tell one story. After the fix L02 remains true, and the demo shows suppressing it with a reason.

## Polish (Phase 5)

- Packs are optional when loading a group. A failed `/packs` read (e.g. no permission) produces a warning, not an error; the other four collections are required.
- The host theme is kept in React context (`ui/theme.ts`) so Capra EmptyState illustrations switch with light and dark mode. The `.dark` body class still drives all CSS tokens.

## Tooling

- There is no app-icon field in the Apps docs, `@cribl/apps`, or the Marketplace README template. The scaffold's `public/favicon.svg` (the Vite logo) was replaced with a Blueprint glyph, and its unused social-icon sprite `public/icons.svg` was removed, so the package ships no third-party marks.

- Worker Groups come from `GET /master/groups?product=stream&fields=git.localChanges`. The same call returns the uncommitted-change count for the banner, so `/version/status` isn't needed.
- Groups are filtered to `type === "stream"`, or `!isFleet && !isSearch` on older Leaders. Edge and Search are out of scope.
- `config/policies.yml` declares only the GET paths the app calls. `/system/info` was removed after Phase 0.
- **License question:** Capra (`@capra/*`) is bundled into the UI but is under the proprietary Cribl Developer Agreement, not an OSI license. AGENTS.md mandates Capra, and other Apache-2.0 Cribl-Community apps (e.g. cc-pixel-open, cc-visicore-spl-to-kql) bundle it too. Decision (Steve, 2026-09-29): accepted as compatible without asking the organizers, since Cribl's scaffold mandates Capra and other Apache-2.0 Cribl-Community apps bundle it the same way. It's disclosed in README and CREDITS.md. If an organizer objects, the fallback is a plain-React UI (about half a day).
- Production bundle is ~1 MB (Capra plus illustrations). Acceptable; the archive limit is 100 MB.
- `build/` (the packaged `.tgz`) is git-ignored; releases attach it.

- Fixtures: `node scripts/sanitize-fixtures.mjs <raw> <out>` keeps only the 5 config endpoints, redacts secret-named fields (a plaintext HEC token was present), rewrites IPs/hostnames, and refuses to write if any IP, non-Cribl hostname, or UUID survives.

- Phase 0 fixtures are pulled through the app itself (`src/dev/Phase0Probe.tsx`) in Live Preview, not with API credentials. The probe and the demo seeder are kept as dev-only tools (they rebuild fixtures and the demo). An `import.meta.env.DEV` guard excludes them from production builds, and a grep of `dist/` confirms it.
- In-app confirmations use an inline two-step button, not `window.confirm`, since the iframe sandbox attributes are undocumented.
- `openapi.json` (9.9 MB, workspace-generated) is git-ignored; regenerate via the scaffold command.
- `npm audit`: 2 moderate advisories in esbuild ≤0.24 nested under `@cribl/apps` (dev-server only, no upstream fix). Accepted.
- App ID is `cc-blueprint`, matching the repo name (Cribl-Community/cc-blueprint): the release workflow uploads to the dispensary under the repo name. The repo was briefly `cc-shunger` (releases 1.0.2–1.0.5 used that App ID); an install under one ID has its own KV store.
- Route filters are analyzed with a small parser (`src/model/filter.ts`), never executed: yes, no, or maybe per Source. Only `__inputId` (`<type>:<id>`) and string-literal Source metadata count as known; anything unsupported is "maybe", so the analyzer can be incomplete but never claims a wrong yes or no.
- `__inputId` is unknown for `cribl_http`/`cribl_tcp` Sources, which relay events from other Cribl nodes; Source metadata is ignored when a pre-processing pipeline could rewrite it.
- Live health is read per node (`/w/<node>/system/status/*`), worst state wins. A capture showed the group-level `/m/<group>/system/status/*` reporting all 22 objects Green while the node reported four Red with errors (parse failures, a blocked sender, connection and init errors). Capped at 10 nodes per refresh for large Fleets.
- Edge → Stream lineage matches a Fleet's Cribl TCP/HTTP Destination to a Stream Source with the same transport and port. If the receiver hostname's first DNS label is a Worker Group id (the Cribl.Cloud ingress pattern `<group>.<workspace>.cribl.cloud`), only that group matches and the link is "certain"; otherwise every same-port receiver is listed as "possible". It reads raw Source/Destination lists across groups because normalized config drops hosts and ports.
- Subfleets: the parent comes from the group's `inherits`; object provenance from `__srcGroup` (parent id, present on inherited objects) and `__srcOverridden` (local overlay), as documented on `CrudEntityBase` in the 4.20 OpenAPI spec. Built from the spec, not a capture: on Cribl.Cloud's free tier, Add Fleet is disabled ("available with a Cribl Enterprise license"), so no subfleet could be created to test against.
