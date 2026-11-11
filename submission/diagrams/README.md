# Architecture Diagrams

These are proposed architecture views, not evidence of deployed AWS infrastructure. Mermaid is the maintainable source. The accompanying exports are for reviewers and presentation zooming.

| Diagram | Source | SVG | PNG | Reading focus |
|---|---|---|---|---|
| 1 — AWS production architecture | [Mermaid](production-architecture.mmd) | [SVG](production-architecture.svg) | [PNG](production-architecture.png) | Entry/trust boundaries, two AZs, regional services, legacy and pilot-light DR |
| 2 — Mobile offline submission | [Mermaid](mobile-offline-sequence.mmd) | [SVG](mobile-offline-sequence.svg) | [PNG](mobile-offline-sequence.png) | Durable queue, lost-response replay, acknowledgment, two-phase evidence and reconciliation |
| 3 — Failure recovery | [Mermaid](failure-recovery.mmd) | [SVG](failure-recovery.svg) | [PNG](failure-recovery.png) | Mobile/backend failure, legacy outage, worker crash, ambiguity and regional inventory |

## Legend and scope

In diagram 1, thin arrows are synchronous requests/transfers, thick arrows are asynchronous events/replication, and dotted arrows are identity, telemetry or administration. An edge shows a dependency; it is not a claim that a transaction spans those systems. Multi-AZ database replication is labeled separately from asynchronous cross-region replication. S3/SQS are regional, outside AZ subnets. AZ B mirrors application responsibilities; shared service arrows are shown once to limit crossings.

In diagram 2, solid sequence messages show calls and dashed messages show responses. Notes distinguish local behavior from production scanner/push requirements. The flow starts offline and explicitly includes an accepted response being lost and replayed. Claim receipt, evidence receipt and legacy adjudication are separate milestones.

In diagram 3, labeled paths describe recovery rather than protocol connections. The dotted regional path is design only. Automated local tests exercise failure orchestration with local dependencies; they do not prove cloud failover or real legacy dedupe. Regional recovery must use surviving durable inventory, not assume the old queue exists in DR.

## Export reproduction

Exports use Mermaid CLI **12.2.0**, the checked-in [theme configuration](mermaid-config.json), white backgrounds and headless Chrome. Renderer packages were downloaded into a temporary npm cache outside the repository; application dependencies and lockfiles were not changed.

With Mermaid CLI and a supported browser installed:

```bash
mmdc -i submission/diagrams/production-architecture.mmd -o submission/diagrams/production-architecture.svg -c submission/diagrams/mermaid-config.json --size 3000 -b white
mmdc -i submission/diagrams/production-architecture.mmd -o submission/diagrams/production-architecture.png -c submission/diagrams/mermaid-config.json --size 3000 -b white
```

Repeat for `mobile-offline-sequence` and `failure-recovery`. A custom browser can be selected with `-p <puppeteer-config.json>`; the preparation environment used its installed Chrome via a temporary configuration. No hosted rendering service or AWS account is required.

## Verification results

On 2026-11-11 all three Mermaid sources rendered successfully with CLI 12.2.0 into **three SVG and three PNG exports**. Final SVGs also parsed as valid XML and PNG signatures/dimensions were checked. The production, sequence and recovery PNGs were visually inspected; the production view was simplified after visual review to reduce routing clutter. SVG is recommended for zooming during review and recording.

An initial sandboxed package download failed DNS resolution; a permitted temporary tooling download succeeded. Browser launch also required permitted execution outside the restricted sandbox. An initial sequence parse error caused by semicolon-separated note text was corrected before the successful final render. No syntax/export failures remain.

The delivery text check passed for **67 local Markdown link targets, including six heading anchors**, with no missing targets/anchors or trailing whitespace in the new/updated delivery text. Application lint and typecheck passed separately. Historical unrelated working-tree changes were preserved.
