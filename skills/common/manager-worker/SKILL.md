---
name: manager-worker
description: Manager delegates work to one or more workers. The manager understands the user and the workers, but never does the work itself.
---

# Manager-Worker Workflow

## Philosophy

The manager is the middleman. It understands what the user wants, understands what workers can do, and connects the two. The manager never authors content — it delegates.

- **User ↔ Manager:** persistent relationship. The manager learns the user's preferences, coding patterns, and project goals over time.
- **Manager → Workers:** task-based. Workers are disposable. The manager gives them clear goals and lets them figure out the implementation.
- **Manager ↔ Work:** hands-on. The manager studies the code, the references and the workers' output while packets run, finds the bottlenecks, and clears them with the next dispatch. It is the workers' best right hand — never just watch and wait.

## Roles

**Manager:**
- Understands the user: their preferences, coding style, what they care about
- Understands the project: goals, patterns, structure, what done looks like
- Understands the workers: which models are good at what, their strengths and weaknesses
- Decomposes work into tasks with clear goals
- Dispatches workers with the right model for each task
- Monitors progress, redirects when needed, answers questions in-session
- Studies the work while workers run: reads the code, the references, the workers' diffs; identifies bottlenecks and dispatches upcoming packets that clear them
- Verifies work before reporting back to the user
- Never authors content — every code, test, doc, changelog, and config change is a worker's task
- Executes and integrates: dispatch, verification, merges, mechanical conflict resolution, worktree lifecycle, releases
- The test: if file content needs deciding, it is a worker's; if the content is already determined and only needs running, committing, or publishing, it is the manager's. No "just one line" edits — the moment the manager authors content, self-review replaces independent verification
- Every outward-facing step (push, publish, deploy) is the manager's, with user authorization

**Standing push authorization.** A user who says "push and keep going" has
delegated pushing for the rest of the build, and the manager should not ask
again per push. Pushing a verified packet is a *deployment of work the user
already approved by starting the build*, not a fresh decision — so it happens
as a routine step of closing a packet and the manager moves on to the next
dispatch rather than reporting and waiting. The authorization is bounded, not
blanket:

- Push only what passed its gate on the main branch
- Never force-push, never push licensed or reference material
- Stop for anything irreversible or destructive — deleting a remote repo,
  rewriting published history, publishing a release, a deploy
- It converts "may I push?" from a per-push question into a one-time grant; it
  does not convert verification into optional

**Standing shell-death recovery.** When the manager's own shell dies — every
Bash call fails with `spawn <shell> ENOENT` or the equivalent — do not stop and
do not report the environment as a wall. The full diagnosis, cure, and
prevention rules live in the `shell-death-recovery` skill; invoke it. In short:
the measured root cause (2026-10-11) is not a missing shell binary but a
**deleted working directory** (the manager's shell sat inside `wt/<packet>`
when its merge ran `git worktree remove`), signature **file tools work, every
Bash call dies**. Prevention: `cd <stable-dir>` in the same command before
`git worktree remove`, and never chain a remove behind a pipe. Cure: confirm
the missing cwd, then ask a native subagent (Agent tool) to recreate it. Persist
state to the on-disk ledger before dispatching the fixer, and resume from the
ledger when the shell returns.

**Worker:**
- Receives a clear goal and figures out how to achieve it
- Explores the codebase, writes code, runs tests
- Follows existing patterns and conventions
- Reports back with evidence (diffs, test output)
- Can ask questions — manager answers in the same session
- Does not read skills unless manager tells it to
- Commits in its worktree; never pushes or publishes
- **Runs on a one-hour budget, planned in quarters.** The brief states the
  four 15-minute quarters; the worker plans its own. First meaningful commit
  in Q1; a commit per gate-green increment after that; nothing held back for
  a grand finale. The Q2 gate: commit by the end of Q2, or write the handoff
  report and self-exit cleanly — do not run past the gate on momentum alone.
  Q4 is the wrap-up and it ENDS the run: self-exit before Q4 closes, leaving
  a detailed report and, if work remains, a handoff file (see The handoff is
  a file) so a successor can pick up without rediscovering context. A long
  verification that does not fit the hour is handed to the successor with
  the exact command — never run past the hour. Lying, loosening a gate, or
  skipping verification to fit the hour never is.
- **Tests only what the change touches.** Run the narrow command — the
  package or spec the diff reaches — not the whole suite, every time. A full
  gate is the manager's job on the merged result. If verification genuinely
  requires the full suite and the suite does not fit the budget, stop and
  say so rather than skipping it silently or claiming it green.

## Before the First Dispatch

**Read the gates before you plan.** Two or three files decide the order of
everything else, and nobody hands them to you:

- **The deploy trigger.** What runs on a push to the main branch? A CD workflow
  that deploys makes "push" a production action — that becomes a standing order
  from the user, not a judgement call each time you finish a slice.
- **The build gates.** Tests that constrain the shape of the work: a lockfile
  that must resolve released versions (so a dependency has to be *published*
  before its consumer may use it), a check that forbids new dependencies, an
  asset build the test job assumes exists. A gate like this puts a release on
  the critical path — plan it first, not when you hit it.
- **Where the safety net actually is.** Which suites exist, which never run in
  CI, and which are green but vacuous — a CI job that passes while asserting
  nothing is common, and it is worth knowing before you lean on it.

Surface these to the user as constraints on the plan: they are the shape of the
work, not obstacles to route around.

**Stand up the shared infrastructure once, before the wave.** The gate
databases, the containers, and each repo's fast path exist by the time the
first worker runs — not discovered by the first worker to hit them:

- Start the gate databases the plan needs, with the roles, and keep a running
  note of the connection strings. Measured: a wave that started with no
  Postgres lost its first hour standing one up while workers waited.
- **One gate database per worker, created at dispatch**, named in the brief
  (see the brief header). Shared gate databases are a serial dependency in
  disguise: one worker's half-applied schema accuses another worker's code,
  and leftover rows fake failures.
- **Give every repo a fast path or make it a packet.** A repo whose fresh
  worktree needs `npm ci` and an asset build before its first test can run has
  a priming step the manager names in every brief; if the same priming is
  rediscovered by worker after worker, the fast path itself is a packet,
  dispatched before the packets that pay for it. Measured: the 2026-10-09
  build repeated six lines of per-repo toolchain knowledge (mise exec, serial
  Rails gates, a dedicated postgres port, a PATH entry) across ~40 briefs —
  it now lives in the repo briefs and in this skill's brief-header rule.

## When to Dispatch Workers

**Always dispatch.** The manager never does the work. For every task, the manager dispatches at least one worker.

**One worker when:**
- Task is focused and can be driven start-to-finish by one agent
- No parallel work needed
- Task is simple enough that coordination overhead isn't worth it

**Multiple workers when:**
- Task has independent parts that can run in parallel
- Different parts require different specializations
- Running sequentially would be noticeably slower
- The coordination overhead is less than time saved

**The test:** If you're not sure whether to use one or more workers, start with one. You can always dispatch more later if it feels slow.

**Saturate the free capacity — this is a standing obligation, not a judgment call.**

The manager's job is throughput, not caution. While any task is *unblocked*, the
right move is to dispatch a worker on it. A worker idling on a ready packet while
the manager waits for another to finish is the most common and most expensive
manager mistake: the work is ready, the tools are ready, and the only thing
missing is the dispatch.

