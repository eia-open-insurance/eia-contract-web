# Implementation state

The remote is a single federated React application exposed as `./App`. It follows
the shared EIA operational record design: the canonical `src/ui.css` is copied
from the shell and imported once, with a small `src/ui-overrides.css` for
contract-specific compatibility. It holds no business logic: every action calls
the domain service.

## Screens

The workbench keeps the contract register visible on the left and renders the
selected record on the right.

| Screen | Behaviour |
|---|---|
| Register | Lists contracts with number, cedent, reinsurer, and status; selecting one opens it and pushes `?record={id}` |
| Queue filter | Prominent client-side filter over number, type, cedent, and status, with a result count and Clear action |
| Create contract | Primary header action (`?new=1`); opens a compact create form for a draft contract with predictive cedent/reinsurer `EntityPicker`s backed by `/api/v1/parties/search` |
| Overview | Contract facts with party cross-links, lifecycle transition, bind preconditions, the "Why this matters" context panel, related assumed claims/retrocessions, and linked documents |
| Layers | List and add layers (number, type, attachment, limit, basis, currency, effective dates, tower note) |
| Participants | List and add participations; shows the risk-bearing share total per layer and whether it is balanced |
| Terms | List and add terms with a term code, value, source clause, and effective dates |
| Security | Collateral records with summary totals and active/released counts, a full table, a create form, and confirmed Release/Expire actions |
| Cessions | List and record cessions with policy/claim references and ceded premium/loss |
| Technical accounts | Period statements newest period first, with ceded premium/loss/commission totals, an issued-only outstanding balance, a create form with a computed balance preview, and confirmed Issue/Settle actions |
| Cash calls | Interim funding requests newest period first with requested/issued counts, issued and settled amounts, overdue due dates, a create form, confirmed Issue/Cancel actions, a reference-required Settle dialog with settled-reference display, and an ISSUED-only Payment hand-off link |
| Bordereaux | Cedent period submissions newest period first with received/processed counts, premium/loss/line totals, a create form, and confirmed Process/Fail actions; processed rows link to the technical account they created |
| Commutation | Propose, approve, and execute a commutation |
| Activity | Event-derived, append-only timeline for the selected contract |

The selected-contract header shows the contract number, status, bound state, and
the **Bind contract** action. Bind readiness comes from
`GET /api/v1/contracts/{id}/bind-eligibility`; the action is enabled only when the
contract is PLACED and every check passes. The summary grid shows the tower limit,
ceded premium, ceded loss, and the risk-bearing participant share total.

Money and percentages are rendered as the API returns them (decimal strings), so
no precision is lost in the browser. Errors are shown as `CODE: message` from the
structured error body.

Record discovery is URL-driven. The remote reads `?record={id}` and `?new=1` on
mount and listens for `popstate`; selecting a contract, opening create, and
cancelling create update the URL through a small `src/navigation.js` helper
(`pushState` plus a `PopStateEvent`, with `window.location.assign` as the
fallback). The queue filter is client-side over the loaded register. The create
form shows the selected party number/name and links to `/party?record={id}`.
Overview links the cedent and reinsurer, explains that assumed claims and
retrocessions attach to the contract while actual cessions remain FS-RI-owned,
and fetches related records from
`/api/v1/assumed-claims/search?q={contractId}&limit=5` and
`/api/v1/retrocessions/search?q={contractId}&limit=5` with the ASSUMED book
header. The selected contract's cedent and reinsurer are resolved through
`GET /api/v1/parties/{id}` (tenant plus ASSUMED book headers); the header,
Overview, and related-records panel show `displayName · partyNumber` links to
`/party?record={id}`, falling back to the short UUID while a lookup loads or
fails, without blocking the contract record.

The Overview **Documents** card fetches
`GET /api/v1/documents?linkedType=CONTRACT&linkedId={id}` with the tenant header
after the contract is on screen. It accepts either a bare array or an
`{ items }` page, shows the document count and each document's number (linked to
`/document?record={id}`), title, type, and status, and renders a local empty
state and an evidence note ("documents are evidence, not business facts").
Loading and failure are card-local: a slow or unavailable Document API never
blocks or fails the contract render, and the existing related-record cards keep
their state.

