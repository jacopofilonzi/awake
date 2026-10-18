# AGENTS.md

Guidelines for AI coding agents (and people) working in this repository.
What lives where and how the pieces fit together is in [STRUCTURE.md](STRUCTURE.md): read it first,
instead of re-reading the whole repo.

These guidelines come from a shared template: https://github.com/jacopofilonzi/agents-guideline.
See "Updating these guidelines" below to align them with the latest version.

## What it is

Awake: self-hosted remote power control for home devices — Wake-on-LAN and relay outputs (buttons and
switches) driven by always-on agents in the LAN that keep an outbound WebSocket to a server on a VPS.
Stack: server Node.js 24 + TypeScript 7 + Hono 4 + SQLite (`node:sqlite`) + `ws`; reference agent Go 1.27;
microcontroller agents (C++, contributed) under `agents/<board>/`; web UI Svelte 5 + Vite 8 + Tailwind 4 PWA ("Sabbia" theme, Lucide icons).
Targets: server on Linux (Docker); agents on Windows, Linux, macOS, Raspberry Pi, microcontrollers.

## Workflow

- **Non-trivial changes start with a plan.** For a feature, refactor, new dependency or anything touching
  several files: read what you need, then present the plan (what changes, which files, trade-offs, open
  questions) and wait for my approval before editing. Small, obvious fixes can go straight in. If the plan
  changes significantly along the way, stop and ask again.
- **Big changes go to one agent, small ones you do yourself.** The goal is to save the main conversation's
  context: the agent does the heavy reading and editing in its own context. Don't spawn sub-agents for
  everything. For a big change, once I've approved the plan, write it out in full (goal, steps, files it
  owns, constraints, how to verify) and launch a single agent to carry it out following that plan; it
  answers with a short report (what changed, which files, `make check` result, open issues), not file
  dumps. Then check it from the diff and `make check` instead of re-reading everything it read. Small
  changes you make directly in the main conversation, without agents.
- **Propose an architecture change when something outgrows its start.** A part that began small and
  simple (e.g. a dashboard in plain HTML for a couple of tasks, a single-file script, a hand-rolled
  config) may keep gaining responsibilities. When it starts to strain its original approach (state wired
  by hand, duplicated markup or logic, ever-growing glue code), stop and propose moving to a better fit
  (e.g. a framework, a proper module layout), with trade-offs and a migration path, instead of piling more
  onto the simple version. Don't migrate without my approval.
- When something is genuinely my decision (UX, user-visible naming, data formats, breaking changes), ask
  instead of guessing. Otherwise pick the sensible default and say what you picked.
- Run commands from the repo root through the Makefile (`make help` lists them). A new recurring command
  goes into the Makefile too.
- **While developing, use the framework's dev tools** (`make dev`: dev server, hot reload, `wails3 dev`, watch
  mode…) instead of building and launching the app after every change. Build and run the real artifact
  (binary, installer, Docker image) only when I say the dev tools don't pick up a specific change, and only
  for that check; then go back to the dev server.
- **Always run `make check` before declaring work done.** It must pass with zero errors and zero warnings.
  If you couldn't run something (Docker, a live API, a platform you're not on), say so instead of claiming it works.
- Makefile recipes must work in both `sh` and `cmd.exe` (GNU make on Windows falls back to `cmd.exe`): only
  `cd dir && command`, no inline `VAR=x cmd`, no `rm`/`cp`/`mkdir -p`; use `node -e` (or the project's own
  language) for file operations.
- Every new env var goes in the config module **and** is documented in `.env.example` (and in
  `docker-compose.yml` if relevant for deployment). Never commit `.env` or secrets.
- **Never cause real side effects without asking**: payments, bookings, emails, messages to real users,
  writes to external services. Tests use fakes and fixtures; live checks are read-only. When running the
  app locally for a check, start from an empty data directory unless told otherwise, and stop it afterwards.
  What acts for real here: the Go agent sends real magic packets on the LAN (use `make agent-dry` /
  `-dry-run`) and real outputs once a hardware driver exists (only `sim` today); login providers are
  real external services (tests never contact them).
