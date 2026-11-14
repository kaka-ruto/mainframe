---
name: scenario-testing
description: Use when planning, adding, reviewing, or reorganizing automated tests for user journeys, agent behavior, or other multi-step product flows, especially when existing tests overlap or edge cases span several system boundaries.
---

# Scenario Testing

## Overview

Test the behavior, not the framework. A scenario test proves a promise a user can observe across meaningful parts of a system. It should make behavior predictable and catch regressions without re-testing framework internals or repeating another test’s promise. Test a deliberate set of meaningful paths, not every theoretical combination.

## When to Use

Use this skill when a behavior crosses multiple steps or boundaries, when deciding whether a flow belongs in a journey or an agent scenario, or when reorganizing scattered tests into a discoverable scenario suite. Keep a focused unit or boundary test when that is the clearest owner of the behavior.

## Workflow

### 1. State the user-visible promise

Describe the actor, starting state, action, and observable result in ordinary product language. Identify which system boundaries matter to that promise: identity, authorization, tenant/workspace scope, persistence, background work, agent decision, or external provider.

Do not start with a list of classes or endpoints. If the promise cannot be stated clearly, clarify the behavior before expanding the suite.

### 2. Find the current owner

Read the repository’s test guidance and scenario-suite README, then search existing tests for the same observable behavior. Map each promise to its current test owner and note distinct assertions in older tests before changing them.

Keep one clear owner for each behavior. Similar setup does not mean duplicate behavior, and similar names do not prove overlap. Remove or consolidate a test only after the replacement passes and preserves any unique user-visible behavior it owned.

### 3. Choose the right test level

| Promise under test | Best fit |
| --- | --- |
| A rule or state transition on one domain object | Fast model/unit behavior test |
| Request, session, webhook, or adapter contract | Focused integration/boundary test |
| A user crosses meaningful steps such as signup, access, connection, and use | Journey scenario |
| Agent answer, refusal, classification, source use, or tool choice | Agent behavior scenario |
| Compatibility with a real external provider | Small provider contract test, often recorded with the project’s VCR policy |

A journey may include an agent turn when the path depends on it, but it should not duplicate a separate scenario whose promise is answer quality or agent decision behavior. Keep unit and boundary tests that cover distinct rules; scenario suites complement them rather than absorbing every test.

### 4. Build a compact coverage map

For each promise, consider only axes that can change the outcome:

- Actor and permission: anonymous, signed-in, owner/member, wrong tenant, or revoked access.
- Lifecycle: new, active, disabled/disconnected, expired, retried, repeated, or restored state.
- Outcome: success, meaningful rejection, partial completion, and recovery where users can recover.
- Boundaries: persistence, queued work, external dependency, and history/identity continuity.
- Agent scope: relevant versus unsupported request, enough versus insufficient/conflicting evidence, and untrusted instructions or content when source boundaries matter.

Select cases that prove distinct outcomes. Include negative and recovery paths when they protect a real product promise. Avoid Cartesian products: do not combine every role, state, provider, and input unless their interaction can change behavior. Record what is intentionally covered elsewhere rather than copying its assertions.

### 5. Exercise the real product path at the meaningful boundary

Use real application behavior and fixtures for stable, readable starting records. Prefer the project’s established fixtures over factories or ad hoc setup; add a fixture when it represents a reusable, meaningful state. Keep scenario-specific changes explicit in the test.

Assert what the user can observe and the resulting state: response or rendered outcome, ownership/access, persisted records, and effects such as a queued or suppressed delivery. Avoid assertions about private method calls, framework internals, or implementation choreography.

Stub external edges when the provider is not the subject. Use a live call recorded with VCR only when provider/model behavior is part of the promise and the repository supports deterministic recordings. Keep the scenario set small and purposeful; pin relevant provider/model/configuration, use the established `record: :once` policy where applicable, refresh only the specific cassette that must change, and never expose credentials in fixtures, cassettes, or output. A local decision/routing library should be tested at its behavior boundary; do not pay for model calls to test a deterministic choice.

