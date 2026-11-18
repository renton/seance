# seance

Start, resume or fork a [Claude Code](https://claude.com/claude-code) session for a Jira ticket, with each ticket in its own git worktree.

```
seance my-service PROJ-123
```

creates a worktree for `PROJ-123` on its own branch, fresh from the remote's base branch, and opens a Claude session there that reads the ticket and gets oriented in the code. Run it again later and it resumes that session. Fork a session onto a new ticket and the fork keeps the whole conversation. Work that has no ticket gets the same treatment under any name you like.

A [desktop app](app/README.md) shows every session in a table, with buttons to open, fork, rename and start them.

- [Setup](#setup)
- [Usage guide](#usage-guide)
- [Command reference](#command-reference)
- [Desktop app](#desktop-app)
- [Files](#files)
- [How it works](#how-it-works)

## Setup

### Requirements

- Claude Code with background sessions (`claude --bg`, `claude agents`)
- git 2.31 or newer, bash, `jq`
- An Atlassian (Jira) MCP server connected to Claude Code, for sessions to read their ticket
- `fzf` (optional, for the `seance pick` menu)

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

seance works without any of these. Put the ones you want in `~/.seance/config`, one `NAME=value` per line:

```
# ~/.seance/config
SEANCE_JIRA_URL=https://yourcompany.atlassian.net
SEANCE_NOTES_DIR=~/notes/repos
```

seance reads that file however it is started (a terminal, the desktop app or its dock launcher, or Claude), so it is the place that always works. It is read as plain lines, never run as a script; quotes around a value are dropped and a leading `~/` means your home folder. Each setting can also be an environment variable (an `export` line in `~/.bashrc`), which wins over the file when both set it.

| Setting | Default | What it does |
|---|---|---|
| `SEANCE_BRANCH_FORMAT` | `feature/{ticket}` | The branch name for a ticket. `{ticket}` is required; `{repo}` is the name from the lookup table. `{ticket}` gives `PROJ-123`; `me/{repo}/{ticket}` gives `me/my-service/PROJ-123`. |
| `SEANCE_JIRA_URL` | unset | Your Jira site. Adds the ticket's link to the session's first prompt, to `seance list`, and to the desktop app, where clicking a ticket opens it in your browser. Without it the session finds the site through the Atlassian MCP, which works when your account reaches only one site. |
| `SEANCE_NOTES_DIR` | unset | A folder of notes on your repos: `INDEX.md` for how they connect, `<repo>.md` per repo (named as in the lookup table). New sessions are told to read the ones that exist for their repos, and every session can read the folder without asking. |
| `SEANCE_HOME` | `~/.seance` | Where the config, the lookup table and the session records live. Environment only, since it says where the config file is. |

### Trust

Claude only starts background sessions in folders you have trusted. Trusting a parent folder (for example the one holding all your repos) covers every repo and worktree under it.

## Usage guide

### Start work on a ticket

```
seance my-service PROJ-123
```

1. Fetches the base branch and creates the worktree `my-service/.claude/worktrees/PROJ-123` on a new branch `feature/PROJ-123` from `origin/<base>`. The repo folder itself is never touched, so a messy working directory there does not matter and nothing needs pulling. An existing branch or worktree for the ticket is reused.
2. Adds `/.claude/worktrees/` to the repo's `.git/info/exclude` (a local ignore, never committed), so worktrees stay out of `git status` and searches in the repo folder.
3. Opens Claude in the worktree, named `my-service-PROJ-123`, with a first prompt to get up to speed on each repo (your notes on them first, if `SEANCE_NOTES_DIR` is set), read the ticket (read-only), restate its acceptance criteria, name the repos it touches, find where the work lives, and name itself (see below). Then it stops: it does not write a plan or change anything until you say what to do.
4. Records the session in `~/.seance/sessions.tsv`.

### Come back to it

```
seance my-service PROJ-123
```

The same command resumes the ticket's last session, with access to every worktree it has used. If it is already running in the background it prints the `claude attach` command; if it is open in another terminal it says so. `--new` starts a fresh session instead.

### Session names

A session starts as `<repo>-<TICKET>`, because seance does not read the ticket itself. Its first prompt asks it to run `seance title "<a few words>"` once it knows what the work is about, which makes it `<repo>-<TICKET>-<words>`, for example `my-service-PROJ-123-rotate-demo-lb-certs` (at most five words, lowercased and hyphenated). The new name shows at once in `seance list`, `pick`, `--json` and the desktop app.

To choose the name yourself:

```
seance --title "rotate demo lb certs" my-service PROJ-123     # name it from the start
seance title 3f2a9c1e "rotate demo lb certs"                  # rename any seance session
```

A session started with `--title` is only asked to check its name still fits. Claude's own name for a session (in `claude agents` and its picker) takes a new title the next time seance resumes it, since a running session cannot be renamed from outside.

### Branch from something other than the default

```
seance --base develop my-service PROJ-123
seance --base origin/release/2.4 my-service,web-app PROJ-456
```

New branches start from `origin/<branch>` instead of the repo's default or the base in the lookup table, for every repo in the command; `origin/` is optional. It only matters when the ticket's branch is new: an existing branch or worktree is used as it is, and seance says the option was ignored. A branch the remote does not have stops seance with a message before it makes that repo's worktree.

### Fork a session onto another ticket

```
seance my-service PROJ-124 3f2a9c1e        # a session id from seance list (short or full)
seance my-service PROJ-124 here            # inside a session: fork this one
```

The fork carries the whole conversation into a new session in the new ticket's worktree; the original is untouched. Its first prompt has it read the new ticket and get oriented from what the conversation already knows, without writing a plan. `here` reads `CLAUDE_CODE_SESSION_ID`, so it works only inside a Claude session (ask Claude to run it).

### A ticket across several repos

One session can work across several repos, each with its own worktree and branch (so one PR per repo, all carrying the ticket key), with the repo folders themselves left alone. List the repos with commas and no spaces:

```
seance my-service,web-app PROJ-123
```

This makes a worktree for `PROJ-123` in each repo, starts the session in the first, and gives it access to the others (`claude --add-dir`).

To bring in more repos once the session is running, have Claude run:

```
seance add web-app
seance add web-app,api-gateway      # several at once
```

It works out the ticket from the session's own worktree (or give it: `seance add web-app PROJ-123`), creates the worktrees, and prints a line per worktree for you to type at the session's prompt, since Claude cannot run slash commands in its own session:

```
/add-dir /home/me/code/web-app/.claude/worktrees/PROJ-123
```

Every repo in a list is checked against the lookup table before any worktree is made, so a typo leaves nothing half-done. Repos added this way are remembered: resuming the session later gives it access to them again.

For a large, separable change in another repo, a second session can suit better: `seance web-app PROJ-123 here` forks the conversation into that repo's worktree.

### Give the session your own prompt

```
seance my-service PROJ-123 "pull the ticket and start working on it, make a plan"
seance my-service PROJ-124 here "pick up where we left off on PROJ-124"
seance -n my-service fix-ci-cache "find out why the cache step misses"
```

A last argument that is not a session id is your prompt. Quote it. It replaces the default "get oriented and wait" steps: the session is still told its ticket and how to read it (read-only), its worktrees and your repo notes, then given your words. On a resume your prompt is sent as the next message; if the session is already running, it is not sent and seance says so.

### Work with no ticket

```
seance --no-jira my-service fix-ci-cache
seance -n my-service fix-ci-cache          # the same
```

Everything works as for a ticket (a fetched base, the worktree `my-service/.claude/worktrees/fix-ci-cache`, the branch `feature/fix-ci-cache`, a session named `my-service-fix-ci-cache`), but the second argument is taken as a plain name and nothing is read from Jira. The session gets up to speed on the repos and waits for you to describe the work. A name may use letters, digits, `.`, `_` and `-`, and keeps its case.

`-n` is needed only to create it. Once the worktree exists, `seance my-service fix-ci-cache` resumes it like any other. It works with several repos, forks, `--title`, `--base` and `seance add` too.

### See everything

```
seance list
```

```
── my-service ──────────────────────────────────────── ~/code/my-service
   repo folder             main
   PROJ-123                feature/PROJ-123
     └─ my-service-PROJ-123-rotate-demo-lb-certs  3f2a9c1e  background idle
   PROJ-124                feature/PROJ-124
     └─ my-service-PROJ-124  8be01d77  stopped (seance my-service PROJ-124)  fork of 3f2a9c1e

── web-app ─────────────────────────────────────────────── ~/code/web-app
   repo folder             develop
```

Every repo in the table, each worktree with its branch, and the sessions in it: seance's own, plus any other session running in that folder. "repo folder" is the repo's own checkout, on whatever branch you left it; seance never runs a session there.

### Pick a session from a menu

```
seance pick
```

Lists every session, newest first, and acts on the one you choose:

- running in the background (busy or idle): `claude attach`
- stopped, or a background session that has ended: resumes it in its worktree, with access to every worktree recorded for it
- open in another terminal: says so

The menu uses [fzf](https://github.com/junegunn/fzf) when it is installed (type part of a ticket or repo to narrow it down), and a numbered list otherwise.

`seance open <session-id>` does the same for one session without the menu, for scripts and launchers: for example `terminator -x seance open 3f2a9c1e`. For a session already open elsewhere it says so and exits non-zero.

### As JSON, for other tools

```
seance list --json
```

The same information for a UI or script. `version` changes only if the shape does.

```
{
  "version": 1,
  "generated": "2026-11-18T15:04:05Z",
  "repos": [
    { "name": "my-service", "path": "/home/me/code/my-service", "base": null, "present": true,
      "worktrees": [
        { "path": "/home/me/code/my-service", "branch": "main", "repo_folder": true,
          "ticket": null, "jira_url": null, "session_ids": [] },
        { "path": "/home/me/code/my-service/.claude/worktrees/PROJ-123", "branch": "feature/PROJ-123",
          "repo_folder": false, "ticket": "PROJ-123",
          "jira_url": "https://yourcompany.atlassian.net/browse/PROJ-123",
          "session_ids": ["3f2a9c1e-..."] } ] } ],
  "sessions": [
    { "session_id": "3f2a9c1e-...", "short_id": "3f2a9c1e",
      "name": "my-service-PROJ-123-rotate-demo-lb-certs", "title": "rotate-demo-lb-certs",
      "ticket": "PROJ-123", "jira_url": "https://...", "repos": ["my-service"],
      "worktrees": ["/home/me/code/my-service/.claude/worktrees/PROJ-123"],
      "cwd": "/home/me/code/my-service/.claude/worktrees/PROJ-123",
      "state": "idle", "kind": "background", "status": "idle",
      "from_seance": true, "forked_from": null, "created": "2026-11-18T10:57:27-05:00",
      "action": "attach", "attach_id": "3f2a9c1e", "pid": null, "resumable": true } ]
}
```

- `sessions` is newest first: seance's own, then any other session running in one of your repos (`from_seance: false`).
- `state` is `running`, `idle` (both background), `open` (in a terminal somewhere) or `stopped`.
- `action` is what to do with it: `attach` (`claude attach <attach_id>`), `open` (already open; `pid` says where) or `resume`. `seance pick` and the desktop app follow it.
- `title` is the few words the session was named with, or null; `name` already includes it.
- `resumable` is false when a stopped session's worktree has been removed.
- `base` is the pinned base branch from the lookup table, or null for the remote's default. `present` is false when the repo's folder is missing.
- `jira_url` is set only when `SEANCE_JIRA_URL` is and the name is a Jira key.

### Run by you or by Claude

| | From your terminal | From inside a Claude session |
|---|---|---|
| Fetch the base branch | yes (`--no-fetch` skips it) | yes (`--no-fetch` skips it) |
| Session | opens here, interactive (`--bg` for background) | starts in the background; `claude attach <id>` opens it |

The fetch only updates `origin/<base>`, and only when a new branch is made. seance never merges, pulls or pushes, and never touches your local base branch.

### Clean up after a merge

seance never deletes anything. From the repo folder:

```
git worktree remove .claude/worktrees/PROJ-123
git branch -d feature/PROJ-123      # -D after a squash merge
```

## Command reference

```
seance <repo> <TICKET>                   start the ticket's session, or resume its last one
seance <repo>,<repo2> <TICKET>           one session across several repos, a worktree in each
seance <repo> <TICKET> "<prompt>"        your own first prompt instead of "get oriented and wait"
seance -n <repo> <name>                  the same for work with no ticket: any name, no Jira
seance <repo> <TICKET> <session-id>      fork that session onto the ticket
seance <repo> <TICKET> here              fork the session this runs inside
seance add <repo>[,<repo2>] [<TICKET>]   inside a session: add repos' worktrees for its ticket
seance title "<words>"                   inside a session: name it <repo>-<ticket>-<words>
seance title <session-id> "<words>"      name any seance session
seance list                              repos, worktrees, branches and sessions
seance list --json                       the same as JSON, for other tools
seance pick                              choose a session from a menu; attach to it or resume it
seance open <session-id>                 attach to or resume that session, as pick would
seance repos                             the lookup table
seance help

options, before the arguments:
  --title "<words>"    start the session already named <repo>-<ticket>-<words>
  --base <branch>      start new branches from origin/<branch> instead of the default
  -n, --no-jira        the second argument is a plain name, not a Jira key
  --new                start a fresh session even if the ticket has one
  --bg                 start in the background (always so when Claude runs seance)
  --no-fetch           branch from origin/<base> as last fetched
```

A session id can be the full id or the 8 characters `seance list` shows. A fork's session id and your prompt can both be given, in that order.

## Desktop app

`app/` is a small Electron window onto `seance list`: every session and ticket worktree in a sortable, filterable table or as a card per repo, with buttons to attach, resume, fork, rename, hide and start sessions. It keeps no data of its own and acts only through `seance`. Setup (Node, the AppArmor profile Ubuntu needs, a dock launcher) and a tour are in [app/README.md](app/README.md).

## Files

| File | What it holds |
|---|---|
| `~/.seance/config` | optional settings, `NAME=value` per line |
| `~/.seance/repos` | the lookup table: `<name> <path> [base branch]` |
| `~/.seance/sessions.tsv` | every session seance started: created, repo, ticket, name, session id, worktree, forked from |
| `~/.seance/titles.tsv` | the few words each session was named with: session id, words, when (the latest wins) |

`SEANCE_HOME` moves them all.

## How it works

- Each session is a plain Claude Code session. seance chooses its folder, its name, the folders it may use (`--add-dir` for the session's other worktrees and `SEANCE_NOTES_DIR`) and its first prompt, then gets out of the way.
- `claude --bg` ignores `--session-id`, so for background sessions seance reads the id back from `claude agents --json`.
- When there is no terminal (Claude running seance through its shell tool), seance always starts the session in the background and prints the `claude attach` line.
- A session's state comes from `claude agents --json --all`. A background session with no status has ended, so it is resumed rather than attached.