So, at every health check — and every time a worker completes — ask: **what else
is unblocked right now?** Then go find it and dispatch it. Concretely:

- Keep a **queue of ready packets written and waiting**, not a list of ideas.
  A packet that has to be authored before it can be dispatched is latency the
  user pays for; author the *next* packet while the current wave runs, so the
  moment a slot frees the work is already dispatchable.
- **One worker per independent surface** is the target, not the ceiling. In a
  multi-repo project that usually means one per repo, because repos are the unit
  of independent work — a worker per repo never contends on a file.
- **The blocker test:** a task is blocked only when it genuinely cannot start —
  it needs a decision that is the user's, or it depends on an unmerged branch, or
  two tasks would make one design decision. "I haven't written the brief yet" is
  not a blocker. "I want to verify the first one lands first" is not a blocker.
- **Never serialize to reduce risk.** Two workers on independent surfaces do not
  interfere; the manager merges them independently. Sequential dispatch buys
  nothing and costs the whole run.
- **Diminishing returns are real but they are not a reason to stop early.** Add
  workers until the surfaces run out or coordination genuinely exceeds the time
  saved — and when in doubt, add one more.

**Respect the ceiling.** Capacity is bounded by the free tier's rate limits and by
the manager's own verification bandwidth: N workers means N diffs to read and N
suites to run, and that bill comes due at merge time, all at once. When you
approach the concurrency limit, stop adding — but never below what the unblocked
work justifies, and never by idling on ready packets.

**Worktrees are disk.** Each active worktree is a full checkout, often with
`node_modules`, `target/`, or a cargo cache — hundreds of megabytes to gigabytes
apiece. Remove a worktree the moment its work is merged or abandoned, not in a
cleanup pass later: run the platform out of disk mid-wave and every worker
breaks at once. Check disk during a long wave, not after it.

**Worktrees are not the biggest consumer — the build caches are.** Learned the
hard way: a nine-worker wave took a 10 GiB volume to 141 MiB free, and the
cause was not the checkouts. It was `~/Library/Caches/go-build` at 3.6 GiB,
ballooned by every Go worker rebuilding from a cold cache in its own worktree,
plus one 3.7 GiB Rust `target/`. Worktree sizes looked fine; the machine was
full anyway. So:

- **Measure before blaming.** `du -sh` the worktrees, then
  `du -sh ~/Library/Caches/* ~/.cargo ~/go` and `docker system df`, and fix
  whatever is actually large. Deleting a worktree you just measured at 15 MiB
  achieves nothing.
- **Caches are the safe thing to clear, and they are large.** `go clean -cache`,
  `docker builder prune`, `docker image prune -a`, and a worktree's `target/`
  are all rebuildable. They cost the workers time and nothing else — which is
  the right trade against a full disk, where every worker breaks at once.
- **Prune while there is still room.** A cache is 1% of the volume at 50% full
  and the whole problem at 100%.
- **A full disk kills workers silently and takes infrastructure with it.** Every
  process writing to the full volume died, and the container runtime went with
  them, so four workers lost both their work *and* their environment in one
  event. When a worker dies, check disk before concluding anything about why.
- **Recovery is: commit the uncommitted files first, then re-dispatch.** A dead
  worker leaves a worktree with real work in it. Commit it as an explicitly
  labelled recovery commit — discarding it loses the packet, and merging it as
  if it were finished launders unreviewed work into history — then re-dispatch
  in the same worktree with a note saying the environment changed and that any
  conclusion drawn from the failure is void.
- **Reclaim eagerly at merge time.** Push, then remove the worktree, then gate
  the next one. A wave that gates promptly never approaches the wall.

**The worktree is not the only thing a worker leaves behind.** Removing the
checkout and stopping there is how the volume fills up anyway. Every worker that
ran a real gate also left **a database and a container**, and those outlive the
worktree by default: after one wave, Docker's local volumes were 7.4 GiB and
`docker system df` showed the largest single consumers as
`identity-worker-identity-06_postgres-data` and its `-07` and `-08`
successors — three generations of workers' databases, none of which any
surviving worktree still needed. So the reclaim is:

- **Push, remove the worktree, then remove what it provisioned.** A worker's
  container and volume outlive it by default, so they need removing by name at
  merge time, in the same step — not in a later sweep that may not happen.
- **Name by generation, not by "anything unused".** Containers and volumes named
  `<repo>-worker-<id>-*` belong to a worker; when that worker merges, they go.
  A blanket `docker system prune -a` is the wrong tool: it is indiscriminate, it
  can take infrastructure another person is using, and on a shared machine it is
  the one action that can destroy someone else's state. The measured reclaim from
  removing six named containers and three named volumes was 7.4 GiB → 5.8 GiB;
  the same sweep with a prune would have been both riskier and less effective.
- **Check `docker system df` in the same sweep as `df -h`.** They measure
  different things and the gap between them is where the leak is. A wave that
  looks fine on the volume can be 7 GiB into Docker volumes.
- **Leave alone what is not ours.** Containers belonging to another tool or
  another person (`searxng-*`, a `kamal` buildkit) are not cleanup targets, and
  neither is a volume with no cafaye worker name in it. Being conservative about
  what you delete is not the same as being slow about deleting your own.

**Before splitting two tasks, name what they share.** A shared *design decision*
— the same behavior surface, the same state machine, the same shared state —
makes them one task. A shared *file* — a test harness, a config, a lockfile, a
registry — does not, but it needs one owner: give that file to one worker and
tell the other to keep out, or sequence them so the second is cut from the
first's merged result. Two workers independently patching the same harness is
the expensive case: both arrive at the same fix, and the manager reconciles two
versions of one idea.

## Running Workers with OpenCode

**OpenCode CLI is already installed and set up at `/Users/kaka/.opencode/bin/opencode`.** Workers are dispatched by running opencode with a message.

**Basic usage:**
```bash
opencode run --model <model-id> "your task description here"
```

**Example:**
```bash
opencode run --model opencode-go/beam-free "Add a worktree info command to yamine"
```

**For more options:**
```bash
opencode run --help
```

**Dispatch in the background and capture the transcript** — the log file is
the manager's monitoring surface (tail it, check its mtime; see How to Monitor):
```bash
cd <worktree> && opencode run --model opencode-go/beam-free "<brief>" > /tmp/worker-<task>.log 2>&1 &
```
For real packets always use `dispatch-retry.sh` — it handles the 5h cooldown.
A bare `opencode run` bypasses all of that.

**For a real packet, dispatch through `/Users/kaka/Code/any/moon/dispatch-retry.sh`,
not a bare `opencode run`.** It is the fleet's dispatcher and it is where the model
policy lives: it runs the manager's chosen model on every attempt, falls through the
chain when the chosen one is rate-limited or erroring, records a 5-hour cooldown
when a model answers with a rate limit or an endpoint error, and records nothing for
a workspace refusal (that is skipped for the run only). A bare `opencode run` gets
none of that, so it will happily re-dispatch a model that has told us to go away.
```bash
/Users/kaka/Code/any/moon/dispatch-retry.sh <worktree> <brief-file> <log-file> [max-attempts]
```
`WORKER_MODEL=<id>` optionally pins the model for this dispatch (must be
`opencode-go/beam-free`). `WORKER_MODELS="<id>"` may restate it. Both are
validated fail-closed: anything other than `opencode-go/beam-free` is refused
with exit 4 and nothing is dispatched. Exit 3 means the model is in cooldown or
unavailable — a fleet halt, to be reported, not worked around.