**Handling nondeterminism in agent scenarios:**
- Pin the provider, model ID, and configuration for each scenario so the same input always triggers the same code path. Vary only the axis under test.
- For deterministic outputs—refusals, tool choices, routing decisions—assert exact values against a pinned model. If exact output cannot be guaranteed, pin the assertion to a stable subset or use a snapshot test with an explicit refresh policy.
- For free-text answers where exact equality is fragile, use an LLM-as-judge, embedding-similarity threshold, or structured-scheme check (e.g., required keys, length bounds, refusal tokens) rather than exact string matching. Record the judge model/version in the scenario so changes are visible.
- Mark scenarios with nondeterministic assertions as non-blocking in CI when the project tolerates it, but never remove the assertion entirely—downgrade it to informational rather than silent.
- When a scenario relies on a live model call, treat it as a flaky-risk by default: add a retry budget or a timeout, and surface a clear message on timeout rather than marking the scenario as passed.

**Handling time and async in scenario tests:**
- For time-dependent behavior such as expirations or TTLs, use the project’s time-travel tools (e.g., `travel_to` / `freeze_time`) instead of real delays. Travel only enough to trigger the boundary; do not over-travel into unrelated state changes.
- For queued or background work, use the project’s deterministic job helpers (e.g., `perform_enqueued_jobs`) to force execution within the scenario. When async behavior is the promise, assert on the completed state, not the queue entry.
- When polling for async side effects is the only option, combine an explicit timeout with a short poll interval. Fail the scenario on timeout with a clear message that names the expected state and the actual state.
- Never let a scenario depend on wall-clock time, background scheduler ticks, or unpredictable provider latency. If you cannot control it, stub it.

### 6. Keep the suite readable and ordered by convention

For Rails projects, scenario tests live under `test/scenarios/`, grouped into named directories and numbered files, with fixtures for known state and VCR (`record: :once`) for provider calls. For other stacks, follow the project’s established conventions or document a clear structure if none exists. A short README should define scope, ordering, setup, and overlap rules.

Order directories and files by the events’ likelihood and sequence in a typical user journey: most common starting steps through later actions and recovery. For a new feature, aim to test the user’s journey from its start through its meaningful end state, including important failure and recovery paths.

Each file should own a distinct behavior area and stay small enough to understand. Keep setup visible. Extract a helper only when it expresses a genuinely shared starting condition or operation; do not hide the actions or assertions that explain the scenario. Put every file in a named area if that is the suite’s documented structure; avoid an unstructured pile of catch-all tests.

### 7. Run, diagnose, and maintain

Run focused tests first, serially when they share a database, queue, or other mutable resource. Then run the relevant scenario area and required broader checks. Do not run overlapping test commands against the same stateful test environment.

Separate product failures from setup failures (missing assets, migrations, credentials, provider outage, or stale recordings). Fix the behavior when it is a product defect, then rerun the focused test. Report unverified paths honestly; “all edge cases” is not a useful completion claim without a defined behavior map.

When moving a test, compare its assertions to the new owner, preserve unique behavior, run the replacement and affected focused tests, and only then remove the duplicate. Revisit the coverage map when behavior changes so the suite remains complete without accumulating copies.

## Example: Signup and Invite Journey

Promise: a new user can create an account, invite a teammate, and have that teammate accept the invitation and reach the intended shared workspace with the expected access.

Map the journey from signup through invitation, acceptance, and verified workspace access. Consider meaningful branches such as an invalid or expired invitation, an invite sent to a different email, repeated acceptance, and a user who already has an account. Keep field-level validation in focused tests when it is independently owned. Use fixtures for known users, accounts, and invitation states; keep changes made by each scenario explicit. Stub email delivery unless delivery itself is the promise. Search the full suite for existing ownership before adding tests, preserve distinct assertions in older tests, and remove overlap only after the new journey passes.

## Common Mistakes

- Adding a new scenario before searching the whole test suite for an existing owner.
- Deleting an older test because it looks similar before comparing observable assertions.
- Putting every edge case in one giant file or every test into the journey suite.
- Testing every combination instead of distinct behavior-changing cases.
- Making routine CI depend on fresh live provider calls when a stable recording or boundary stub is sufficient.
- Letting mocks replace the product behavior the scenario is meant to prove.
- Asserting only a successful response while ignoring persisted state, access scope, retries, or recovery.
- Claiming complete coverage without naming the promises and meaningful boundaries covered.
- Replacing stable fixtures with repetitive factory or inline setup that obscures the scenario’s starting state.
