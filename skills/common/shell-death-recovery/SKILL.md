---
name: shell-death-recovery
description: Diagnose and recover from "spawn <shell> ENOENT" errors in Bash tool calls. Use when every Bash call dies with `spawn … ENOENT` while file tools (Read/Write/Edit) still work — the signature of a deleted working directory, not a missing shell binary. Also use for prevention rules when removing worktrees or deleting directories a shell may be sitting in.
version: 1.0.0
user-invocable: true
---

# Shell-Death Recovery (`spawn … ENOENT`)

## What the error actually means

When every Bash call fails with `spawn <shell> ENOENT` (e.g.
`spawn /opt/homebrew/bin/zsh ENOENT`) while Read/Write/Edit on absolute paths
keep working, **the shell binary is not missing.** The root cause, measured
2026-10-11, is a **deleted working directory**: the shell's cwd pointed into a
directory that was removed (most often a git worktree removed while a shell or
spawned process still sat in it). From that moment every spawn dies, because the
child cannot start in a nonexistent cwd — but file tools operate on absolute
paths and are unaffected. That asymmetry is the diagnostic signature:

> **File tools work, every Bash call dies.**

Do not conclude the environment is broken, and do not stop. Diagnose first.

## Diagnosis (in order)

1. **Confirm the signature.** Read the suspected cwd path with a file tool. A
   missing directory is the diagnosis. If the directory exists, the cause is
   something else (genuine missing binary, PATH issue) — investigate normally.
2. **Check disk only if a worker died.** A full disk kills processes silently and
   can take infrastructure with it. `df -h` and `du` are the right checks there;
   a deleted cwd is the more common cause of this specific signature.
3. **Persist state first** (if you are a manager with in-flight work): write
   merge-pending branches, running detached workers, and next actions to an
   on-disk ledger using file tools, so recovery is mechanical.

## Cure

If you cannot spawn at all:

1. Ask a **native subagent** (the Agent tool, general-purpose) to fix it. It
   runs outside your process tree, so its spawns resolve, and its Write tool can
   recreate the missing directory. Measured fix: recreate the deleted directory
   with a marker file, then `cd` away from it and remove it properly.
2. The subagent can also run the diagnosis commands itself if its own spawns
   work.
3. When the shell returns, resume exactly from the ledger: verify no detached
   worker's output was lost, then carry on from the next action.

The key insight: you cannot fix a deleted cwd from inside the dead shell. You
need an agent whose process tree is unaffected.

## Prevention — the rule that makes the cure unnecessary

**Never remove a worktree or directory a shell or spawned process may be sitting
in.** Two measured failure modes (2026-10-11):

### 1. Removing the cwd you are in

`git worktree remove` on the directory your shell sits in deletes it out from
under you; every later spawn dies with the ENOENT signature.

The reclaim command's shape is:

```
cd <stable-absolute-dir> && git worktree remove <wt> && git branch -d <branch>
```

The `cd` to a stable absolute path must happen **in the same command and before
the remove runs**. Never remove a worktree from inside it.

### 2. Chaining a remove behind a piped command

`git merge … | tail -1` returns **tail's exit code** — `0` even when the merge
failed. So `&& git worktree remove` ran on a *failed* merge, deleted a worktree
holding three unmerged commits, and left the manager's tracked cwd pointing into
the now-deleted worktree: every later spawn died with the ENOENT signature.

The reclaim is **two commands**, never one chained line:

1. Run the merge bare and read its exit code on its own line.
2. Only on a verified green, run `cd <stable-dir> && git worktree remove`.

The removed worktree's commits survive on the branch — finish the merge from the
main checkout. Never re-create a worktree to merge.

### Generalized rule

- Before removing any directory, confirm no shell or long-lived process has it
  as cwd. When in doubt, `cd` to a stable absolute path first.
- Never chain a destructive `rm`/`worktree remove`/`rmdir` behind a pipe or
  command whose exit code is not the one you mean. Run the gate command bare,
  observe its exit code, then act.
- Reclaim eagerly at merge time (push, remove worktree, then remove what it
  provisioned) rather than in a later cleanup pass.

## Applying this skill

- If you are a **manager** dispatching workers in worktrees, the prevention rules
  above are standing orders: every reclaim follows the two-command shape.
- If you are **any agent** and your Bash calls suddenly all die with ENOENT
  while file tools work, follow Diagnosis → Cure. Do not report the environment as
  a wall.
- After recovery, verify by running a trivial Bash command (e.g. `pwd`) before
  resuming real work.

## When to ask the user

Only if the cure fails (the subagent cannot recreate the directory or its spawns
also die) — then report the missing path, what was tried, and ask. Do not ask
before attempting the cure; the cure is mechanical.