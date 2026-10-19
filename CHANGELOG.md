# Changelog

All notable changes to this repository are documented here.

The format is based on Keep a Changelog and the project uses Semantic Versioning.

## [Unreleased]

### Added

- Tabbed workbench for layers, participants, terms, security, cessions,
  bordereaux, and commutation, with a selected-contract header showing the bind
  preconditions and bind action.
- Participant share balance per layer and a share-total indicator.
- Playwright coverage for the layer/participant/bind flow and the cession flow,
  including the over-100% and over-capacity rejections.

### Changed

- The contract list keeps its original create form and table and gains a Select
  action; the existing workbench test still passes.
