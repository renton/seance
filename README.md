# seance

Start, resume or fork a [Claude Code](https://claude.com/claude-code) session for a Jira ticket, with each ticket in its own git worktree.

```
seance my-service PROJ-123
```

creates a worktree for `PROJ-123` on its own branch, fresh from the remote's base branch, and opens a Claude session there that reads the ticket and gets oriented in the code. Run it again later and it resumes that session. Fork an existing session onto a new ticket and the fork keeps the whole conversation.

## Setup

### Requirements

- Claude Code with background sessions (`claude --bg`, `claude agents`)
- git 2.31 or newer
- `jq`
- bash
- `fzf` (optional, for the `seance pick` menu)
- An Atlassian (Jira) MCP server connected to Claude Code, for the session to read the ticket

### Install

```
git clone git@github.com:renton/seance.git ~/seance
ln -s ~/seance/bin/seance ~/.local/bin/seance    # or any folder on your PATH
```

### Tell seance where your repos are

`~/.seance/repos` maps a short name to a checkout, one repo per line:

```
# <name>      <path>                     [base branch]
my-service    /home/me/code/my-service
web-app       /home/me/code/web-app      develop
```

The base branch is optional. Without it seance uses the remote's default branch (`origin/HEAD`, else `origin/main`, else `origin/master`).

To list every git checkout under a folder as a starting point:

```
mkdir -p ~/.seance
for d in ~/code/*/; do git -C "$d" rev-parse --git-dir >/dev/null 2>&1 && printf '%-26s %s\n' "$(basename "$d")" "${d%/}"; done >> ~/.seance/repos
```

### Optional settings

seance works without any of these. Each is an environment variable: add the `export` lines you want to your shell's startup file (`~/.bashrc` for bash, `~/.zshrc` for zsh), then open a new terminal or run `source ~/.bashrc`. Claude sessions you start afterwards see them too, so they also apply when Claude runs seance for you.

| Variable | Default | What it does |
|---|---|---|
| `SEANCE_BRANCH_FORMAT` | `feature/{ticket}` | The branch name for a ticket. `{ticket}` is required; `{repo}` is the name from the lookup table. |
| `SEANCE_JIRA_URL` | unset | Your Jira site. Adds the ticket's link to the session's first prompt and to `seance list`. |
| `SEANCE_NOTES_DIR` | unset | A folder of notes on your repos: `INDEX.md` for how they connect, `<repo>.md` per repo (named as in the lookup table). A new session is told to read the ones that exist for its repos. |
| `SEANCE_HOME` | `~/.seance` | Where the lookup table and session records live. |

For example:

```
# ~/.bashrc
export SEANCE_BRANCH_FORMAT='feature/{ticket}'
export SEANCE_JIRA_URL=https://yourcompany.atlassian.net
```

**Branch format examples:** `feature/{ticket}` gives `feature/PROJ-123`; `{ticket}` gives `PROJ-123`; `me/{repo}/{ticket}` gives `me/my-service/PROJ-123`.

**Do you need `SEANCE_JIRA_URL`?** Without it, the session finds your Jira site through the Atlassian MCP, which works when your account reaches only one site. Set it if you have several sites (so the session reads the ticket from the right one), or if you want ticket links in `seance list`.

### Trust

Claude only starts background sessions in folders you have trusted. Trusting a parent folder (for example the one holding all your repos) covers every repo and worktree under it.

## Usage

```
seance <repo> <TICKET>                 session on the ticket's branch (resumes its last one)
seance <repo> <TICKET> <session-id>    fork that session onto the ticket's branch
seance <repo> <TICKET> here            fork the session this runs inside
seance <repo>,<repo2> <TICKET> ...     a worktree in each repo, one session across them
seance add <repo> [<TICKET>]           inside a session: add a repo's worktree for its ticket
seance list                            repos, worktrees, branches and sessions
seance pick                            choose a session from a menu and attach to or resume it
seance repos                           the lookup table
seance help

options (before the arguments):
  --bg        start the session in the background
  --new       start a fresh session even if the ticket already has one
  --no-fetch  branch from origin/<base> as last fetched
```

### Start work on a ticket

```
seance my-service PROJ-123
```

1. Fetches the base branch and creates the worktree `my-service/.claude/worktrees/PROJ-123` on a new branch `feature/PROJ-123` from `origin/<base>`. The repo folder itself is never touched, so a messy working directory there does not matter and nothing needs pulling. An existing branch or worktree for the ticket is reused.
2. Adds `/.claude/worktrees/` to the repo's `.git/info/exclude` (a local ignore, never committed), so worktrees stay out of `git status` and searches in the repo folder.
3. Opens Claude in the worktree, named `my-service-PROJ-123`, with a first prompt to get up to speed on each repo (reading your notes on them first, if `SEANCE_NOTES_DIR` is set), read the ticket (read-only), restate its acceptance criteria, name the repos it touches, find where the work lives in the code, and then stop. It does not write a plan or change anything; you say what to do next.
4. Records the session in `~/.seance/sessions.tsv`.

### Come back to it

```
seance my-service PROJ-123
```

The same command resumes the ticket's last session. If it is already running in the background it prints the `claude attach` command; if it is open in another terminal it says so. `--new` starts a fresh session instead.

### Fork a session onto another ticket

```
seance my-service PROJ-124 3f2a9c1e-...    # a session id, from `seance list` or `claude agents`
seance my-service PROJ-124 here            # inside a session: fork this one
```

The fork carries the whole conversation into a new session in the new ticket's worktree; the original session is untouched. Its first prompt has it read the new ticket and get oriented from what the conversation already knows, without writing a plan. `here` reads `CLAUDE_CODE_SESSION_ID`, so it works only inside a Claude session (ask Claude to run it).

### A ticket across several repos

One session can work across several repos, with each repo getting its own worktree and branch (so one PR per repo, all carrying the ticket key) and the repo folders themselves left alone.

Start it that way by listing the repos with commas:

```
seance my-service,web-app PROJ-123
```

This makes a worktree for `PROJ-123` in each repo, starts the session in the first, and gives it access to the others (`claude --add-dir`). Its first prompt lists every worktree. The same command resumes it later, with the same access.

To bring in another repo once the session is running, have Claude run:

```
seance add web-app
```

It works out the ticket from the session's own worktree (or give it: `seance add web-app PROJ-123`), creates the worktree, and prints a line for you to type at the session's prompt:

```
/add-dir /home/me/code/web-app/.claude/worktrees/PROJ-123
```

That last step is yours: Claude cannot run slash commands in its own session.

For a large, separable change in another repo, a second session can suit better: `seance web-app PROJ-123 here` forks the conversation into that repo's worktree.

### See everything

```
seance list
```

```
── my-service ──────────────────────────────────────── ~/code/my-service
   repo folder             main
   PROJ-123                feature/PROJ-123
     └─ my-service-PROJ-123  3f2a9c1e  background idle
   PROJ-124                feature/PROJ-124
     └─ my-service-PROJ-124  8be01d77  stopped (seance my-service PROJ-124)  fork of 3f2a9c1e

── web-app ─────────────────────────────────────────────── ~/code/web-app
   repo folder             develop
```

Worktrees under `.claude/worktrees/` are shown by their folder name (the ticket). Colour is used only when the output is a terminal.

Every repo in the table, each worktree with its branch, and the sessions in it: seance's own, plus any other running session in that folder.

### Pick a session from a menu

```
seance pick
```

Lists every session from `seance list`, newest first, one line each, and acts on the one you choose:

- running in the background (busy or idle): `claude attach`
- stopped, or a background session that has ended: resumes it in its worktree, as `seance <repo> <TICKET>` would, with access to every worktree recorded for it (including ones added with `seance add`)
- open in another terminal: says so

The menu uses [fzf](https://github.com/junegunn/fzf) when it is installed (type part of a ticket or repo to narrow it down), and a numbered `select` list otherwise. Stopped sessions whose worktree has been removed are left out.

### Run by you or by Claude

| | From your terminal | From inside a Claude session |
|---|---|---|
| Fetch the base branch | yes (`--no-fetch` skips it) | never |
| Session | opens here, interactive (`--bg` for background) | starts in the background; `claude attach <id>` opens it |

When there is no terminal (Claude running it through its shell tool) seance never contacts the remote and always starts the session in the background.

### Clean up after a merge

seance never deletes anything. From the repo folder:

```
git worktree remove .claude/worktrees/PROJ-123
git branch -d feature/PROJ-123      # -D after a squash merge
```

## Files

| File | What it holds |
|---|---|
| `~/.seance/repos` | the lookup table: `<name> <path> [base branch]` |
| `~/.seance/sessions.tsv` | every session seance started: created, repo, ticket, name, session id, worktree, forked from |

`SEANCE_HOME` moves both.

## Notes

- `claude --bg` ignores `--session-id`, so for background sessions seance reads the id back from `claude agents --json`.
- The session name is `<repo>-<TICKET>`. The ticket is read inside the session, so its summary is not in the name.
