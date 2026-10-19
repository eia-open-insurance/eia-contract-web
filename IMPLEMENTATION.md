# Implementation state

The remote is a single federated React application exposed as `./App`. It is a
tabbed workbench around the Contract domain API and holds no business logic: every
action calls the domain service.

## Screens

| Tab | Behaviour |
|---|---|
| Contracts | Create a draft, list contracts, select the working contract, transition its status |
| Layers | List and add layers (number, type, attachment, limit, basis, currency, effective dates, tower note) |
| Participants | List and add participations; shows the risk-bearing share total per layer and whether it is balanced |
| Terms | List and add terms with a term code, value, source clause, and effective dates |
| Security | List and add security; over-collateralisation needs an approval reference |
| Cessions | List and record cessions with policy/claim references and ceded premium/loss |
| Bordereaux | List and register bordereaux with period, source format, and line counts |
| Commutation | Propose, approve, and execute a commutation |

The selected-contract header shows the bind preconditions returned by
`GET /api/v1/contracts/{id}/bind-eligibility`, enables **Bind contract** only when
the contract is PLACED and every check passes, and shows the resulting status.

Money and percentages are rendered exactly as the API returns them (decimal
strings), so no precision is lost in the browser. Errors are shown as
`CODE: message` from the structured error body.

The original create form and contract table from the first slice are unchanged in
behaviour and remain the default tab.

## Tests

`tests/contract.spec.js` (unchanged first-slice test),
`tests/layers-participants.spec.js` (stateful mocked API: record layer, record
participants, watch the balance and bind enablement, bind),
`tests/cession.spec.js` (record a cession, then a capacity rejection). Run with
`npm test`; the Playwright config starts the dev server on port 3003.

## Remaining gaps

- No edition or deletion of child rows.
- The commutation tab requires the release document id to be pasted; there is no
  document picker.
- No shell integration beyond the existing Module Federation remote, no UI kit
  adoption, and no accessibility audit beyond semantic labels.
- Pagination, optimistic concurrency headers, and idempotency keys are not used
  by the remote (see MISMATCHES M-04, M-06, M-07).
