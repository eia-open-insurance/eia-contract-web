# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Tabbed workbench for layers, participants, terms, security, cessions,
  bordereaux, and commutation, with a selected-contract header showing the bind
  preconditions and bind action.
- Participant share balance per layer and a share-total indicator.
- URL record discovery: `?record={id}` opens a contract, `?new=1` opens the
  create form, and `popstate` keeps the workbench in step with shell navigation.
- Prominent client-side queue filter over contract number, type, cedent, and
  status, with a result count and Clear action.
- Predictive cedent and reinsurer selection in the create form, backed by
  `/api/v1/parties/search`, with party number/name display and `/party?record=`
  cross-links.
- Overview cross-links, a "Why this matters" context panel, and related assumed
  claims and retrocessions from their search endpoints.
- Cross-link transparency: the selected contract resolves its cedent and
  reinsurer through `GET /api/v1/parties/{id}` with tenant and ASSUMED book
  headers, and the header, Overview, and related-records panel render
  `displayName · partyNumber` links to `/party?record={id}`. The short UUID stays
  visible while a lookup loads or fails, so the contract record is never blocked.
- Playwright coverage for the layer/participant/bind flow and the cession flow,
  including the over-100% and over-capacity rejections, plus record discovery,
  queue filtering, both party pickers, party-label resolution and fallback, and
  the cross-links.
- Linked-document visibility: selecting a contract fetches
  `GET /api/v1/documents?linkedType=CONTRACT&linkedId={id}` with the tenant
  header, and an Overview **Documents** card shows the document count plus each
  document's number, title, type, and status, with the number linking to
  `/document?record={id}`. An empty state and an evidence note are always shown;
  a Document API failure stays inside the card and never blocks the contract
  record.
- Playwright coverage for the linked-document query and tenant header, document
  links, the empty state, a contained document error, refetching on selection,
  and rendering the contract while the Document API is still in flight.
- Event-derived **Activity** tab: selecting a contract fetches
  `GET /api/v1/events/aggregate/{contractId}?limit=50` with the tenant header and
  renders a newest-first timeline of timestamp, readable event type, event
  status, version, and the payload facts a contract user needs — status
  transition, bind approval, cession number and amounts, and commutation type,
  basis, agreed amount, and effective date. The card carries its own loading,
  error, empty, and refresh states plus an event-derived/append-only/source-of-
  truth note, so a slow or unavailable event service never blocks the record.
- Playwright coverage for the aggregate path and tenant header, newest-first
  ordering and rendering, the empty state, a contained 503, the contract payload
  facts, refetching on selection, and the card refresh.
- **Technical accounts** tab: lists the selected contract's period statements
  newest period first with account number, period, ceded premium, ceded losses,
  commission, balance, status, and action; a create form posts period start/end,
  currency, ceded premium, ceded losses, commission, and other charges and shows
  the computed balance preview (ceded premium − ceded losses − commission + other
  charges); summary cards total ceded premium, ceded losses, commission, the
  outstanding balance of ISSUED statements only, and the account count. **Issue**
  (DRAFT → ISSUED) is a confirmed PATCH to
  `/api/v1/contracts/{contractId}/technical-accounts/{accountId}/status`. A
  context note states that a technical account is a period statement, the
  contract remains the source of its terms, and FS-RI/SAP own the posted amounts.
- Playwright coverage for technical accounts: newest-first listing and summary
  totals, create payload and balance preview, the confirmed issue payload,
  the empty state and context note, a contained load failure, and a 409
  duplicate-period response that preserves the form.
- Technical-account statement lines: each account row expands to list its lines
  from `GET /api/v1/contracts/{contractId}/technical-accounts/{accountId}/lines`
  with type, reference, description, amount, and delete, plus totals by line type
  and by the four financial buckets (premium, loss, commission, other), a
  header-versus-lines reconciliation, and a reconciled indicator using the CTR-08
  0.01 tolerance. The add form offers PREMIUM, COMMISSION, BROKERAGE, PAID_LOSS,
  OUTSTANDING_LOSS, IBNR, ALAE, REINSTATEMENT, CASH_CALL, FUNDS_WITHHELD, TAX,
  ADJUSTMENT, and OTHER with human labels; each type maps to one bucket for the
  reconciliation (BROKERAGE to commission; REINSTATEMENT and CASH_CALL to loss;
  FUNDS_WITHHELD, TAX, ADJUSTMENT, and OTHER to other). A DRAFT statement can add
  a line with `POST …/lines` and delete one with `DELETE …/lines/{lineId}`;
  ISSUED and SETTLED statements are read-only. If issue returns
  `409 ACCOUNT_LINES_DO_NOT_RECONCILE`, the expanded detail shows the service's
  explanation and expected/actual detail while the statement stays DRAFT.
  Playwright coverage covers expand/list, every add-line option and its bucket,
  add payloads, delete, the immutable issued state, and the reconciliation 409.
