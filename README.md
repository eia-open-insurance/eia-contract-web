# eia-contract-web

- GitHub organization: `eia-open-insurance`
- Repository URL: https://github.com/eia-open-insurance/eia-contract-web
- Type: Federated front-end
- Deployable: Yes
- Owner: Contract
- Runtime: React 19 and Webpack 5
- Data store: None
- Depends on: eia-frontend/packages, eia-contracts, eia-platform/gateway

## Purpose

Contract federated remote: screens, widgets, record tabs, and transaction composition. Reinsurance contract administration, layers, participations, accounts, and bordereaux.

## Implemented slice

The remote follows the shared EIA operational record design (`src/ui.css`, copied
from the shell): a page header with the assumed-book badge and primary **Create
contract** action, a contract register on the left, and a selected-contract panel
with status and bound state, the bind action, a limit/premium/loss/share summary,
and tabs for Overview, Layers, Participants (with the share balance per layer),
Terms, Security, Cessions, Technical accounts, Cash calls, Bordereaux, and
Commutation (propose, approve, execute). The Overview tab lists the bind
preconditions from `GET /api/v1/contracts/{id}/bind-eligibility`; **Bind
contract** is enabled only when the contract is PLACED and every check passes.

Record discovery is URL-driven: `?record={id}` selects a contract and `?new=1`
opens the create form (the remote listens for `popstate`, so shell global-search
results and browser history both land on the right record). A prominent queue
filter narrows the register by contract number, type, cedent, or status without
a round trip. The create form uses the shared predictive `EntityPicker` against
`/api/v1/parties/search` for the cedent and reinsurer, shows the party number and
name, and links the selected party to `/party?record={id}`. For the selected
contract, the header, Overview, and related-records panel resolve both roles
through `GET /api/v1/parties/{id}` and link `displayName · partyNumber` text to
`/party?record={id}`; the short UUID stays visible while a lookup loads or fails.
Overview explains that assumed claims and retrocessions attach to the contract
while actual cessions remain FS-RI-owned, and lists related assumed claims and
retrocessions found through their search endpoints. A **Documents** card also
lists the documents linked to the selected contract from
`GET /api/v1/documents?linkedType=CONTRACT&linkedId={id}`: the count, document
number (linked to `/document?record={id}`), title, type, and status, with an
empty state and an evidence note. Documents are evidence and never change the
contract; a slow or failing Document API renders inside the card without
blocking the record.

A **Related notifications** card lists the Notifications messages whose
`sourceType`/`sourceId` point at the selected contract from
`GET /api/v1/notifications?sourceType=CONTRACT&sourceId={id}`: the total count
and the three newest notifications with their number, subject, delivery status,
and creation time (newest first). Each notification number opens its record at
`/notifications?record={id}`, and **View all notifications** opens the
Notifications queue filtered to this contract
(`/notifications?sourceType=CONTRACT&sourceId={id}`). An empty state and a
delivery-artifact note are local to the card; a slow or failing Notifications API
renders inside it and never blocks the contract record.

The **Technical accounts** tab lists the selected contract's period statements
newest period first from `GET /api/v1/contracts/{id}/technical-accounts`, with
the account number, period, ceded premium, ceded losses, commission, balance,
status, settlement reference, and action. A create form posts the period
start/end, currency, ceded premium, ceded losses, commission, and other charges
to the same path and shows the computed balance preview (`ceded premium − ceded
losses − commission + other charges`). Summary cards total ceded premium, ceded
losses, commission, the outstanding balance of ISSUED statements only, and the
account count. **Issue** (DRAFT → ISSUED) is a confirmed PATCH to
`/technical-accounts/{accountId}/status`. **Settle** (ISSUED → SETTLED) opens a
modal that requires a payment/settlement reference and PATCHes
`{ "status": "SETTLED", "reference": "…" }`; the settled row and its expanded
detail then show that reference. Each account row also expands to show
its statement lines from
`GET /api/v1/contracts/{id}/technical-accounts/{accountId}/lines`: type,
reference, description, amount, and delete, with totals grouped by line type and
by the four financial buckets (premium, loss, commission, other), a
header-versus-lines reconciliation table, and a reconciled indicator at the
CTR-08 0.01 tolerance. The add form offers the full line-type domain — PREMIUM,
COMMISSION, BROKERAGE, PAID_LOSS, OUTSTANDING_LOSS, IBNR, ALAE, REINSTATEMENT,
CASH_CALL, FUNDS_WITHHELD, TAX, ADJUSTMENT, and OTHER — each displayed with a
human label and rolled into its bucket for the header reconciliation. A DRAFT
statement can add a line (type, reference, description, amount) and delete one;
ISSUED and SETTLED statements are read-only.
If Issue returns `409 ACCOUNT_LINES_DO_NOT_RECONCILE`, the expanded detail shows
the service's explanation while the statement stays DRAFT. A context note
explains that a technical account is a period statement, the contract remains
the source of its terms, FS-RI/SAP own the posted amounts, and a DRAFT's lines
must reconcile before issue; it also explains that the settlement reference ties
the statement to the treasury settlement in Payment and does not create or
execute a Payment. Load failures stay inside the tab and never block
the contract record.

