# Pre-commit checks with `prek` (optional, offline)

Issue [#28](https://github.com/triagmas/pi-wsl-desktop/issues/28). Configuration: [`prek.toml`](../prek.toml).

This adds a **fast local pre-commit guard**, not a new CI/test framework. All hooks are built into `prek`, require no Python/Node environments or Git downloads to run, and are **non-mutating**. They check: accidental large new files (>4 MiB), case-colliding and Windows-invalid names, merge conflict markers (even outside a merge), recognized private-key headers, and commits directly to `main`/`master`. Private-key detection is heuristic; it **does not detect all API tokens or credentials**. Existing [Repository Contract](../.github/workflows/repository-contract.yml) and [Product CI](../.github/workflows/product-ci.yml) remain mandatory.

## Activate in the one canonical checkout

Use `F:\\_hermes\\CODE\\pi-wsl-desktop` (WSL: `/mnt/f/_hermes/CODE/pi-wsl-desktop`); do not clone the project or change the current UI21 working tree to install a tool. Activate only after this PR is merged or the config is present on the chosen feature branch. Check the repo's working state and existing Git hooks **before installing**.

In **WSL**, if `uv` is already installed, install the official `prek` tool with `uv tool install prek` (alternatively use another method from [upstream installation docs](https://prek.j178.dev/installation/)). This installs `prek` as a tool, not as a Pi Skill/extension and not into `~/.pi`.

```bash
cd /mnt/f/_hermes/CODE/pi-wsl-desktop
pwd
git status --short --branch
git config --show-origin --get core.hooksPath || true
git rev-parse --git-path hooks/pre-commit
prek --version
prek run --all-files   # review any failures; no automatic code changes
prek install           # only if there is no conflicting existing hook
```

Do **not** run `prek install -f` or change `core.hooksPath` just to make installation succeed. If `hooks/pre-commit` or a custom hooks path already exists, **inspect and reconcile** before installing; installing this hook must not silently discard other checks. The `no-commit-to-branch` guard deliberately fails on `main`/`master`, including manual `prek run --all-files` there; run the smoke from a feature branch. `prek run` checks staged changes before a commit.

If committing from **Git for Windows / PowerShell** instead of WSL Git, also ensure the Windows `prek.exe` is available on that Git process's `PATH` and verify the installed hook works from that shell. Do not assume a WSL-installed executable is available in Windows Git; both environments can share one checkout but not necessarily one hook executable. Prefer selecting one Git environment for a given commit to avoid hook conflicts.

## Acceptance and rollback

- On a feature branch, `prek run --all-files` succeeds (or reports clearly scoped pre-existing failures); `prek run` exercises staged files. Confirm a synthetic merge marker or dummy oversized newly staged file is rejected in an **isolated temporary fixture**, never by inserting secrets or intentionally broken files into this checkout.
- Verify commit execution in the actual Git shell used by Pi; do not claim this from a remote GitHub PR alone. No existing hook may be overwritten.
- Disabling local integration: `prek uninstall` in the same Git environment; keep the repo config for optional manual checks. If activation has not occurred yet, there is nothing to uninstall.
- No automatic tests, model calls, modifications to real `~/.pi` resources, or real Windows+WSL smoke are authorized by this PR. Record those as **NOT RUN** until observed.