The **Activity** tab shows the event-derived timeline for the selected contract.
Selecting a record fetches `GET /api/v1/events/aggregate/{contractId}?limit=50`
with the tenant header, accepts either a bare array or an `{ items }` page, and
renders newest first: timestamp, readable event type, event delivery status, the
aggregate version, and the payload facts a contract user needs — the status
transition, bind approval, recorded cession with ceded premium/loss, and
commutation type, basis, agreed amount, and effective date. The card owns its
loading, error, empty, and refresh states and carries an
event-derived/append-only note: the contract record stays the source of truth,
so a slow or unavailable event service never blocks the record.

The **Technical accounts** tab reads
`GET /api/v1/contracts/{contractId}/technical-accounts` with the tenant header and
sorts the statements newest period first by period end (then period start and
account number). Each row shows the account number, period, ceded premium, ceded
losses, commission, balance, status, and the one available action: a DRAFT can
be **issued** and an ISSUED statement can be **settled**. Both actions ask for
confirmation and then PATCH
`/api/v1/contracts/{contractId}/technical-accounts/{accountId}/status` with
`{ "status": "ISSUED" }` or `{ "status": "SETTLED" }`; a dismissed confirmation
sends nothing. The create form posts `periodStart`, `periodEnd`, `currency`,
`cededPremium`, `cededLosses`, `commission`, and `otherCharges` to the collection
path as 4-dp decimal strings and previews the balance as ceded premium minus
ceded losses and commission, plus other charges; a positive balance is due to the
reinsurer. Five summary cards total ceded premium, ceded losses, commission, the
outstanding balance of ISSUED statements only, and the account count. The tab
carries a statement context note — a technical account is a period statement,
the contract remains the source of its terms, and FS-RI/SAP own the posted
amounts — and contains load, create, and conflict failures locally so the
contract record stays usable.

