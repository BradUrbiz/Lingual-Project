# Business Documentation

Status: Business v1 draft
Last updated: 2026-06-01
Owner: Business + Product

## Purpose

This folder translates Lingual's product into business language for sales, partnerships, product management, fundraising, and pilot planning.

These documents are not implementation notes. They should answer:

- What customer problem does this solve?
- Who cares about it?
- Can sales demo it today?
- Can it support a pilot or paid package?
- What limitation needs to be disclosed?
- What decision is still unresolved?

## How to read these docs

Use these status labels consistently:

| Label | Meaning |
| --- | --- |
| Current | Supported by the current school beta product. |
| Limited | Supported, but with a constraint that matters for sales, support, compliance, or pilot operations. |
| Current / Limited | Supported now, but with a constraint that matters for sales, support, compliance, or pilot operations. |
| Planned | Clearly tracked in the product/engineering roadmap, but not yet part of the current beta promise. |
| Not in beta | Intentionally outside the current school beta scope. |
| Need to be resolved | Business, legal, pricing, market, or product detail not proven by the current project materials. |
| Research-deferred | Known open question that should be answered through a later research phase rather than decided from current internal materials. |
| Current / Research-deferred | Part of the current motion is defined, but a related commercial, legal, or market decision still requires research. |
| Direction defined / Research-deferred | The business direction is known, but exact pricing, packaging, legal, or market execution still requires research. |

## V1 package

| Document | Audience | Purpose |
| --- | --- | --- |
| `01-product-overview.md` | Everyone | The shortest business interpretation of what Lingual is, who it serves, and where it is mature or immature. |
| `02-feature-catalog.md` | Sales, PM, founders | Business-language inventory of current product capabilities and their demo value. |
| `03-customer-journeys.md` | Sales, CS, PM | How each customer/user moves through the product from first touch to value. |
| `06-sales-faq.md` | Sales, founders | Straight answers to buyer questions, including what must not be oversold. |
| `08-gtm-readiness.md` | Founders, PM, sales leadership | Judgment on what can be launched, sold with caution, or deferred. |
| `09-competitive-market-research-methodology.md` | Founders, PM, research | Methodology for Korea/US competitor and market-positioning research. |
| `10-competitive-market-scan-v1.md` | Founders, PM, research | First-pass Korea/US/global competitor longlist and early market implications. |
| `11-korea-procurement-policy-research.md` | Founders, PM, legal/procurement research | Korea public-school procurement, AI Digital Textbook, privacy, and pilot-path research. |
| `12-us-school-procurement-compliance-research.md` | Founders, PM, legal/procurement research | US school procurement, FERPA/COPPA, student-data, vendor review, and pilot-path research. |
| `13-priority-competitor-teardowns.md` | Founders, PM, sales | Deep tear-downs of the most relevant competitors and Lingual response implications. |
| `14-product-teardown-research-plan.md` | Founders, PM, product | Research plan for hands-on competitor product teardown across assignment creation, student UX, feedback, and dashboards. |
| `15-product-teardown-v1.md` | Founders, PM, product | First public-evidence product teardown across Korea and US priority competitors. |
| `16-product-teardown-deep-dives.md` | Founders, PM, product | Competitor-by-competitor evidence notes from the parallel product teardown research pass. |
| `17-positioning-competitiveness-research.md` | Founders, PM, GTM | Research-backed read on whether the proposed US and Korea positioning can compete. |
| `18-plang-school-market-position-research.md` | Founders, PM, GTM | Focused Plang School market-position, Seoul/Jeonnam adoption, and Korea-response memo. |
| `19-positioning-substitute-risk-research.md` | Founders, PM, GTM | Substitute-risk read for the teacher-designed natural conversation plus classroom-evidence positioning. |

## Source hierarchy

When business docs conflict with other project material, use this priority:

1. Current shipped behavior and live product surfaces.
2. `docs/school-integration/PRD.md`
3. `docs/school-integration/TASKS.md`
4. `docs/school-integration/LIMITATIONS.md`
5. `docs/school-integration/TECH_SPEC.md`
6. Older planning, BDD, testing, or prototype docs.

Some older docs describe removed or superseded flows. Do not repeat those claims in business docs unless the current product still supports them.

## Boundary with other docs

- `docs/school-integration/`: product and architecture source of truth for the school track.
- `docs/sales/`: prospecting lists, contact extraction, and sales operations data.
- `docs/business/`: product positioning, packaging, sales narrative, GTM readiness, and business risk.

## Editing rules

- Keep the writing customer-facing and business-facing.
- Do not explain internal implementation mechanics unless they create a business limitation.
- Use `Need to be resolved` instead of guessing.
- Separate what is demoable today from what is a roadmap intention.
- Keep compliance language cautious until counsel validates claims.
