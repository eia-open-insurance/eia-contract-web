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
| Register | Lists contracts with number, cedent, reinsurer, and status; selecting one opens it |
| Create contract | Primary header action; opens a compact create form for a draft contract |
| Overview | Contract facts, lifecycle transition, and the bind preconditions |
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

## Tests

`tests/contract.spec.js` (operational layout and create via the primary action),
`tests/layers-participants.spec.js` (stateful mocked API: record layer, record
participants, watch the balance and bind enablement, bind; then an over-100%
rejection), `tests/cession.spec.js` (record a cession, then a capacity
rejection). Run with `npm test`; the Playwright config starts the dev server on
port 3003.

## Remaining gaps

- No edition or deletion of child rows.
- The commutation tab requires the release document id to be pasted; there is no
  document picker.
- No accessibility audit beyond semantic labels and pressed tab state.
- Pagination, optimistic concurrency headers, and idempotency keys are not used
  by the remote (see MISMATCHES M-04, M-06, M-07).
