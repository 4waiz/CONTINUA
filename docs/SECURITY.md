# CONTINUA - security posture

**CONTINUA is a research prototype. It has not been security-audited, it has not
been penetration-tested, and it should not be exposed to an untrusted network.**

The reference artwork carries the phrase "Secure by design". That is a product
slogan. It is **not** a claim that this codebase has been audited, and nothing in
this repository presents it as one.

---

## 1. Threat model

**In scope:** a locally-run research tool on a developer's machine. The concerns
that matter are (a) not letting a browser page drive privileged operations,
(b) not letting scenario input reach a shell, and (c) not committing secrets.

**Out of scope:** multi-tenant deployment, authentication, authorisation,
transport encryption, rate limiting, audit logging, supply-chain attestation.
None of these are implemented. If this were ever deployed beyond a workstation,
all of them would be required first.

---

## 2. Network exposure

* The engine binds **`127.0.0.1:8000`** by default (`CONTINUA_API_HOST`).
  Changing it is a deliberate act.
* CORS is restricted to `http://localhost:3000`, `http://127.0.0.1:3000` and
  `http://localhost:3001`. Credentials are **not** allowed
  (`allow_credentials=False`), and only `GET`, `POST` and `DELETE` are permitted.
* The frontend binds `localhost:3000`.
* No component opens an outbound connection. There is no telemetry, no analytics
  and no external API call anywhere in the engine or the app.

There is **no authentication**. Anything that can reach the port can start runs,
delete runs and launch experiments. That is acceptable for a loopback-bound
research tool and would not be acceptable anywhere else.

---

## 3. Input validation

Every request body is a Pydantic model with explicit bounds:

| Input | Constraint |
| --- | --- |
| `scenario_id` | Must exist in the fixed catalogue; anything else returns 404 |
| `policy_id` | Enum |
| `seed` | `0 … 2³¹−1` |
| `speed` | `0 … 64` |
| `predictor` | Regex `^(heuristic|learned|none)$` |
| `horizon_s` | `0.5 … 15` |
| `trials` | `1 … 200` |
| `block` | Regex `^(train|tune|test)$` |
| Control `action` | Regex `^(play|pause|reset|seek|speed|stop)$` |
| Scenario overrides | Every numeric field range-checked; `inject_fault` and `congest_link` are `LinkId` enums |
| Event pagination | `offset ≥ 0`, `limit ≤ 20 000` |

**No frontend value ever reaches a shell.** The only `subprocess` calls in the
project are:

1. `store.code_commit()` - a fixed `git rev-parse HEAD` argument list, no shell.
2. `emulation/capability.py` - fixed, hard-coded probe commands. Read-only.
3. `emulation/adapter.py` - invokes only the three fixed script paths under
   `scripts/emulation/`. No user input is interpolated into any of them.

Run identifiers are used as directory names. They are generated server-side
(`uuid4` hex) and never taken from the client for path construction.

---

## 4. Privileged operations

Emulation requires root to create network namespaces and qdiscs. The design
rules:

* **Privileged operations require explicit operator approval.** The adapter never
  escalates on its own; it calls `sudo -n`, which fails rather than prompting,
  and reports the failure.
* The adapter **refuses to run at all** unless `capability.probe()` confirms every
  required capability is present. There is no "try anyway" path.
* The topology scripts:
  * create only `continua-`/`cnt-` prefixed namespaces and devices;
  * **never modify the host default route** - routes are added inside namespaces
    only;
  * **never modify the host firewall** - no `iptables`/`nftables` rules at all;
  * never touch an interface outside the topology;
  * are idempotent, and `cleanup.sh` removes exactly what `setup.sh` created.
* `verify.sh` reports what the kernel actually negotiated. A plain-TCP fallback
  is recorded as plain TCP, never counted as MPTCP.

**On the development host these scripts have not been executed** - passwordless
sudo is unavailable and the kernel lacks `CONFIG_MPTCP`. See
`data/emulation_capability.json`.

---

## 5. Secrets

* No credentials exist in this project. There is nothing to authenticate to.
* `.env*` is git-ignored except `.env.example`, which contains only placeholders
  and local tool paths.
* The checkpoint supervisor screens every staged file for GitHub, AWS, Google,
  Slack, OpenAI and Anthropic token shapes, private-key blocks and hardcoded
  credential assignments, and refuses the commit if it finds one.
* Run data under `data/runs/` is git-ignored. Aggregate experiment results and
  the capability report are tracked as evidence and contain no secrets.

---

## 6. Data handling

* All data is synthetic. No personal data, no real network captures, no operator
  data of any kind is collected, stored or transmitted.
* Runs are written to `data/runs/<run_id>/` as JSONL plus a manifest. Deleting a
  run through the API removes the directory and the database row.
* SQLite is accessed only through parameterised statements.

---

## 7. Known weaknesses

Stated rather than left to be discovered:

1. **No authentication or authorisation.** Loopback binding is the only control.
2. **No rate limiting.** A caller can start experiments until the machine is
   saturated; the only mitigation is a cap of 4 concurrent live sessions.
3. **Unbounded run storage.** Nothing prunes `data/runs/`.
4. **`api.getRunEvents` loads a whole run into memory** before slicing.
5. **The WebSocket is unauthenticated** and any local process can subscribe to
   any run.
6. **Dependencies are pinned but not audited.** No SBOM, no signature
   verification, no vulnerability scanning in CI.
7. **The `__CONTINUA__` and `__CONTINUA_CAPTURE__` debug handles** expose the
   clock, source and renderer to any script on the page. Deliberate, for testing
   and capture; it would need removing before any deployment.

---

## 8. If this were to be deployed

Not a roadmap - a statement of what is missing:

authentication and per-user authorisation; TLS; rate limiting and quotas; run
storage limits and retention; structured audit logging; CSRF protection on the
control endpoints; dependency scanning and an SBOM; removal of the debug
handles; and an actual security review by someone who did not write it.
