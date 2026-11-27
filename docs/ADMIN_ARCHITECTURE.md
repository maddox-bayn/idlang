# Idlang administration

## Operator workflow

An administrator signs in at `/admin`, sees outstanding work, opens the relevant queue, inspects one record, makes a decision and verifies its outcome in history. Keep each queue independently accessible by URL, including refresh and browser back. Load data only for the active section. Show a capability in the interface when its backend operation exists and the signed-in operator has permission.

## Available in the first release

| Section | Work | Authority |
| --- | --- | --- |
| Overview | See account, post and draft totals. Open the library queue. | Administrator |
| Accounts | Browse paginated account names, roles and status. | Administrator, read-only |
| Library review | Inspect the document, author and license. Publish or reject a pending submission. | Administrator workspace. Existing library API also recognizes curators. |
| Review history | Find reviewer, document, previous state, outcome and UTC decision time. Page back through decisions. | Administrator, read-only |

Opening Accounts does not load document submissions. A library decision from the queue requires the item still to be a draft. The database records each state change in the same transaction. History begins when migration 11 runs. Imported and historical decisions should retain their actual provenance.

## Planned operations and ownership

These are proposed capabilities. Introduce the permission on the server, its workflow, tests and history before enabling the corresponding navigation entry.

| Area | Operator and scoped permission | Normal workflow and completion condition |
| --- | --- | --- |
| Community | Moderator with report-review permission | Open report, inspect the reported post or supplied message evidence, record a reason, dismiss or restrict, then handle appeal. General access to private conversations is outside this role. |
| Heritage and library | Curator with catalog-review permission | Inspect source, license, consent and original file. Request correction, publish a revision or withdraw it. Retain attribution and publication history. |
| Learning | Curriculum editor with lesson-edit permission and publisher with release permission | Draft a version, preview exercises and answer keys, validate prerequisites, publish. Existing attempts remain linked to the version taken. |
| Translation | Language reviewer with correction-review permission | Review consented examples, dialect and proposed correction. Approve a versioned dictionary entry. Model release and rollback belong to a separate deployment permission. |
| Accounts and access | Account support for account state. Access administrator for role assignments. | Find the account, inspect current state, record a reason and apply a scoped change. Protect against self-escalation or removal of the last active administrator. |
| Site operations | Operator with diagnostics permission | Inspect service health, failed uploads, translation capacity and failed jobs. Retry only a specifically identified, idempotent operation. |
| Audit | Auditor with read-only access | Filter by actor, action, target and time. Display a decision without exposing message bodies, credentials or private documents. |

## Implementation boundaries

Keep the Go API as the authorization boundary. The browser controls navigation only. Put each mutation with the domain that owns the data and route it through the same business rules as other callers. Enforce current state and permissions on the server. Record actor, target, action, timestamp and reason for sensitive changes. Use a database transaction for authoritative state and history. Send downstream notifications after commit through a retryable outbox when notifications are introduced.

Use a separate read endpoint for each work queue. Paginate histories by a stable ordered key and add indexes for supported filters. Keep dashboards available when an optional service is slow. Private admin responses should bypass shared caches. Track request latency, failed decisions, stale-state conflicts and oldest pending work per queue.

## Rollout order

1. Ship the administration shell, account directory, library review and decision history.
2. Add explicit staff permissions and scoped screens for existing curators. Test unauthenticated, unauthorized, permitted and revoked access through each API.
3. Add community reporting and appeals, then versioned curriculum and translation review. Exercise duplicate submissions, concurrent reviews, outages and rollback for each operation.
4. Add support actions, cross-domain audit search and operational metrics once their source events exist.

The operator-only administrator promotion command remains the bootstrap path. New web-based role administration needs its own privilege and recovery design.