Each technical-account row expands through a chevron button. The expanded panel
reads `GET /api/v1/contracts/{contractId}/technical-accounts/{accountId}/lines`
with the tenant header and shows the statement lines (type, reference,
description, amount, and delete), a totals-by-type table, a totals-by-bucket
table, and a reconciliation table comparing each header component with its
bucket of line types and the derived balance. The add form offers the full
SPEC 11.3.4 line-type domain — PREMIUM, COMMISSION, BROKERAGE, PAID_LOSS,
OUTSTANDING_LOSS, IBNR, ALAE, REINSTATEMENT, CASH_CALL, FUNDS_WITHHELD, TAX,
ADJUSTMENT, and OTHER — and every type rolls into one of four buckets:
PREMIUM → premium; PAID_LOSS, OUTSTANDING_LOSS, IBNR, ALAE, REINSTATEMENT, and
CASH_CALL → loss; COMMISSION and BROKERAGE → commission; FUNDS_WITHHELD, TAX,
ADJUSTMENT, and OTHER → other. The rows keep their human labels. The reconciled
indicator follows CTR-08: every component and the balance must match within
0.01. A DRAFT statement shows the add form for line type, reference, description,
and amount and posts
`{ lineType, reference?, description?, amount }` with the amount as a 4-dp
decimal string; a line is deleted with `DELETE …/lines/{lineId}` after
confirmation. ISSUED and SETTLED statements expose no add form or delete action
and show their lines read-only. If the Issue PATCH returns
`409 ACCOUNT_LINES_DO_NOT_RECONCILE`, the expanded detail shows the service's
code and message plus the per-component header/lines difference (the public
domain proxy may omit the expert's field violations), while the row keeps its
DRAFT status; a later line change clears that conflict. A failed line list stays
inside the expanded panel and never blocks the account table.

The **Cash calls** tab (directly after Technical accounts) reads
`GET /api/v1/contracts/{contractId}/cash-calls` with the tenant header and sorts
the requests newest period first by period end (then period start and call
number). Each row shows the call number, period, amount and currency, due date,
status, settlement reference, notes, and the lifecycle actions: a REQUESTED call
can be **issued** or **cancelled**, and an ISSUED call can be **settled** or
handed to Payment. Issue and cancel ask for confirmation and then PATCH
`/api/v1/contracts/{contractId}/cash-calls/{cashCallId}/status` with
`{ "status": "ISSUED" }` or `{ "status": "CANCELLED" }`; a dismissed confirmation
sends nothing. **Settle** opens a modal instead of a browser confirmation. The
modal requires a payment/settlement reference, rejects a blank or overlong
reference locally, and PATCHes `{ "status": "SETTLED", "reference": "…" }`; on
success the dialog closes, the panel reloads, and the settled row shows the
reference (the submitted value is retained locally until the service echoes it).
A settled call with no recorded reference shows an em dash. **Create payment**
appears only on ISSUED calls and is a cross-remote hand-off to
`/payment?new=1&sourceType=CONTRACT_CASH_CALL&sourceId={cashCallId}&sourceReference={callNumber}&amount={amount}&currency={currency}[&payeeName={cedent}]`,
using the contract's resolved cedent display name when one is available. It opens
Payment's create form; it neither creates nor settles a Payment. The create form
posts `periodStart`, `periodEnd`, `amount` (strictly positive, as a 4-dp decimal
string), `currency`, `dueDate`, and optional `notes` to the collection path. Five
summary cards show the requested count, issued count, outstanding issued amount
(ISSUED only), settled amount, and the number of open calls whose due date has
passed. The tab carries a context note and the settle dialog explains that the
settlement reference ties the call to the treasury Payment, that Payment and FS-RI
own execution, and that creating a payment does not settle the call. Load,
create, status, and 409 failures stay local so the contract record stays usable; a
409 on a status command reloads the row so it reflects whatever state won the
race.

The **Security** tab reads `GET /api/v1/contracts/{contractId}/security` with the
tenant header and shows the collateral held against the contract: security type,
required amount, held amount, currency, provider party, expiry date, approval
reference, status, and action, in the service's newest-first order. The create
form posts `securityType`, `requiredAmount` (strictly positive, as a 4-dp decimal
string), optional `heldAmount` (zero or greater, 4-dp), `currency`, optional
`providerPartyId`, `expiryDate`, and `approvalRef` to the collection path; the
service derives the initial status. Five summary cards show the required total,
held total, outstanding gap (required minus held), the count of records not yet
RELEASED or EXPIRED, and the RELEASED count. **Release** and **Expire** are
available on every non-terminal record, ask for confirmation, and PATCH
`/security/{securityId}/status` with `{ "status": "RELEASED" }` or
`{ "status": "EXPIRED" }`; a dismissed confirmation sends nothing and both
outcomes are terminal. The tab carries a collateral context note — security is
collateral, not cash and not a Payment, and releasing a record does not create a
Payment — and contains load, create, status, and 409 failures locally so the
contract record stays usable; a 409 on a status command reloads the collection so
the row reflects whatever state won the race.

The **Bordereaux** tab reads `GET /api/v1/contracts/{contractId}/bordereaux`
with the tenant header and sorts the submissions newest period first by period
end (then period start and bordereau number). Each row shows the bordereau
number, period, received date, line count, premium, loss, commission, status,
the linked technical account, and the actions. A RECEIVED submission can be
**processed** or **failed**; both outcomes are terminal and show no action. The
create form posts `periodStart`, `periodEnd`, `receivedDate` (the chosen
calendar date), `currency`, `premiumAmount`, `lossAmount`, `commissionAmount`,
`otherChargesAmount`, `lineCount`, and `notes` to the collection path as 4-dp
decimal strings for the amounts; an inverted period, a missing received date, a
bad currency, or a negative amount is rejected locally before anything is sent.
**Process** asks for confirmation and PATCHes `/bordereaux/{bordereauId}/status`
with `{ "status": "PROCESSED" }`; the refreshed row resolves the linked
`technicalAccountId` to its account number, and the success message links to the
Technical accounts tab. **Fail** opens a compact form with an optional note (400
characters) and PATCHes the same path with `{ "status": "FAILED", "notes": "…" }`,
omitting the notes key when blank. Five summary cards total the received count,
the processed count, premium, loss, and submitted lines. The tab carries a submission context note —
a bordereau is the cedent's period submission, processing creates the technical
account, and the contract remains the source of its terms — and contains load,
create, and conflict failures locally so the contract record stays usable; a
409 on a status command reloads the row so it reflects whatever state won the
race.

## Tests

`tests/contract.spec.js` (operational layout and create via the primary action),
`tests/layers-participants.spec.js` (stateful mocked API: record layer, record
participants, watch the balance and bind enablement, bind; then an over-100%
rejection), `tests/cession.spec.js` (record a cession, then a capacity
rejection), and `tests/discovery.spec.js` (deep-link and popstate record
selection, `?new=1`, queue filtering, both predictive party pickers and their
POST payload, party-label resolution and fallback, and the Overview
cross-links/related records). `tests/documents.spec.js` covers the linked-document
query and tenant header, document links, refetching on selection, the empty
state, a contained error, and rendering the contract while the Document API is
still in flight. `tests/activity.spec.js` covers the aggregate path and tenant
header, newest-first ordering and rendering, the empty state, a contained 503,
the contract payload facts, refetching on selection, and the card refresh.
`tests/technical-accounts.spec.js` covers the newest-period-first listing and
summary totals (issued-only outstanding balance), the create form's local period
validation and exact POST payload with the computed balance preview, the
confirmed issue/settle PATCH payloads (including a dismissed confirmation), the
empty state and context note, a contained load failure, and a 409 duplicate-period
response that preserves the form. It also covers expanding a row to list the
lines with the tenant header and totals by type, the reconciled indicator, adding
a line with its exact POST payload and the reconciliation recomputation, deleting
a line only after confirmation with its exact DELETE path, the immutable lines of
an issued statement, and a 409 `ACCOUNT_LINES_DO_NOT_RECONCILE` issue that shows
the service detail and leaves the row DRAFT. `tests/cash-calls.spec.js` covers the
newest-period-first listing with the requested/issued counts, issued and settled
amounts, overdue due dates, correct actions and status tones, and the context
note; the create form's local period/positive-amount validation and exact POST
payload with notes; the confirmed issue/settle PATCH payloads (including a
dismissed confirmation); the confirmed cancel PATCH and its terminal state; the
loading, empty, and contained load-failure states; a 409 status race that reloads
the row; and a 409 create conflict that preserves the form.
`tests/bordereaux.spec.js` covers the newest-period-first listing with the linked
technical account and summary
counts/totals, the create form's local period validation and exact POST payload
(received date, amounts, lines, notes), the confirmed process PATCH and its
linked-account message/tab navigation, fail with and without a note, the empty
state and context note, a contained load failure, a 409 duplicate submission
that preserves the form, and a 409 process race that reloads the terminal row.
`tests/security.spec.js` covers the summary totals and active/released counts, all
table columns and status tones, terminal rows without actions, the create form's
local amount validation and exact POST payload with the collateral fields, the
confirmed release and expire PATCH payloads (including a dismissed confirmation),
the empty state and collateral context note, a contained load failure, and both a
create 409 that preserves the form and a status 409 that reloads the row.
Run with `npm test`; the Playwright config starts the dev server on port 3003.

## Remaining gaps

- No edition of child rows. Statement lines on a DRAFT technical account can be
  added and deleted, but not edited; other child rows are read-only.
- The commutation tab requires the release document id to be pasted; there is no
  document picker.
- No accessibility audit beyond semantic labels and pressed tab state.
- Pagination, optimistic concurrency headers, and idempotency keys are not used
  by the remote (see MISMATCHES M-04, M-06, M-07).
