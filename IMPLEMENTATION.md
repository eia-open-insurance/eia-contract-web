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
| Security | List and add security; over-collateralisation needs an approval reference |
| Cessions | List and record cessions with policy/claim references and ceded premium/loss |
| Bordereaux | List and register bordereaux with period, source format, and line counts |
| Commutation | Propose, approve, and execute a commutation |

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
still in flight. Run with `npm test`; the Playwright config starts the dev server
on port 3003.

## Remaining gaps

- No edition or deletion of child rows.
- The commutation tab requires the release document id to be pasted; there is no
  document picker.
- No accessibility audit beyond semantic labels and pressed tab state.
- Pagination, optimistic concurrency headers, and idempotency keys are not used
  by the remote (see MISMATCHES M-04, M-06, M-07).
