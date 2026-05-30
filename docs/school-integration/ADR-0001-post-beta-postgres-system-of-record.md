# ADR-0001: Use Postgres as the Post-Beta School-Domain System of Record

Status: Accepted
Date: 2026-05-30
Owner: Engineering

## Context

Lingual originally kept school-integration data in Firestore to avoid adding a second persistence system during beta. That was the right launch-speed tradeoff, but it is no longer the right long-term architecture after the product moved beyond beta on 2026-05-29.

The school product now has relational workflows:

- users can belong to multiple organizations and roles
- teachers manage classes and assignments
- students enroll in classes and launch assignment-scoped practice
- compliance state is scoped by organization and student
- Canvas and LTI data must be connected to classes, rosters, assignments, and launches
- practice sessions and learning events drive teacher analytics
- deletion and disclosure workflows require auditable, consistent state transitions

The current Firestore implementation handles these workflows by manual lookup choreography, denormalized arrays, composite indexes, Python-side joins, and multi-document write coordination. That increases implementation cost and makes analytics, reporting, and data integrity harder as schools and classes scale.

## Decision

Use Cloud SQL for PostgreSQL as the post-beta source of truth for school-domain and analytics-ready learning data.

Firebase Auth remains the authentication provider. Firestore remains the source of truth for identity-adjacent profile state, assessment state while legacy learner flows depend on it, consumer-era chats, and realtime-friendly legacy data.

Postgres owns:

- organizations
- memberships and school roles
- classes
- teacher-class assignments
- enrollments
- assignments
- Canvas/LTI integration records
- student compliance records
- consent and disclosure events
- guardian consent packets
- deletion requests and execution runs
- practice-session metadata
- learning events
- analytics rollups

The Firebase UID remains the canonical user identifier across systems. Postgres should reference users by `firebase_uid` instead of replacing Firebase Auth or duplicating password/auth state.

## Alternatives Considered

### Keep Firestore for all app data

Rejected as the long-term direction. It avoids migration work now, but every new school feature continues paying the cost through custom joins, denormalized fields, query-limit workarounds, composite-index management, and weak relational constraints.

### Migrate Firebase Auth and all profile data away from Firebase

Rejected. Auth migration does not solve the school-domain modeling problem and would add unnecessary risk. Firebase Auth is already integrated into the app, route protection, client SDKs, and session creation.

### Use Firebase Data Connect as the primary backend data layer immediately

Deferred. Data Connect may be useful later because it is backed by Cloud SQL for PostgreSQL and integrates with Firebase Auth, but the current Flask backend owns important policy, compliance, OpenAI, Canvas, LTI, and analytics logic. Direct Flask access through SQLAlchemy/Alembic gives more control for the first migration.

## Consequences

Positive:

- real foreign keys and uniqueness constraints for school-domain data
- transactional writes for multi-entity operations such as joins, assignment publish, consent updates, and deletion execution
- simpler teacher dashboards and analytics through SQL joins and aggregates
- clearer migration history through Alembic
- less dependence on Firestore composite-index shape for operational queries
- cleaner division between auth/profile and school product data

Negative:

- the app now has two persistence systems during migration
- local development and deployment need Cloud SQL/Postgres setup
- backfill, dual-write, and parity tooling are required
- engineers must be careful not to create permanent split-brain ownership between Firestore and Postgres

## Migration Direction

1. Add Postgres schema and migration tooling while Firestore remains the existing runtime.
2. Backfill existing Firestore school-domain records into Postgres.
3. Add parity checks that compare Firestore projections with Postgres rows.
4. Move new school-domain writes to Postgres first.
5. Dual-write only fields that legacy Firestore-backed readers still need.
6. Cut reads over one route family at a time.
7. Retire Firestore school-domain writes after each route family is fully cut over and monitored.
8. Keep Firestore for Firebase Auth profile, assessment, consumer-era chats, and explicitly retained legacy/realtime data.

## Implementation Notes

Recommended first implementation stack:

- Cloud SQL for PostgreSQL
- SQLAlchemy for Flask-side persistence
- Alembic for migrations
- Postgres `jsonb` only for bounded snapshots and event payloads, not for stable relational ownership
- explicit repository methods behind `RouteDeps` so route code can migrate without a flag-day rewrite

Do not introduce a generic "database switch" that hides ownership. Each domain should have one active source of truth at a time, with dual-write used only as a temporary migration mechanism.

Coexistence-window ID strategy (decided 2026-05-30): keep UUID primary keys and resolve every cross-store foreign reference through the unique `legacy_firestore_id` index on each write, rather than freezing writes per route family. Resolution is the same indexed lookup backfill uses, centralized in the repository layer, so it adds no downtime and minimal code. See `POSTGRES_SCHEMA.md` -> "Backfill Normalization And ID Resolution" and TECH_SPEC 3.8a.