- **Development never uses production credentials or services**: use test accounts, test bots, sandbox
  keys and a separate database.

### Commits

- Small, step-by-step commits as the work progresses, never a single commit at the end. Conventional
  prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.
- **Exception, experiments:** while we're trying things out (styling, layouts, alternative approaches),
  don't commit. Commit only once I've picked the version to keep.
- Mockups and design alternatives are never committed: they only serve to choose; the chosen one lives in the code.
- Push, tag and release only when I ask.

### Keep the agent docs in sync, in the same change

`STRUCTURE.md` and this file exist so agents don't have to re-read the whole repo. When you add, move,
rename or delete a file or module, or change an API endpoint, env var, invariant, data format or workflow
command, update `STRUCTURE.md` / `AGENTS.md` (and `README.md` for user-facing changes) in the same commit
or right after. Before declaring work done, check that every path, name and value they mention for the
areas you touched still matches the code.

### Updating these guidelines

When I ask you to check for new guidelines, fetch the latest template from
https://github.com/jacopofilonzi/agents-guideline (raw files:
`https://raw.githubusercontent.com/jacopofilonzi/agents-guideline/main/{AGENTS,CLAUDE,STRUCTURE}.md`)
and align this project's copies with it:

- Bring in new and changed generic rules (workflow, commits, code, testing…) and drop the ones removed
  upstream, without asking.
- Keep everything project-specific: filled-in placeholders, invariants, recipes, pitfalls, the whole
  content of `STRUCTURE.md`, and rules this project added or deliberately changed.
- Ask only when an upstream change conflicts with the project's current style or guidelines (e.g. it
  contradicts a project-specific rule or a convention the code follows); list each conflict with both versions.
- Then summarize what changed and commit it as `docs: sync agent guidelines`.

## Invariants — don't break these

- **[docs/PROTOCOL.md](docs/PROTOCOL.md) is the only contract between server and agents**: agents are in
  other languages and share no code. Any change to the agent messages updates PROTOCOL.md,
  `backend/src/agents/protocol.ts` and the Go agent in the same change (the in-repo board agents, e.g.
  `agents/arduino-mkr-wifi-1010`, follow before the next release); breaking changes bump the
  protocol version (`PROTOCOL_VERSION` in `shared/src/index.ts`), since flashed microcontrollers can't
  be updated in lockstep with the server.
- **The server never knows the agents' hardware**: outputs are declared by the agent (id, mode, long
  press available, switch state). Pins, wiring and press durations stay in the agent's config.
- **Secrets are stored only as hashes** (sessions, agent tokens, password links, OAuth state: SHA-256;
  passwords: scrypt) and are never logged. A token is shown once, in the response that creates it.
  The only secrets the server must read back, login providers' client secrets, are sealed with
  `SECRET_KEY` (AES-256-GCM, `secrets.ts`) and never returned by the API.
- **Authorization**: anything a user can't see is `404 NOT_FOUND`, never `403` (ids of others' houses and
  devices are not confirmed). Device config (MAC, IP, agents), agent diagnostics (`Agent.details`) and per-agent results only for house
  owners/editors. Rules are in `backend/src/access.ts`; new routes go through `requireHouse` /
  `requireDevice`.
- **External identities are never matched by email**: only provider + subject. Matching by email would
  let whoever controls an email at any provider take over an account.
- **No background polling of devices**: probes run only on user request or in the check loop after an
  action (keeps agents and LAN quiet; microcontrollers have little headroom).
