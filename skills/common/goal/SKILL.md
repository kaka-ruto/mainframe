---
name: goal-creator
description: Use when starting a new development cycle, planning a significant feature, or structuring work that spans multiple sessions. Create structured goal documents that guide proper end-to-end development of something.
---

# Goal Creator

## Overview

A goal document is a working tracker that captures what a development
cycle is building, in what order, and when it's done. It sits between
the product vision and the implementation — more detailed than a roadmap,
less rigid than a specification.

This skill teaches you how to create one.

## When to create a goal document

- Starting a new feature or product layer that spans multiple sessions
- Work has clear deliverables but the path isn't fully mapped yet
- Need to coordinate scope, order, and quality expectations
- Handing work off between sessions or developers

**Don't create** for single-session bug fixes, trivial changes, or anything
that fits in a single commit message.

## The goal document structure

A great goal document has exactly these sections, in this order:

### 1. What we're building

One paragraph. Answer the question "if this succeeds, what changed?"
Be specific enough that someone reading only this section knows whether
their work belongs here.

### 2. How this works (the rules of engagement)

- **Testing requirement**: what standard before a checkbox can be marked done
- **Workflow conventions**: which skills to use (git-workflow, TDD, etc.)
- **Living document**: is editing encouraged? Be explicit — yes it is.

### 3. Design decisions (made so far)

Decisions that affect multiple tasks. Capture the rationale concisely
so future implementers don't repeat the debate.

**Always include concrete examples**: config blocks, API shapes, code
trait signatures. Ambiguity here causes rework.

### 4. Phases with task lists

Break work into phases. Each phase should be independently shippable
— if everything after it is dropped, it still adds value.

| Phase quality | Bad | Good |
|---|---|---|
| Independence | "Phase 2 can't work without Phase 1" | "Phase 1 ships a working interface, Phase 2 adds the real backend" |
| Granularity | One checkbox: "Build everything" | One checkbox: hours to days of work |
| Order | "Phase 1: marketing, Phase 2: backend" | "Phase 1: core engine, Phase 2: CLI" |

**Checkbox format**: `- [ ] Task name — one-line description of the deliverable`
Every checkbox is actionable by itself.

### 5. Definition of done

End-to-end scenarios that must work. Write these as user-facing steps,
not technical checklists. If someone who hasn't read the implementation
can walk through these and verify them, the goal is done.

Format:

```
1. A user does X
2. The system responds with Y
3. A user does Z
4. The system responds with W
```

## What a goal document is NOT

| Not this | Because |
|---|---|
| A specification | Specs define exact behavior for every edge case. Goals define what matters enough to coordinate around. |
| A roadmap | Roadmaps have dates and milestones. Goals have checkboxes and phases. |
| A ticket tracker | Tasks in a goal document are coarse enough that you can hold the whole thing in your head. |
| A contract | It changes as you learn. The edit invitation is not optional — it's the point. |

## How to use it during development

1. **Use the current branch** unless the goal document or project
   conventions specify otherwise. Do not create a new branch for every
   goal — work in the active branch unless there is a reason not to.
2. **Pick one task.** Start with the first unchecked checkbox in the
   first phase.
3. **Implement it.** Use TDD, git-workflow, and any other skills the
   document references.
4. **Check it off.** Mark `[ ]` → `[x]` when it's well-tested and working.
5. **Update as you go.** Add tasks you discover. Remove irrelevant ones.
   Split tasks that are too big. The document is a tracker, not a contract.
6. **When all boxes are checked**, verify the definition of done. If those
   scenarios pass, the goal is complete. Archive the document and plan
   the next one.

## Common mistakes

- **Too granular.** A checkbox should represent hours to days, not minutes.
  If you have 50 checkboxes for a week of work, merge some.
- **No "out of scope" boundary.** If you can't say no to something, you
  don't know what you're building. Add an explicit "not building" section.
- **Skipping design decisions.** The first implementer makes choices that
  the second implementer needs to understand. Write them down.
- **Letting the document go stale.** When you discover something during
  implementation, update the goal document immediately, not at the end.
- **Writing a spec instead of a tracker.** If a section takes more than a
  few sentences to explain, it belongs in a design doc, not the goal
  document. The goal document should be scannable in 2 minutes.

## Relationship to other artifacts

```
Product vision (about.md, README)
        ↓
Goal document (GOAL.md) — what we're building this cycle
        ↓
Implementation — code + tests
        ↓
Definition of done verification
```
