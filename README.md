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
Terms, Security, Cessions, Bordereaux, and Commutation (propose, approve,
execute). The Overview tab lists the bind preconditions from
`GET /api/v1/contracts/{id}/bind-eligibility`; **Bind contract** is enabled only
when the contract is PLACED and every check passes.

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
retrocessions found through their search endpoints.

`npm start` serves the remote on port 3003 with `/api` proxied to the domain
service on 8086. `npm test` runs the Playwright suite covering create,
layer/participant/bind, the over-100% share rejection, the cession/capacity flow,
and record discovery (deep links, queue filtering, predictive party lookup,
party-label resolution and fallback, and cross-links). `IMPLEMENTATION.md` records
the screens, tests, and remaining gaps.

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
