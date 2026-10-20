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

### Changed

- The contract list keeps its original create form and table and gains a Select
  action; the existing workbench test still passes.