- Technical-account settlement reference: **Settle** now opens a modal that
  requires a payment/settlement reference and PATCHes
  `{ "status": "SETTLED", "reference": "…" }`; the settled row and its expanded
  detail show the reference. The context note and settle dialog explain that the
  reference ties the statement to the treasury settlement in Payment and that
  recording it does not create or execute a Payment. Playwright coverage adds
  required-reference validation, the exact SETTLED payload, row and detail
  reference display, and a contained settlement service error.
- **Cash calls** tab, directly after Technical accounts: lists the selected
  contract's interim funding requests newest period first from
  `GET /api/v1/contracts/{id}/cash-calls`, with call number, period,
  amount/currency, due date, status, notes, and action. A create form posts the
  period start/end, a strictly positive amount, currency, due date, and optional
  notes. Summary cards show the requested and issued counts, the outstanding
  issued amount, the settled amount, and the number of open calls past their due
  date. Confirmed **Issue** and **Cancel** actions on a REQUESTED call and
  **Settle** on an ISSUED call PATCH
  `/api/v1/contracts/{contractId}/cash-calls/{cashCallId}/status`. A context note
  states that a cash call requests funding from the cedent or reinsurer, is not a
  Payment, and that Payment and FS-RI own execution.
- Playwright coverage for cash calls: newest-first listing with summary counts,
  issued/settled amounts, overdue due dates, status tones, actions, and the
  context note; create payload and local period/positive-amount validation;
  confirmed issue, settle, and cancel payloads; loading, empty, contained
  load-failure, and 409 states.
- Cash-call settlement reference and Payment hand-off: **Settle** now opens a
  modal that requires a payment/settlement reference and PATCHes
  `{ "status": "SETTLED", "reference": "…" }`; settled rows show the reference.
  ISSUED calls expose **Create payment**, a
  `/payment?new=1&sourceType=CONTRACT_CASH_CALL&sourceId=…&sourceReference=…&amount=…&currency=…&payeeName=…`
  hand-off that uses the contract's resolved cedent as the payee when available.
  The context note and settle dialog explain that the reference ties the call to
  the treasury payment and that creating a payment does not settle the call.
  Playwright coverage adds required-reference validation, the exact SETTLED
  payload, settled-row reference display, and the ISSUED-only link and query
  parameters.
- **Bordereaux** tab: lists the selected contract's cedent period submissions
  newest period first with bordereau number, period, received date, line count,
  premium, loss, commission, status, linked technical account, and action. A
  create form posts period start/end, received date, currency, premium, loss,
  commission, other charges, line count, and notes. Summary cards total the
  received and processed counts, premium, loss, and submitted lines. Confirmed
  **Process** (RECEIVED → PROCESSED) PATCHes
  `/api/v1/contracts/{contractId}/bordereaux/{bordereauId}/status`, shows the
  technical account it creates, and links to the Technical accounts tab;
  **Fail** PATCHes the same path with FAILED and an optional note. PROCESSED and
  FAILED rows are terminal. A context note states that a bordereau is the
  cedent's period submission, processing creates a technical account, and the
  contract remains the source of its terms.
- Playwright coverage for bordereaux: newest-first listing and summary totals,
  create payload and local period validation, confirmed process with the linked
  account, fail with and without a note, the empty state and context note, a
  contained load failure, a 409 duplicate submission that preserves the form,
  and a 409 process race that reloads the terminal row.
- **Security** tab replaces the generic resource section with a dedicated
  collateral panel: it lists the selected contract's security from
  `GET /api/v1/contracts/{id}/security` with type, required and held amounts,
  currency, provider party, expiry, approval reference, status, and action. A
  create form posts the same collateral fields, and summary cards show the
  required total, held total, outstanding gap (required minus held), active
  count, and released count. Confirmed **Release** and **Expire** actions on
  non-terminal records PATCH
  `/api/v1/contracts/{contractId}/security/{securityId}/status`; both outcomes are
  terminal. A context note states that security is collateral, not cash, and not
  a Payment, and that releasing a record does not create a Payment.
- Playwright coverage for security: summary totals and active/released counts,
  all table columns and status tones, terminal rows without actions, the create
  payload and local amount validation, confirmed release/expire payloads, the
  empty state and context note, a contained load failure, and create/status 409
  states.

### Changed

- The contract list keeps its original create form and table and gains a Select
  action; the existing workbench test still passes.
