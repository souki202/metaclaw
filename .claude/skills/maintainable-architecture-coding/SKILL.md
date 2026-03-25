---
name: maintainable-architecture-coding
description: 'Produce maintainable code for medium-to-large applications. Use when implementing features, refactoring, reviewing architecture, splitting large files, reducing coupling, increasing cohesion, or avoiding quick fixes that make codebases rot over time. Prefer structured design, clear boundaries, small but well-shaped changes, and long-term maintainability over patching everything into one file.'
argument-hint: 'What change or area should be implemented with maintainable architecture?'
user-invocable: true
disable-model-invocation: false
---

# Maintainable Architecture Coding

## What This Skill Produces

This skill guides the agent to produce code that remains workable over time, not just code that passes immediately.

It emphasizes:
- clear module boundaries
- low coupling and high cohesion
- controlled file growth
- incremental but well-structured refactoring
- rich operational visibility through safe logging
- changes that fit medium-to-large application development and maintenance

## When to Use

Use this skill when:
- a requested change looks small, but the obvious implementation would worsen structure
- logic is accumulating into one large file or component
- responsibilities are mixed across UI, state, domain logic, infrastructure, or utilities
- you need to add a feature without creating hidden dependencies
- you are reviewing or implementing code that should survive long-term development and operations
- the right answer may require a small structural refactor before the feature change

Do not use this skill when:
- the task is a one-off script or throwaway prototype
- the code is intentionally temporary and long-term maintenance is irrelevant
- the user explicitly asks for the absolute minimum patch and accepts the structural tradeoff

## Operating Principles

1. Solve the user request at the root cause, not only at the nearest call site.
2. Keep changes as small as practical, but never so small that they worsen architecture.
3. Prefer extracting cohesive units over expanding large mixed-responsibility files.
4. Keep public interfaces narrow and explicit.
5. Avoid speculative abstractions. Create structure only where the change actually needs it.
6. Separate domain logic from framework, transport, storage, rendering, and orchestration concerns.
7. Preserve strong observability: log important decisions, state transitions, inputs, outputs, and failures as much as practical, excluding secrets and personal information.
8. Make the next change easier, not harder.

## Procedure

### 1. Understand the Change in Architectural Terms

Before editing, identify:
- the user-visible outcome
- the domain logic involved
- the current module or file ownership of that logic
- whether the requested change belongs in an existing boundary or needs a new one

Classify the work:
- Feature addition: add new capability without leaking concerns into unrelated modules.
- Behavior change: modify the owning module rather than layering conditionals across callers.
- Refactor-supporting change: improve structure first if the current shape would make the feature brittle.
- Bug fix: fix the faulty responsibility at the correct layer.

Also identify the observability surface:
- what decision points will matter when this behavior fails in production
- which state transitions or external calls should be logged
- which identifiers or payload summaries are safe to record
- which fields must never be logged because they contain secrets or personal information

### 2. Detect Structural Risk Before Editing

Check for warning signs:
- one file owns unrelated responsibilities
- UI components contain domain rules or data transformation logic
- store or controller layers directly perform infrastructure and presentation work together
- utility modules have become dependency dumping grounds
- adding the new behavior would require more flags, branching, or duplicated logic in an already crowded file

If none of these are present, implement in place.

If one or more are present, prefer a small restructuring step before the main change.

### 3. Choose the Smallest Good Structure

Use the lightest structural improvement that preserves maintainability.

Preferred order:
1. Extend the existing owning module if responsibility is already correct and cohesion remains high.
2. Extract a helper within the same module area when logic is cohesive but currently too dense.
3. Extract a new module when a distinct responsibility or policy appears.
4. Introduce an interface or adapter only when multiple implementations or external boundaries actually exist.

Avoid:
- creating generic abstractions with only one unclear consumer
- splitting code into too many tiny files without meaningful boundaries
- moving logic purely to reduce line count while keeping the same coupling

### 4. Enforce Separation of Concerns

Use these boundaries where relevant:
- domain: business rules, calculations, invariants
- application/orchestration: workflows, coordination, state transitions
- infrastructure: APIs, persistence, platform integrations
- presentation: rendering, event wiring, view formatting