- When backend API models change, update `shared/src/api.ts` (the UI's types) in the same change.
- **Upgrading production never loses data or stops the service**. Durable data is not cache: IDs and
  formats stay backward compatible. Schema changes are migrations appended to `backend/src/db.ts`, never
  edits to one already released (pushed to `main`). A migration that touches existing rows gets a test
  that builds a database at the previous version with realistic data and migrates it. The app backs up
  the database before migrating and refuses to start if the backup fails. Anything the operator must do
  before deploying (env vars, manual steps) goes in the README upgrade notes.

## Code

- Everything is written in English (code, comments, commits, docs), except the language packs.
- Keep modules small and focused: one folder per area; split a file when it grows several responsibilities.
- Comments explain *why*, not *what*. Put the design of a non-trivial module in its top-level doc comment
  (upstream formats, invariants, data layout).
- Never ignore errors: wrap them with context. No `unwrap()`/`expect()`/unchecked casts on external data
  (network, files, user input).
- API errors carry a stable machine-readable `code` (and an English message for logs); the UI maps the
  code to its own text. User-facing text never comes from the backend error.
- Use the project's logger, never `println!`/`console.log`/`fmt.Println` in core logic.
- OS-specific code is isolated in one place (`platform/`, `_windows`/`_linux`/`_darwin` files); no
  branching on the OS elsewhere. Build paths with the language's path join, never by concatenating `/`.
- Reuse shared clients and connections (HTTP client, DB pool) instead of creating them per request.
- **Dependencies are recent majors whose APIs differ from most online examples:** check the docs for the
  installed version before using an API. Ask before adding a new dependency.
  TypeScript 7 (native compiler; the frontend stays on 6), Svelte 5, Vite 8, Tailwind 4, vite-plugin-pwa 2, zod 4, Hono 4 with `@hono/node-server` 2, openid-client 6 (functional
  API: `discovery`, `authorizationCodeGrant`, no `Issuer`/`Client` classes), Go agent: `coder/websocket`,
  `pro-bing`, `BurntSushi/toml`.
- Deleting user data means moving it to the trash / soft delete, unless agreed otherwise.

### UI

Design: "Sabbia", chosen from the mockups in `mockups/` (git-ignored; `g-soft.html`, variant sabbia): warm
low-chroma palette on a soft gradient backdrop, translucent `glass` panels, Manrope for text and Fraunces
for headings (`h1`/`h2`, `font-display`), Lucide icons. Keep colors muted, also in dark mode; the admin
area differs only by its accent (muted slate). Devices that are on "light up" (`--md-glow`).
On phones, menus and dialogs become bottom sheets and navigation is the floating dock.
Short creations and edits are dialogs (`components/Dialog.svelte`), not pages.

- Every UI string goes through i18n, with both the English and the Italian key (English is the
  default); the type check must catch a missing key.
- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props`): no legacy stores or `export let`.
  Typed state is `$state<T>(…)` (an annotated `let x: T = $state(…)` narrows to the initial value).
  Don't name a variable `state` (it clashes with the rune).
- Tailwind 4: reusable classes are `@utility` in the global CSS. Colours are semantic tokens defined there
  (`bg-surface`, `text-muted`…), never raw colours in the markup.
- API models come from the backend contract (shared or generated types): never redeclare them in the UI.
  Every call goes through one API module (base URL, auth headers, error codes).
- No external scripts from CDNs unless the platform requires them; libraries are npm packages, and heavy
  ones are loaded lazily.
- Never hard-code base paths or the API prefix: build URLs from the shared base constant.

## Testing

- Unit tests live next to the code (Go: `_test.go`). Backend tests are end-to-end over HTTP and WebSocket
  in `backend/test/`: a real server on a temp directory with fast timings, and `FakeAgent`
  (`backend/test/helpers.ts`) speaking the protocol. Test parsing against fixtures copied from real
  responses, never live requests; live checks, if any, are a separate opt-in command (e.g. `make smoke`).
- Before committing a fixture taken from a real response, replace names, emails, phones and any token or ID
  that grants access to something on its own. Never commit real user files (documents, tickets, uploads).
- End-to-end checks: drive the built app with a headless browser (Playwright with the system Chrome/Edge;
  install `playwright-core` in a scratch dir, not in the repo), unless the project has its own e2e setup.

## Versions and releases

- Versions are `x.y.z`: `x` major (only when I decide), `y` feature, `z` fix. A feature bumps `y` and resets `z`.
- The server version lives in `backend/src/version.ts` and `backend/package.json` (keep them equal); the
  Go agent gets its version from the build (`-X main.version=…`, set by `make agent-build` from git).
  The agent protocol has its own version (see the invariants).
- Tags and releases only when I ask.
- CI runs the checks and tests on every push and pull request, but builds and publishes artifacts (Docker
  images, binaries, installers) only on a `vX.Y.Z` tag or a manual run, never on a plain push.

## Adding a field to an API model

1. Change the type in `shared/src/api.ts` (and the schema in `shared/src/validation.ts`): the type check
   then points at every place to update.
2. Backend: migration in `backend/src/db.ts` (append, never edit a released one), the route's SQL and
   mapping (create **and** update), `backend/API.md`.
3. Frontend: every view that shows or edits the model.
4. Tests for the routes (valid value, invalid value, field missing on old rows); update `STRUCTURE.md`.

## Adding an agent for a new board

1. Create `agents/<board-name>/` with its own build system; implement docs/PROTOCOL.md (§12 checklist).
2. README: hardware, wiring of the outputs, build/flash, configuration; an example config without
   secrets. Add a row to `agents/README.md`.
3. Test it against `make dev` with a token from the API; outputs declared in `hello` must show up in
   `GET /api/houses/:id/agents`.

## Adding an output driver to the Go agent

Drivers (how an output is physically driven: `sim` today, GPIO later) live in `agents/go/internal/outputs/`
behind the driver interface; the protocol code does not change. Register the driver name accepted in
the config, validate its options at startup, test it without hardware.

## Adding a login provider preset

Providers are configured by admins in the UI and stored in the DB; any OIDC issuer needs no code. A
preset only prefills the form: an entry in `PRESETS` in `frontend/src/dialogs/ProviderDialog.svelte`
(plus its `<option>`). A provider that is not OIDC needs a new `ProviderType` (shared + DB `CHECK`, via a
migration) and its own branch in `backend/src/auth/oauth.ts` like GitHub.

## Known pitfalls

- The main dev machine is Windows 11; shells are PowerShell and Git Bash. Commands and scripts must work there.
- **Git Bash rewrites env values that look like paths** (`BASE_PATH=/x` becomes `C:/Program Files/Git/x`):
  prefix the command with `MSYS2_ENV_CONV_EXCL='*'`, or set the value in `.env`.
- A running `.exe` locks its binary on Windows: stop it before rebuilding.
- `USER` / `USERNAME` are set by the shell: Makefile variables use other names (`ACCOUNT=`).
- npm blocks esbuild's postinstall script; the build still works through its platform package.
- The frontend is on TypeScript 6 (svelte-check requires < 7) while the backend is on 7: don't unify them.
- The dev server listens on the LAN (`server.host: true` in `frontend/vite.config.ts`): board agents
  connect to `<PC LAN IP>:5173`. Keep it that way; a localhost-only Vite leaves them offline.
- In dev the UI is on :5173: set `PUBLIC_URL=http://localhost:5173` in `.env`, otherwise the Origin check
  rejects state-changing requests and login-provider redirects go to the wrong host.
- Svelte effects that call async loaders must `untrack` reads of state the loader updates (e.g. device
  statuses), or they loop.
- Test servers bind port 0 while `PUBLIC_URL` is `http://localhost`: tests send no `Origin`, so the
  Origin check passes. A test that sets `Origin` must use the configured `PUBLIC_URL`.
- Hono sub-apps are mounted at `/api` and share the path space: `requireUser` is applied per sub-app, so
  a route added to the wrong file may end up unauthenticated or doubly authenticated.