**The v2 CLI takes the directory positionally — there is no `--dir`.** Passing it
errors out with `Unknown flag`, and so does a bare model name like
`--model beam-free`: the provider prefix is required, so
`opencode-go/beam-free`, never the unprefixed name. Long briefs go through
`--file <path>` with the instruction as the positional argument.

**Briefs must bound long commands.** Anything network-bound or slow — docker
pulls, apt, bundle install, reproduction runs — must be wrapped in `timeout N`
and print progress checkpoints. An unbounded command is a silent ten-minute
tool call the manager cannot see into.

**A worker is a one-hour resource, planned in quarters.** A quarter is a
15-minute block of the worker's clock, which starts at dispatch: Q1 (0–15),
Q2 (15–30), Q3 (30–45), Q4 (45–60).

- **The manager states the quarters in every brief.** One line: "you have one
  hour, in four 15-minute quarters — plan your own quarters." The manager does
  not plan each worker's quarters for it; the worker decides how to fill them.
- **Q1 ends with a first meaningful commit.** A commit need not be a finished
  packet: the substrate, the failing test, the fixture — anything committed
  with an honest message counts.
- **The Q2 gate: commit, or report and self-exit.** At the end of Q2 a worker
  has either made a commit (and continues into Q3) or it stops: it writes the
  handoff report — what the packet is for, what it learned and ruled out,
  what it tried, the successor's first move — and exits cleanly. The report
  is how thirty minutes of gathered context survive the stop, and it is what
  the successor's brief is built from. Briefs must say this explicitly, so
  the worker self-exits instead of being killed mid-thought.
- **Zero commits at the end of Q2 anyway → the kill is the backstop.** The
  packet was shaped so the worker cannot bank progress and it ignored the
  gate. Commit whatever is in the tree as a labelled recovery commit
  (`recover(<id>): …` — as with a dropped provider), salvage anything useful
  from the log tail, and re-dispatch a packet whose first instruction yields
  a commit in minutes (get the current state to green, land the smallest real
  change), never the same brief unmodified — the brief is what produced the
  stall.
- **Q4 ends the run: self-exit before Q4 closes.** Finish the current commit,
  leave the worktree green or honestly labelled, write the detailed report
  and the handoff (below), and exit cleanly. Running a long verification past
  the hour is not wrap-up — hand the verification to the successor with the
  exact command.
- **Spillover of WORK is expected; spillover of CLOCK is not.** Leaving work
  undone is fine and is what the handoff is for. A worker must never lie,
  loosen a gate, skip verification, or do the wrong thing to be done on
  time — wrapping up cleanly so a successor can pick up is a good outcome,
  not a failure.
- **60 minutes is the hard backstop, not the plan.** Kill only a worker that
  ignored the Q4 self-exit.
- **A worktree whose worker hit the ceiling is never merged as-is.** The
  report feeds the successor's brief; the relay continues in the same
  worktree on the same branch; the packet merges only when a worker that did
  NOT hit the ceiling completes it. Merging ceiling-salvage launders
  unverified work into history.
- **Test only the change.** The budget forbids spending a quarter of it on a
  suite that mostly re-verifies what the change did not touch: run the narrow
  command — the one package, directory, or spec the diff reaches — and name
  that command in the brief. A full gate is for the manager's verification of
  the merged result, where it runs once, not for every worker's every step.
- **When the full suite genuinely is the gate, making it fast is a packet of
  its own, dispatched first.** If a change cannot be verified except by a
  suite that outlives the budget, the decomposition is wrong: schedule a
  worker to make the suite fast (narrow it, parallelise it, cache it) before
  the packet that needs it. The constraint is honest verification inside the
  hour: a worker that could not run its gate reports exactly what ran and
  what did not — never a verified claim without the run to back it.
- **A stalled worker is not always the worker's fault — often it is the
  manager's.** A mis-sized packet, a missing prerequisite, a brief that
  buries the goal under context, a worktree that was never primed, two
  packets silently sharing one design decision: these fail the worker from
  the dispatch side. When a worker fails or stalls, ask what the dispatch got
  wrong and fix that in the next brief, instead of re-briefing the same
  packet at the same worker.

**The handoff is a file, not a paragraph.** A worker wrapping up for a
successor writes its full context to a new file in the repository
(`HANDOFF-<packet>.md`), so the successor reads it instead of rediscovering
everything: what the packet is for, what is done and verified, what is
half-done and why, the currently-failing command with its real output,
decisions made and why, and what the successor should do first. The manager
then edits that file into the successor's brief — the worker writes the
context, the manager turns it into the prompt.

**An unfinished packet with a handoff is a relay, not a merge.** When a
worker stops with work remaining — by its own Q4 self-exit, or stopped at the
backstop:

- **Do not merge** its branch and **do not remove** its worktree — the
  successor continues in the SAME worktree on the SAME branch, where the
  gathered context, the primed environment and the committed increments
  already live.
- Compose the successor's brief from three sources: the handoff file, the
  stopped worker's report, and the context the manager has amassed meanwhile
  (reference readings, decisions made since dispatch, anything the manager
  learned while studying the work). Edit them into one prompt — do not
  append three documents and hope.
- One packet may pass through several workers this way. It merges only when
  the packet is accomplished; until then the branch is the relay baton, and
  every handoff makes the next hour more effective than the last.
- When the packet IS accomplished — by a worker that finished inside its
  hour, not by one the backstop stopped — the normal closing applies:
  verify, merge, push, reclaim the worktree.

**The hour, in quarters:**

| quarter | window | worker | manager |
| --- | --- | --- | --- |
| Q1 | 0–15 | explore, make the first meaningful commit | dispatch; author the next packet, not a wait loop |
| Q2 | 15–30 | commits 2–3, gate green on its branch — or, with nothing committable, write the report and self-exit | zero commits past Q2 with no report → backstop kill, recover, reframe |
| Q3 | 30–45 | main body of work; start wrapping if the work is nearly done | verify earlier packets, merge, reclaim |
| Q4 | 45–60 | self-exit BEFORE Q4 ends: last commit, detailed report, handoff file | if unfinished: successor in the same worktree — the branch is never merged from a ceiling hit |

- The quarters are a shape, not a stopwatch to obey with `sleep`. They tell a
  worker that an hour is the whole budget and a commit in Q1 is the
  expectation, and they tell the manager when the response to a quiet worker
  is a kill-and-reframe rather than another wait.
- The manager's column is the other half: smaller packets, not more
  supervision. A packet the worker cannot meaningfully commit inside Q1 is two
  packets. The fix is in the decomposition and the brief's first instruction —
  never in naming files the worker should edit and never in authoring the
  content yourself.

**Where the harness can track a background task, prefer one tracked task per
worker** over a bare `&` — a tracked task's completion wakes the manager, while
a detached process runs on unwatched. The log tail below is still the fallback
and still applies: a tracked task tells you *when* a worker ended, the log tells
you *how it went*.

