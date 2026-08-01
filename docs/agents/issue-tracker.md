# Issue tracker: Local Markdown

Issues, specs and decision maps live under `.scratch/`. Do not create GitHub Issues unless the repository convention is explicitly changed.

## Conventions

- One effort per directory: `.scratch/<effort>/`
- Map: `.scratch/<effort>/map.md`
- Tickets: `.scratch/<effort>/issues/<NN>-<slug>.md`
- Each ticket records `Type`, `Status` and `Blocked by`
- Comments and resolution details stay in the ticket file

## Wayfinding operations

- Frontier: open, unblocked and unclaimed tickets, ordered by number
- Claim: set `Status: claimed` before work
- Resolve: append `## Answer`, set `Status: resolved`, then link the decision from `map.md`
