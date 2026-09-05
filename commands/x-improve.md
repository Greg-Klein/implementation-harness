---
name: x-improve
description: Improve this harness from explicit user feedback, with a dedicated branch, validation, and a reversible local commit.
disable-model-invocation: true
argument-hint: <feedback-directory>
---

Improve the x-implement harness from the pending feedback stored under: $ARGUMENTS

This is a controlled recursive self-improvement run. Work autonomously, but keep every change reviewable and reversible.

## 1. Establish the evidence

Read every `pending/*.json` feedback file. For each one, read the corresponding run state and relevant artifacts under `harness/data/runs/<runId>/`. Treat terminal logs, tickets, credentials and downloaded assets as confidential runtime evidence: never copy their contents into tracked source files, commit messages, or public documentation.

Ignore vague preferences that have no observable outcome. Merge duplicate feedback and distinguish:

- a defect in the harness;
- a weakness in the x-implement workflow or an agent prompt;
- a local configuration problem;
- a one-off outcome that does not justify a permanent rule.

Write the diagnosis to `harness/data/feedback/improvement-plan.md`, with the feedback IDs, evidence, intended behavior, affected files, validation, and anything deliberately rejected.

## 2. Protect the current version

Run `git status --short --branch`. Stop if there are uncommitted changes you do not understand. Never stash, discard, reset, clean, rebase or overwrite existing work.

Create a dedicated branch named `improve-rsi-<YYYYMMDD>-<short-slug>` from the current branch. Never work directly on `main`, `master` or `develop`.

## 3. Make the smallest durable improvement

Implement only changes directly supported by the feedback and run evidence. Prefer a precise prompt correction, event contract or UI fix over a broad new abstraction. Do not weaken permission, git-safety, review or privacy rules to gain autonomy. Do not add credentials, project-specific paths or runtime content to tracked files.

Update documentation when installation, configuration, behavior or data storage changes.

## 4. Validate independently

Run all relevant checks. At minimum:

```bash
claude plugin validate .
npm run typecheck --prefix harness
npm run build --prefix harness
bash -n install.sh install-remote.sh bin/x-implement-ui
```

If the UI changed, launch it and inspect the affected state in a browser. If any required check fails, fix the cause or leave the branch uncommitted with an honest report.

Review the final diff against the improvement plan. Reject scope creep and any rule that merely overfits one run.

## 5. Leave a reversible result

When validation passes, commit the source changes with a conventional `fix:`, `feat:` or `refactor:` message. Do not push and do not open a pull request.

Move processed feedback files from `pending/` to `processed/` and add `status`, `branch`, `commit`, `decision`, and `processedAt`. These files remain ignored runtime data.

Write `harness/data/feedback/improvement-report.md` with:

- branch and commit;
- feedback accepted, combined or rejected;
- exact behavior changed;
- checks run and their results;
- risks and how to undo the change;
- the next command for the user: `git show --stat <commit>`.

End by giving the same concise report in chat. The user decides whether and when to merge or push the improvement branch.