**Prime a fresh worktree in the brief.** An app with an asset pipeline has no
`node_modules` and no built stylesheet in a brand-new worktree, so the first
browser test dies on a missing asset and the worker spends its opening minutes
decoding that instead of working. Name the priming commands in every brief that
will run a browser — usually `bundle install`, `npm ci`, and the test
environment's asset build.

**Workers can ask questions** — the manager answers in the same session, don't start new sessions.

## How to Delegate

**Give workers goals, not instructions:**
- **Goal:** What to achieve — one clear statement
- **Done means:** Concrete, verifiable outcome — "this test passes", "this endpoint returns X"
- **Patterns to follow:** Which coding patterns or skills to apply
- **Avoid:** What NOT to do at a high level — don't over-engineer, don't refactor unrelated code

**Don't give workers:**
- Exact files to edit
- Specific function names or signatures
- Line-by-line implementation details

Manager sets the guardrails. Worker figures out how to stay within them.

**THE BRIEF HEADER — three things every brief carries, because the fleet
measured the cost of leaving them out.** These are facts the manager holds and
the worker should not burn a quarter discovering; naming them is information
flow, not micromanagement:

1. **The gate environment, created before dispatch.** Every repo with a
   database gate gets its own database/schema created by the manager at
   dispatch time, named in the brief, with the connection string and any admin
   DSN spelled out — the worker provisions from there, never shares one.
   Measured: workers lost quarters to a shared gate DB's wrong password, to
   another worker's half-applied schema, and to rows left over from earlier
   runs. One named database per worker removes the whole family.
2. **The repo's toolchain quirks.** One paragraph: how to run this repo's gate
   (`mise exec -- ./bin/prime` on the repos that need it), any gate that must
   run serially (a pg-gem fork segfault), any gate that uses its own service
   port rather than the shared cluster, any binary that must be on PATH. The
   measured build rediscovered all of these per repo, per worker, the hard way.
3. **The narrow verification command** (below), and the honest note when the
   full suite genuinely is the gate.

**Size the packet by its first commit, not by its finish.** The unit of a
packet is the smallest thing that yields a committed, verifiable delta
inside Q1. A packet whose only commit point is "all of it, done" cannot bank
progress and cannot be told apart from a stall. So:

- If the goal cannot be first-committed inside Q1, **split it into
  packets that can** — and sequence or parallelise them. "Get the current state
  to green" is a packet. "Build the substrate and the drivers and the gate and
  the prose" is four.
- Give the worker an explicit first move that ends in a commit. Not a file
  list — a goal-shaped opening: "run X, make it pass", "write the failing test
  that reproduces this", "land the schema first". The worker still decides how.
- Name the narrow verification command in the brief — the one package or spec
  the change reaches — so the worker does not spend a quarter re-running what
  it did not touch. If the change genuinely needs the full suite and the suite
  is slow, make the suite fast first as its own packet; a worker that cannot
  fit its verification inside the budget must report what it ran and what it
  did not, not claim green.