During edits:
- keep domain rules out of UI rendering code
- keep infrastructure details out of domain modules
- keep transformation logic near the layer that owns its meaning
- pass data through explicit inputs and outputs instead of hidden shared dependencies

### 5. Design for Observability

Add logging deliberately where it improves diagnosis and operations.

Prefer logs for:
- entry and exit of important workflows
- branch decisions that affect behavior materially
- external API, storage, queue, or platform boundaries
- retries, fallbacks, degraded paths, and error handling
- important state transitions and derived outcomes

Prefer logging more rather than less, as long as the logs do not include secrets or personal information.

When logging:
- include stable identifiers, counts, status values, and decision context
- summarize payloads rather than dumping sensitive raw data
- make messages specific enough to reconstruct what happened
- keep log placement near the owning behavior

Never log:
- credentials, access tokens, session secrets, API keys, or raw authorization headers
- personal information that is not strictly necessary for diagnosis
- raw user content when a safer summary or identifier is sufficient

### 6. Control Coupling and Cohesion

Prefer designs where each module:
- has one clear reason to change
- exposes a small API
- depends on fewer layers, not more
- can be tested in isolation when practical

When deciding whether to extract code, ask:
- does this logic belong together conceptually?
- will this area likely change independently?
- would keeping it here force unrelated modules to know too much?

Extract when the answers indicate a distinct responsibility.

### 7. Keep the Change Reviewable

Even when restructuring is needed:
- keep the refactor directly tied to the requested change
- avoid unrelated cleanup
- preserve behavior unless intentional
- keep naming concrete and domain-specific
- prefer one focused structural step plus the feature step over a broad rewrite

If the ideal architecture would require a wide rewrite, do the smallest safe improvement now and leave clear seams for future work.

### 8. Verify at the Right Levels

Validate the result with checks that match the change:
- compile or typecheck for interface and dependency correctness
- targeted tests for extracted or changed domain behavior
- integration or UI checks only where the change crosses boundaries
- verify that new logs are emitted at the intended boundaries and do not include secrets or personal information

Review the final shape:
- Is responsibility clearer than before?
- Did any file become a bigger coordination bottleneck?
- Did the change reduce or increase hidden coupling?
- Would a future related change have an obvious place to go?

If the answer is poor, revise structure before finishing.

## Decision Rules

### When a Small Request Still Justifies Refactoring

Do a small refactor first if:
- the target file is already overloaded
- the new behavior introduces a new responsibility
- the obvious patch duplicates logic or spreads business rules across layers
- a small extraction would materially improve clarity and reduce future cost

Do not refactor first if:
- the ownership is already correct
- the change is local and keeps cohesion intact
- the restructuring would dominate the task without improving the long-term path

### When a File Should Be Split

Split a file when several of these are true:
- it contains multiple independent reasons to change
- unrelated imports cluster together
- test setup must cover many unrelated behaviors
- new edits repeatedly touch distant regions of the same file
- readers must mentally reconstruct hidden internal subdomains

Do not split just because a file is long. Split when responsibility is mixed.

### When to Introduce an Abstraction

Introduce an abstraction only if it captures a real boundary such as:
- platform-specific implementations
- persistence or network adapters
- multiple strategies with clear selection logic
- a domain policy that should be isolated from callers

Do not introduce abstraction merely to sound architectural.

## Completion Checklist

The work is complete when:
- the user request is implemented
- the owning responsibilities are clearer, or at least not worse
- coupling did not increase without a strong reason
- cohesion improved or stayed high
- file growth was controlled intentionally
- important behavior is observable through safe logs
- naming matches domain meaning
- validation appropriate to the change was performed or explicitly noted as pending

## Response Style for the Agent

When using this skill, the agent should:
- explain structural decisions briefly and concretely
- call out when a small refactor is necessary to avoid long-term degradation
- add useful logs generously while explicitly protecting secrets and personal information
- prefer minimal, architecture-consistent edits over broad rewrites
- avoid presenting fragile quick fixes as if they were sufficient
- mention residual architectural debt if a constrained change cannot fully resolve it

## Example Prompts

- Use maintainable-architecture-coding to add this feature without bloating the existing file.
- Refactor this area with low coupling and high cohesion before implementing the bug fix.
- Implement this request in a way that fits long-term maintenance for a large application.
- Review this planned change and choose a small structural refactor if needed before coding.