The **Cash calls** tab sits directly after Technical accounts and lists the
selected contract's interim funding requests newest period first from
`GET /api/v1/contracts/{id}/cash-calls`, with the call number, period,
amount/currency, due date, status, settlement reference, notes, and action. A
create form posts the period start/end, amount, currency, due date, and optional
notes to the same path; the amount must be positive and is sent as a 4-dp decimal
string. Summary cards show the requested count, issued count, outstanding issued
amount, settled amount, and the number of open calls whose due date has passed.
**Issue** and **Cancel** are the alternatives for a REQUESTED call; an ISSUED call
exposes **Settle** and **Create payment**. **Settle** opens a modal that requires a
payment/settlement reference and PATCHes `/cash-calls/{cashCallId}/status` with
`{ "status": "SETTLED", "reference": "…" }`; the settled row then shows that
reference. **Create payment** is a cross-remote hand-off to
`/payment?new=1&sourceType=CONTRACT_CASH_CALL&sourceId=…&sourceReference=…&amount=…&currency=…&payeeName=…`
using the resolved cedent as the payee when available. It opens Payment's create
form and does not settle the call. A context note and the settle dialog explain
that the settlement reference ties the call to the treasury payment, that Payment
and FS-RI own execution, and that creating a payment does not settle the call.
Load, create, status, and 409 failures stay inside the tab and never block the
contract record.

The **Security** tab lists the collateral held against the selected contract from
`GET /api/v1/contracts/{id}/security`, with the type, required and held amounts,
currency, provider party, expiry date, approval reference, status, and action. A
create form posts the security type, required and held amounts, currency,
provider party id, expiry date, and approval reference to the same path; amounts
are 4-dp decimal strings and the status is derived by the service. Summary cards
show the required total, held total, outstanding gap (required minus held), the
active count, and the released count. **Release** and **Expire** are confirmed
PATCHes to `/security/{securityId}/status` with `{ "status": "RELEASED" |
"EXPIRED" }`; a dismissed confirmation sends nothing and both outcomes are
terminal. A context note explains that security is collateral, not cash, and is
not a Payment, and that releasing a record does not create a Payment. Load,
create, status, and 409 failures stay inside the tab and never block the contract
record.

The **Bordereaux** tab lists the cedent's period submissions newest period first
from `GET /api/v1/contracts/{id}/bordereaux`, with the bordereau number, period,
received date, line count, premium, loss, commission, status, linked technical
account, and action. A create form posts the period start/end, received date,
currency, premium, loss, commission, other charges, line count, and notes to the
same path. Summary cards total the received and processed counts, premium, loss,
and submitted lines. A **Process** action on a RECEIVED submission PATCHes
`/bordereaux/{bordereauId}/status` with `{ "status": "PROCESSED" }` and shows the
technical account the service creates; **Fail** PATCHes the same path with
`{ "status": "FAILED" }` and an optional note. PROCESSED and FAILED submissions
are terminal and show no action. A context note explains that a bordereau is the
cedent's period submission, processing creates a technical account, and the
contract remains the source of its terms. Load, create, status, and 409 failures
stay inside the tab and never block the contract record.

`npm start` serves the remote on port 3003 with `/api` proxied to the domain
service on 8086. `npm test` runs the Playwright suite covering create,
layer/participant/bind, the over-100% share rejection, the cession/capacity flow,
record discovery (deep links, queue filtering, predictive party lookup,
party-label resolution and fallback, and cross-links), and linked-document
visibility (query and tenant header, document links, empty state, contained
error, and non-blocking fetch), related notifications (source query and tenant
header, newest-three preview and count, record and filtered-queue links,
refetching on selection, empty state, contained error, and non-blocking fetch),
plus technical accounts (newest-first listing,
create payload and balance preview, confirmed issue, the reference-required
settle modal with its SETTLED payload and row/detail reference display, expandable
statement lines with totals and reconciliation, line add/delete payloads,
immutable issued lines, empty, load-error, duplicate-period 409, settlement
service-error, and line-reconciliation 409 states), cash calls (newest-first
listing and summary
counts/amounts/overdue due dates, create payload and local period/amount
validation, confirmed issue and cancel payloads, the required settlement
reference and its SETTLED payload/row display, the ISSUED-only Payment hand-off
link and its query parameters, empty, load-error, and create/status 409 states),
security (summary totals and active/released counts, all table columns, create
payload and local amount validation, confirmed release/expire payloads, empty,
load-error, and create/status 409 states), and bordereaux (newest-first listing
and summary
counts/totals, create payload and local period validation, confirmed process
with the linked technical account, fail with and without a note, empty,
load-error, and create/status 409 states). `IMPLEMENTATION.md` records the
screens, tests, and remaining gaps.

## Responsibilities

- Keep this repository focused on one deployable component or one platform concern.
- Follow the repository standard in `../CONVENTIONS.md` and the specification in `../../SPEC.md`.
- Publish and consume contracts through `eia-contracts`.
- Maintain README, CODEOWNERS, SECURITY, CHANGELOG, tests, and local verification.
- Contain no business logic in shared libraries or front-end remotes.

## Verification

- Lint and format
- Unit tests with 100% business-logic coverage where applicable
- Contract tests
- Integration or Playwright tests where applicable
- Security scan and SBOM
- Build and publish

## Notes

No business logic; all actions go through the domain service.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