- State the time budget in the brief: one hour in four 15-minute quarters
  ("plan your own quarters"), commit as you go — first meaningful commit in
  Q1, a commit per gate-green increment after — and Q4 is the wrap-up: last
  commit, honest report, and a handoff file if work remains (what is done and
  verified / half-done and why / the currently-failing command with its output
  / the successor's first move).
- **The response to a sizing mistake is a smaller packet, never more
  supervision.** Do not micromanage the fix: do not start naming files the
  worker should edit, and do not author the content yourself. Re-decompose.

**Seven rules that earn their keep, learned the hard way:**

1. **Bound the search space.** An audit, cleanup, or "remove dead code" goal is
   open-ended unless you bound it: name the surface ("only what this change
   orphaned", "only these directories") and put *do not attempt a repo-wide
   sweep* in the avoid list. Grep- and import-graph-based dead-code detection
   mislabels anything referenced from an entrypoint, a manifest, an importmap or
   a template — a worker sent to sweep `app/javascript` spent an entire run
   building a table of false positives and shipped nothing.
2. **Cite the house rule, never paraphrase it.** When a brief restates a project
   rule, point at where the rule lives instead of restating it from memory. The
   paraphrase becomes the regression: a brief that said "drop empty or
   whitespace-only deltas" overrode a release note that exists precisely because
   dropping whitespace turns "due 45 days" into "due45days" — and the worker
   implemented the brief faithfully, test and all.
3. **For bugs, flakes and performance, require understanding before fixing.**
   The brief must ask for a deliberate reproduction and the mechanism with
   numbers, a "what I ruled out" with evidence, and a fix that is not a sleep, a
   raised retry count, or an assertion loosened to "eventually". State the
   alternative too: if it cannot be reproduced, a reported mechanism plus honest
   uncertainty beats a fix. This single clause is what turns "the widget test is
   flaky" into "the listener registers 1–3.3 ms after the composer takes keys,
   so a fast Escape lands on a deaf widget" — a real bug, fixed in the app
   rather than papered over in the test. For performance work, ask for
   before/after numbers; the same instinct that measured a 149 kB cost went on
   to find a 140 kB saving.
4. **Ask what was deliberately *not* done.** Require a short section in every
   report: what the worker chose to leave alone, and why. It is the
   highest-signal paragraph a worker writes — it surfaces undocumented API,
   fields nothing ever sends, unscoped global rules, and pre-existing failures
   that would otherwise be mistaken for the worker's own.
5. **One brief = one worker = one process tree. Forbid nested agents.** State
   in every brief's avoid list: do not spawn `opencode run`, `claude`, or any
   other agent, sub-agent, or subprocess that does independent work. A worker
   that reaches for a sub-agent produces code nobody briefed, nobody reviewed
   in context, and nobody will verify against the packet — the manager sees
   commits from a writer that does not exist in the plan. This is not a style
   preference; it is how unowned code gets into a merge. If a task looks too
   big for one worker, **split it into two packets and dispatch two workers** —
   that decomposition is the manager's job and cannot be delegated downward.
   Detect and kill strays: `lsof -p <pid> | awk '$4=="cwd"'` maps each process
   to its working directory, which is how phantom writers are identified. **And
   before re-dispatching a packet, prove the old process is gone — with `ps`,
   not with the evidence you happen to be holding.** A quiet log is not a dead
   process: a worker that has finished its turn sits there emitting summary text
   for minutes, and a worker that survived something you attributed to a crash
   simply keeps running. I concluded a worker had died with the disk, committed
   its files as a recovery commit, and re-dispatched it in the same worktree —
   and the original was alive the whole time, so two processes spent twenty
   minutes editing the same config file and both committed from it. The tell was
   in evidence I had not looked at: the log's mtime was fresh. **Check every
   worker's log mtime in the same sweep where you check pids**, and treat "the
   log stopped moving" as evidence of nothing. A duplicate writer is worse than a
   stalled worker — a stalled worker loses nothing, and a duplicate writer
   produces a merge that neither writer reviewed.
   **The signature of a dropped connection is a log that ends mid-sentence with
   no error line and a clean tree.** That is neither a stall nor a fault in the
   packet: free-tier model capacity drops the session and there is nothing in the
   log to show for it. Do not go hunting for a bug in the brief, and do not
   re-dispatch from the top — commit whatever is uncommitted as an explicitly
   labelled `recover(...)` commit, then re-dispatch **in the same worktree on
   the same branch** with a note that the provider dropped it, the environment is
   fine, and any conclusion about being finished or unfinished is void. Two
   workers each lost a full run to this in one wave while the machine had 12 GiB
   free, which is precisely why "it must be the disk" is a hypothesis to test
   rather than a conclusion to act on.
6. **A worker stopped on a question is answered, never abandoned.** When a
   worker's log shows it waiting for a decision — a question, a blocked
   permission, a fork in the road — do not leave it parked and do not guess at
   the intent. Read the log, decide the answer yourself, and re-dispatch *in the
   same worktree on the same branch* with a short correction brief: the answer,
   then "continue from where you stopped" so the worker keeps its gathered
   context. A worker left waiting is a worktree leaked and a packet stalled
   forever. Reserve stopping for questions that are genuinely the user's — a
   scope change, a money or security policy, anything outward-facing or
   destructive — and when one of those blocks a packet, say so and keep every
   other worker running.
7. **Run every gate under `set -o pipefail`.** A manager gate piped into
   `grep` or `tail` returns the exit code of the *last* command in the pipe, so
   a suite that just failed 43 tests reads as a pass. This is not theoretical:
   it is how a broken packet was merged and had to be reverted. Capture the real
   status (`gate-exit=$?` after the pipeline, with pipefail set), and treat any
   gate whose exit code you did not actually observe as *unrun*, not green.
   When a bad merge does land, revert it forward — `git revert --no-edit -m 1
   <sha>` — and re-land the work properly; never rewrite shared history.

## How to Monitor

**Watch, don't wait:**
- Check in frequently — enough to catch drift early
- Redirect mid-task if the worker is heading the wrong way
- Answer questions in-session — don't start new sessions
- Stop the worker immediately if it's in a loop or going off the rails

**The manager is present during execution, not just at the start and end.**

### Stopping a worker — kill by PID, never by pattern

Each chain is two `dispatch-retry.sh` processes (parent + retry subshell) plus one
`opencode run` child. **Kill the two parents first, then the child**, so the retry
subshell cannot relaunch the attempt you are stopping.

**Never `pkill -f <anything>` to do it.** The worker's command line embeds the **entire
brief text**, so a pattern you think names a process usually names a *brief*, and it will
match every worker whose brief happens to contain that word. Measured, and expensive: a
cleanup `pkill -f 'bin/prime'` — intended to stop one stray gate — sent **SIGINT to five
live workers at once** (they died with `rc=130`, "not an endpoint error; giving up"),
because their briefs all mention `bin/prime` in the gate section. Committed work survived;
uncommitted work survived only because the worktrees were preserved; five reports were
never written. Resolve PIDs first, then kill them:

```sh
for pid in $(pgrep -f 'dispatch-retry.sh'); do
  wt=$(ps -o command= -p "$pid" | sed -nE 's#.*dispatch-retry\.sh (/[^ ]+).*#\1#p')
  echo "$pid $(ps -o etime= -p $pid | tr -d ' ') $wt"
done
# confirm the exact PIDs for the one chain you mean, then:
kill <parent1> <parent2>; sleep 2; kill <opencode-run-child>
```

The same rule applies to a stray child (`pkill -f opencode` would kill the fleet). If you
must match, match something only the *process* has — and even then prefer the PID.

**Watch the tail, never the replay.** A dispatched worker's transcript is a
file (the background task's stdout log). Poll `tail -c 2000 <log>` and the
file's mtime every 3–5 minutes. Replaying the full transcript on every check
hides staleness, burns manager context, and shows old news.

**The commit clock — check commits, not just liveness.** A live log with fresh
bytes says the worker is *running*, not that it is *landing*. Every health
check reads `git log master..HEAD | wc -l` in the worktree beside the log
tail, against the quarter the worker is in:

- **Zero commits at the end of Q2 → the backstop.** A worker following its
  own gate has either committed or self-exited with a report by now; if it
  did neither, stop it, commit the tree as `recover(<id>): …`, and re-dispatch
  a packet whose first instruction yields a commit in minutes. If the log tail
  holds findings worth keeping, quote them into the reframe — the worker
  cannot write its report anymore.
- **A worker that reads for a quarter and writes nothing → audit the packet
  width before blaming the model.** 70+ turns of `Read`/`grep` with zero
  `Write`/`Edit` and zero bytes on disk is not (always) a degenerate loop: it
  is the signature of a packet that is **two hours wide in a one-hour
  budget**, whose first phase is *unbounded reconnaissance*. Check the brief:
  if step 1 is "understand this 1000-line script and the three repos it
  touches" with no bound, the worker will spend the whole hour understanding
  and never commit. The fix is a **split on the real seam** (files vs. run;
  manifest vs. chart; topology vs. proof) plus, in each half, **the exact
  command to run and an explicit "read only this, then stop"**. Measured: two
  site workers each burned 15 minutes on the same too-wide packet; the split
  half committed in Q1.
- **End of Q4 → the backstop.** A worker following its own contract
  self-exited before Q4 closed; if one is still running, stop it. Recover
  anything uncommitted as a labelled commit — and **do not merge the branch**:
  a ceiling-hit packet is relayed to a successor in the same worktree, and
  merges only when a worker that did not hit the ceiling completes it.
- Compare against the dispatch time, not the time you first noticed the
  worker — record a start time per worker when you dispatch.
- **When the kill fires, audit the dispatch before blaming the worker.** A
  mis-sized packet, a missing prerequisite, a buried goal, an unprimed
  worktree — these are dispatch errors that failed the worker, and the fix
  belongs in the next brief.

**Heartbeat rule — 10 minutes of log silence is a stall.** Free-model turns
can stall provider-side with no error: the process stays alive, CPU ticks,
the log writes nothing. On 10+ minutes with no new log bytes:
1. Check the process: alive? does its CPU advance? (spinning ≠ progress)
2. Stop the session; probe with the same model bounded to ~2 minutes:
   "reply with your last command and its result — no new work"
3. Probe answers → continue in-session with corrected instructions
4. Probe silent → skip that model for the remaining work (switch to the other
   allowed model) and note the skip. A stall is not a rate limit —
   no cooldown applies, but the model is done for this dispatch

## Study the Work While the Workers Run

The manager is the workers' best right hand, not a spectator with a stopwatch.
Between health checks the manager is doing its own work: understanding what the
packets touch, so the next dispatch is smarter than the last one.

**Use every resource available — always:**

- **Read the code** workers are changing and the code they will change next.
  Packet sizing, merge judgement and bottleneck-hunting all run on
  first-hand knowledge of the tree, not on workers' reports alone.
- **Read the references the repo already carries** — docs, decision records,
  changelogs, READMEs, the gates' own comments. Most bottlenecks are already
  written down somewhere in the tree.
- **Research outside the repo when the tree's answers run out** — tool
  documentation, upstream issue trackers, specifications, prior art in other
  projects. The manager has the same web and filesystem the workers have.
- **Read workers' diffs and reports as they land.** They are the highest-signal
  input for what the next packet should be: what surprised them, what they
  left out of scope, what took longer than it should have.

**Hunt for bottlenecks, and turn each one into a packet:**

- A gate that eats a quarter of every worker's hour → a make-it-fast packet,
  dispatched before the packets that pay that cost (narrow it, parallelise it,
  cache it).
- A prerequisite every packet rediscovers — a fixture, a primer, a schema, a
  scaffold → a packet that builds it once, so later packets start from done.
- The same question answered independently by several workers → a decision
  record or doc packet, then cite that file in briefs; never re-paraphrase it.
- A serial dependency chain in the plan → find the piece that unblocks the
  most parallel work and dispatch it first.
- A shared design decision nobody owns → resolve it or make it a packet before
  two workers collide on it.

**Unblock, don't micromanage:**

- Answer a worker's question fast and with substance — the manager is the one
  holding the user's intent and the repo's history.
- If information the worker needs is findable in minutes, find it and hand it
  over; do not let the worker spend an hour discovering what you already know.
- The line: information and context flow from the manager freely; file lists
  and line-level instructions never do.

**THE SEAM AUDIT — a standing wave-closing packet, not a reaction.** When a
wave's packets are merged and the repos are green, dispatch one read-only
audit across the repos the wave touched: do the cross-repo shapes actually fit
each other? Per-repo gates cannot see the joins, and the measured 2026-10-09
build proved it — every repo was green throughout while five of the system's
seams were broken (routes no server mounted, a field no server sends, a grant
no client calls). The audit is cheap (one worker, read-only, one report file
with both sides' file:line per finding and a "verified-fitting" list so a
clean result is also evidence) and it is the highest-ROI artifact the fleet
produces. Its report lives as a peer document to the plan doc, and every
finding it raises gets a repair packet dispatched like any other. **A green
wave is not a finished wave: the seams are unverified until an audit says so.**

## How to Verify

After worker reports completion:
- Read the actual diff (not the report)
- Run the tests
- Confirm the outcome matches "done means"
- If it matches → **merge it now** (see the exit rule below)
- If it doesn't → re-dispatch with corrected instructions

**THE EXIT RULE — a worker exiting is a manager event, not a report-to-user
event.** When a worker self-exits or its dispatcher exhausts its attempts, the
manager's very next action is to decide this packet's fate, and the options are
exactly two:

1. **Accomplished and verified → merge within the hour.** The manager's own gate
   runs first (below), and if it is green the merge lands before the manager
   starts anything else. A finished tree sitting unmerged is not rest — it is
   the stale-branch hazard accruing: every merge delayed past the next packet's
   dispatch on that repo costs a rebase, and every floor-raising branch that
   waits behind another costs a conflict rebuild. Measured on the 2026-10-09
   build: 5 of 8 late merges needed rebases, and 4 floor conflicts were pure
   merge-latency cost.
2. **Not accomplished (or not verifiably green) → dispatch the successor IN THE
   SAME WORKTREE before starting anything else.** The handoff report is written
   for exactly this: read it, edit it into the successor's brief, dispatch. The
   successor's brief is the manager's next work, not a task for later.

The manager never sits idle with finished-or-failed work in a tree. "I'll
merge it after the current wave settles" is the failure mode this rule exists
to kill: while the manager waits, the branch goes stale, the next street
worker on that repo builds on the wrong base, and the merge that would have
taken two minutes takes an hour.

**Re-gate every self-exited tree before merging — always.** A worker's own
green claim, its report, and its clean tree are inputs, not evidence: the
manager runs the gate on the tree that exists. This is the one discipline that
caught both bad outcomes of the measured build — a worker that self-exited
believing green with two red security tests, and a "fix" that made the suite
green by stubbing a fake shape instead of fixing the code. Neither was
dishonest; both were a green run the worker should not have trusted, and both
were caught by one re-gate after the rebase. **After any rebase, the gate runs
again** — the rebased tree is a different tree from the one the worker gated.

Verification is the manager's own work, never optional: N workers means N diffs
to read and N suites to run, plus the merged result. Count that bill when
choosing how many workers to dispatch — then pay it in full; it never justifies
skimming a diff or trusting a report.

- Never accept "tests pass" without evidence. Never report unverified work to
  the user.

**Attribute a red run before believing it.** In a suite with known flakes, a
failure is not evidence about the change under test.

- Identify the failing test first — failure artifacts are the fastest path
  (Rails/Capybara/Pytest name a screenshot or dump after the test that failed).
- Ask whether the diff can even reach that surface, and compare against a
  clean baseline.
- The gold standard for flake work: the worker stashes its own change and
  measures the failure rate on clean HEAD, so the fix is measured against
  something.
- A fix measured against a moving baseline is not measured, and one green run
  in a flaky suite is not proof.

**For every deletion, name the consumer and check it directly.** A green suite
does not prove that nothing outside the suite used it.

- Grep the language-level call sites *and* the string-level ones (raw headers,
  accept types, manifest entries, class names in templates), then read the one
  that matters.
- A registration whose own comment said "the voice worker's wire format" looked
  load-bearing; the voice path actually wrote that header by hand — removing it
  was safe, but only reading the consumer settled that, not running the suite.

**When a gate needs a database, give your gate its own — do not serialize to
protect a shared one.** A shared test DB forces "one gate at a time", which
stalls a whole repo behind a single slow suite. If the DB runs in a container
you control, the manager can clone it per gate:

```sh
docker exec <pg-container> psql -U postgres -c "CREATE DATABASE <repo>_gate_<id> OWNER <role>;"
docker exec <pg-container> psql -U postgres -d <repo>_gate_<id> -c "GRANT <app_role> TO <role>;"
# then MIGRATE it with the repo's own entrypoint, then run the gate against it:
<dsn-var>='…/<repo>_gate_<id>?sslmode=disable' <repo>/bin/migrate   # or goose/ecto.setup/rails db:setup
<dsn-var>='…/<repo>_gate_<id>?sslmode=disable' mise exec -- ./bin/prime
# and drop it after: SELECT pg_terminate_backend(pid) …; DROP DATABASE <repo>_gate_<id>;
```

Two traps, both measured: **a created-but-unmigrated DB fails with a schema error
that reads like a code defect** (`relation "public.users" does not exist` when a
test clones `public`), so migrate before you conclude anything; and **the migrate
entrypoint and the gate often read different env vars** (identity's `bin/migrate`
reads `DATABASE_URL` while its gate reads `TEST_DATABASE_URL`) — set both. This
was proven on identity: 28 packages green on an isolated DB while another identity
worker ran in its own worktree, where the shared DB would have serialized them.

## Model Configuration

- `worker_tool`: opencode
- `worker_tool_params`: always pass the exact full model ID explicitly; never rely on a default.

**Allowed worker model ID — only this one (verified in the live `opencode models` catalog):**

1. `opencode-go/beam-free` — GO route, ever-present

**GO ROUTE ONLY — always, never the non-go route.**
Every worker model is dispatched on the `opencode-go/` provider. An `opencode/`
console route is never dispatched — not even the same model name on the console
provider, not even when the Go route is rate-limited. It is a different endpoint
with its own free-tier limits. "Everything is in cooldown" is a report, never a
reason to reach for a console route.

Only `opencode-go/beam-free` is a worker model. No other ID, no near match, no
alias, no name inferred from a suffix.

Three things make this list the whole permission:

- **It is closed.** No second model, no near match, and no ID inferred from a
  name. Only the ID above is a worker model.
- **Only an explicit user instruction naming a model can change the allowlist.**
- **A model that no longer appears in `opencode models` is not dispatched.** The
  name is verified against the live catalog before dispatch, not after.

If a route ever answers `This Go model trains on request data…`, the workspace
Privacy opt-in has been turned off — report that to the user; it is a workspace
setting, not a model to swap.

**The model is free and is not billed to the GO subscription.**

**The manager does not assign by packet type.** There is only one model, so there
is nothing to route.

Unavailable means the dispatch stops (there is no next model to walk to):
- an explicit model-unavailable answer — `Model unavailable`,
  `Invalid model reference`, or a workspace refusal
- a rate limit, which starts a 5-hour cooldown
- the endpoint erroring (`Endpoint is unavailable`, `Upstream request failed`) —
  the same 5-hour cooldown

A generic worker/task failure is not a reason to switch models. A red test, a
bad patch, a tool that exited non-zero, an honest partial: the run reports or
stops on the chosen model. There is no other entry.

Ordinary slowness is not a reason to switch either. The stall path below applies.

Nothing else gates the choice — no repository visibility, no per-repo ordering.
The instructed model runs on every repo, public or private. The training-data
decision is the user's and is not the manager's to re-litigate: never substitute
a model on your own initiative, and never reach for a non-allowlisted route.

**Rate limit / error cooldown — 5 hours, enforced by the dispatcher:**

- A rate-limit-exceeded error OR an endpoint error starts a **5-hour cooldown**
  from the observed failure time. A second failure restarts it.
- Cooldown applies to **only** those two error families — slowness, timeouts,
  generic worker errors, and workspace refusals do NOT start a cooldown.
- **The record lives in a file and the dispatcher reads it.** `moon/model-cooldown.sh`
  owns `moon/state/model-cooldowns` (one line per model: `<model-id> <epoch>`), and
  `moon/dispatch-retry.sh` consults it on **every attempt**:
  - `model-cooldown.sh list` — what is blocked, since when, and when it clears
  - `model-cooldown.sh block <model> [<epoch>]` — start/restart a 5h cooldown
  - `model-cooldown.sh pick <model>...` — first model not in cooldown; exit 1 if none
  - `model-cooldown.sh clear <model>` — a **deliberate** override; manager only, with a reason
  The dispatcher runs the model when it is not in cooldown, and on a rate limit or
  endpoint error it calls `block` before the next attempt. So the rule holds even
  when nobody remembers it, and it survives across sessions and restarts.
- **Detection is on the exact opencode strings, and only from the current attempt's
  bytes** (by log byte offset):
  - `Rate limit exceeded` → 5h cooldown
  - `Endpoint is unavailable` / `Upstream request failed` → the same 5h cooldown;
    the erroring model is not retried
  - `Model unavailable`, `Invalid model reference`, or
    `Upstream request failed: … trains on request data` → **unavailable**: skip for
    the rest of THIS run (no cooldown)
- **If the model is unavailable or in cooldown, `dispatch-retry.sh` exits 3** and
  says so loudly in the log and on stderr. Treat that as a fleet halt: report it
  to the user. Do not silently `clear` a cooldown to keep the fleet moving.

**The model roster — one model, on the GO route:**

1. `opencode-go/beam-free` — GO route, ever-present
- No assignment by packet type. There is only one model.
- A `Model unavailable` or `Invalid model reference` error is **not** a cooldown —
  the model is gone from the catalog. Redispatch is impossible until it returns;
  report to the user.

**When models fail, tell the human:**

- If the model fails, errors, or underperforms repeatedly → report to the user
  immediately
- Do NOT keep hammering the same failing model
- Tell the user which model failed, why, and that there is no fallback
- Let the user decide whether to keep trying, wait for cooldown, or stop

**Handling an unresponsive or stalled session:**

- Never wait many minutes with no response or error — check frequently enough to
  know if it's a normal delay or a failure
- When the slowness threshold is crossed, **stop the session** and send a
  diagnostic probe with the SAME model
- If the probe proves the route **unavailable** — `Model unavailable`,
  `Invalid model reference`, a workspace refusal, a rate limit, or an endpoint
  error — there is no next model to move to; report to the user
- **If the probe succeeds, the model stays.** A slow-but-responding model is still
  the model for that packet
- Silence means no new log bytes, not "the model is thinking"
- A diagnostic probe that returns empty output counts as silent → treat as
  unavailable and report
- A probe failure is a stop and a report, not a wider search

**Non-negotiable allowlist rule — do not use any models apart from the listed one:**

- **Do not use any model apart from `opencode-go/beam-free`.** Not similar-looking,
  not aliases, not abbreviations, not suggestions from tool output, not "the same
  model under another name" — if the exact string is not the one above, it is not
  dispatched, full stop.
- Use only the exact ID listed above, on every repo, with no visibility condition
- **No non-allowlisted route, ever.**
- If the model is unavailable → stop and report; never substitute, never widen the
  pool, and never reach outside it to avoid the report
- Only an explicit user instruction naming a model can change this allowlist


## Parallel Work with Yamine

When dispatching multiple workers:
- One isolated worktree per active worker; use Yamine when available
- Split by outcome, not by file: if two goals would need one coherent design
  decision (the same behavior surface, the same state machine, the same shared
  state), they are one task. Separate worktrees make concurrent editing safe;
  merge conflicts are normal and the manager resolves them during integration
- Resolve conflicts by kind: mechanical ones (adjacent hunks, lockfile noise,
  changelog ordering) the manager fixes during integration; semantic ones (the
  changes disagree about behavior) go back to the owning worker, rebased on the
  new master
- Each worker gets its own goal, done criteria, and avoid list
- Workers do not coordinate with each other — they report back to the manager
- Never launch a second agent from inside a worker — see rule 5; parallelization
  is the manager's decomposition, not the worker's
- Manager merges verified work, pushes it under whatever authorization the user
  has granted, and cleans worktrees through Yamine. A merged worker's worktree
  is removed immediately — a worktree left standing is a leaked directory and a
  branch that will collide with the next packet's name
- Launch workers a couple of seconds apart, not in the same instant: opencode
  keeps sessions in one local database, and simultaneous launches can fail with
  `database is locked`. That error is transient, not a rate limit — retry the
  launch once (no cooldown, no model switch), and keep the launches close enough
  that the workers still run concurrently

## Pitfalls (watch for)

- Worker not following coding patterns → redirect: "Follow the patterns in X" or "Read skill Y and apply it"
- Worker exploring files beyond what's needed → redirect: "You don't need to look at that. Focus on X."
- Trusting test claims without evidence → inspect output/diff
- Worker asks a question and you're tempted to start a new session → don't; answer in the same session so it keeps its gathered context
- Worker loops or goes off rails → stop immediately, re-dispatch with clearer instructions
- Splitting tasks that share state → if two tasks need one coherent design decision (the same behavior surface or state machine), they are one task
- **Workers finishing while unblocked packets sit undispatched** → the whole point of parallelism was to avoid that wait; author the next packet now and dispatch on completion
- A worker idling on a ready packet because the brief isn't written yet → the brief is the latency, not the worker; keep a written queue, not a list of ideas
- Sequentializing dispatch "to be safe" on independent surfaces → safety comes from the merge step, not from running things one at a time; serialize only on a real shared design decision. **A shared test database is not one** — clone it per gate instead (see "When a gate needs a database" above)
- Over-decomposition → if coordination overhead exceeds time saved, use one worker instead
- Monitoring by replaying a worker's whole transcript → poll the log tail and mtime instead; replays hide stalls and burn manager context
- Long commands left unbounded in a brief (docker pull, apt, bundle install) → require `timeout N` and progress checkpoints; unbounded commands are invisible stalls
- Brief that names an outcome but not its surface (audit, cleanup, "dead code") → the worker sweeps the whole repo and ships a table of false positives; bound it and forbid the sweep
- A house rule restated from memory in a brief → cite the file that holds the rule; a paraphrase is how a regression gets specified
- Trusting the first red run in a flaky suite → attribute it first (which test, can the diff reach it, what does clean HEAD measure) before re-dispatching anything
- A fresh worktree dispatched without its priming commands (`npm ci`, asset build) → the first browser test fails on a missing asset and looks like a code problem
- A worker that spawns `opencode run` / a sub-agent of its own → interrupt it, kill the stray process (`lsof -p <pid> | awk '$4=="cwd"'` to identify it), and split the packet yourself
- A worker sitting on an unanswered question → read the log, answer it, re-dispatch in the same worktree; never leave it parked and never start a fresh session
- A verification gate piped through `grep`/`tail` without `set -o pipefail` → the suite's exit code is gone and a red run reads as green; run it under pipefail and echo the real status
- **A worker with a fresh log and zero commits at the end of Q2 is the expensive failure mode** — liveness and landing are different signals. Check commits beside log liveness on every sweep; kill-and-reframe, don't keep waiting
- **Re-dispatching the same brief after a stall** — the brief produced the stall; reframe so the first move commits in minutes, and attach the recovery commit's context
- **Blaming a stalled worker when the dispatch was the fault** — mis-sized packet, missing prerequisite, buried goal, unprimed worktree; audit the dispatch and fix the next brief
- **A handoff delivered as a chat paragraph** — write it to a `HANDOFF-<packet>.md` file so the successor reads context instead of rediscovering it; the manager edits it into the successor's brief
- **A worker panicked by the clock into lying, loosening a gate, or skipping verification** — say in the brief that spillover and clean wrap-up are acceptable and shortcuts never are
- **A packet whose only commit point is "done"** — split it; the first commit should be reachable within Q1 of any honest attempt
- **A worker spending a quarter re-running a suite that covers what it did not touch** — name the narrow verification command in the brief; if the full suite genuinely is the gate, schedule a make-the-suite-fast packet first
- **A green that was made green** — the laundered gate: a worker makes the suite pass by changing what the test feeds (a stub carrying a shape the real system never sends, a fixture moved) instead of changing the code. Both bad outcomes of the 2026-10-09 build were this family: a self-exit that believed green with two red security tests, and a "fix" that stubbed a fake identity shape. The manager's only defense is the re-gate-before-merge and re-gate-after-rebase rules (How to Verify) — a worker's green claim is an input, never evidence
- **A stale branch merged as-is** — a branch that predated a merge you landed meanwhile will DELETE the merged work, not conflict politely with it. Before merging, run `git merge-base --is-ancestor main <branch>`; if it is not an ancestor, REBASE the branch onto the new main and gate it again — the rebased tree is a different tree from the one the worker gated. Measured: 5 of 8 late merges needed this; merging within the hour (the exit rule) prevents it prospectively
- **Merging on a grep you read wrong** — before committing a merge, echo the gate's exit code on its own line and read THAT number, not a summary line. A merge author once merged 8 red tests because the failure count and the exit code were in different lines of the same output; the forward revert cost an hour

## Stop / Red Flags

- Asked or tempted to use a non-allowlisted model (including a near match) → stop
- Reaching for a non-allowlisted model because the model is slow, busy, or uncooperative → stop; only an actually **unavailable** route moves the dispatch — never because a turn was slow — and otherwise report
- Dispatching anything other than `opencode-go/beam-free` → stop; that is the whole set
- Dispatching an `opencode/` console route — even the same model name on the console provider, even when the Go route is rate-limited → stop; GO route only, always, never the non-go route. An all-in-cooldown fleet is a report, not a reason to leave the Go route
- Gating a model on repository visibility, or substituting one because a repo is private → stop; the instructed models run on every repo, and the training-data decision is the user's
- Dispatching a model name that no longer appears in `opencode models` → stop; the worker dies in seconds and the packet is lost, so verify the name against the live catalog before dispatching, not after
- Retrying the free model before its recorded cooldown expiry → stop; `model-cooldown.sh list` holds the expiry and the dispatcher enforces it
- Every eligible model unavailable or in cooldown (`dispatch-retry.sh` exits **3**) → the fleet is halted; report to the user and wait, never silently `clear` a cooldown to keep moving
- A run sits silent for many minutes → stop the session and send the same-model test message; never leave its state unknown
- Tempted to put a model on cooldown for slowness, a stall, or a generic worker error → don't; cooldown is for rate-limit-exceeded and endpoint errors only
- **Tempted to switch models mid-dispatch because a worker failed at its task, a test went red, or the run merely felt slow** → don't. A generic failure or ordinary slowness is reported or stopped on the chosen model; only a genuinely unavailable route moves the dispatch. (Choosing a *different primary* for the *next* packet is always fine — that is the manager's call, not a fallback.)
- Tempted to add a sixth model to the pool because every eligible model is unavailable → don't; there is no sixth entry. Stop and report
- Inferring that a catalog entry is allowed because its name ends in `-free`, `-contributor`, or anything else → don't; the one allowlisted ID is the whole permission
- Worker deviates from scope, reads skills it shouldn't, or touches unrelated files → interrupt; inspect before follow-up
- Tests fail, diffs look wrong, or verification cannot be completed → do not report to user; re-dispatch or fix
- Worker asks a question and you're tempted to start a new session → don't; answer in the same session
- A model fails repeatedly → stop retrying; report to user with details (which model, what error, how many attempts)
- Tempted to do the work yourself instead of delegating → don't; the manager never authors content, though running and integrating verified work is its job
- A worker finished and there is still unblocked work with no worker on it → stop and dispatch; idle capacity on ready work is the failure this workflow exists to prevent
- Worktrees accumulating past merge → remove each one as its work lands; they are gigabytes each and running out of disk breaks every worker at once
- About to add a sleep, a retry, or a loosened assertion so a test goes green → stop; that is the fix being hidden, and the brief should have forbidden it outright
- About to push to a branch whose push triggers a deploy, without the user's explicit go-ahead → stop; a deploy is outward-facing and irreversible
- About to ask "may I push?" for a packet that already passed its gate → standing authorization covers this; push it and dispatch the next worker instead of stopping
- About to force-push, delete a remote repo, rewrite published history, or cut a release without a specific instruction → stop; those are outside any standing authorization

Apply this workflow across codebases; adapt the editable tool and repository-specific constraints only when the user authorizes the change.
