# seance desktop app

A window onto `seance list`: every Claude session and ticket worktree in one sortable, filterable table, with buttons to attach to, resume, fork, rename, hide and start sessions. Sessions open in their own terminal window, as if you had typed the `seance` command yourself.

The app keeps no data of its own. It runs `seance list --json` every few seconds (and whenever the window gets focus), and does everything through `seance`, so it always shows the same thing the command line does.

- [Setup](#setup)
- [Using it](#using-it)
- [What it remembers](#what-it-remembers)
- [How it is locked down](#how-it-is-locked-down)
- [Troubleshooting](#troubleshooting)

## Setup

### Requirements

- seance itself, set up as in the [main README](../README.md) and on your PATH
- Node 22 or newer (for example `sudo snap install node --classic --channel=22`)
- [Terminator](https://gnome-terminator.org/), to open sessions in. Another terminal works if it takes `-T <title> -x <command>`; see [Settings](#settings).
- Linux. The app is plain Electron, but the launcher and sandbox notes below are for Ubuntu and GNOME.

### Install and run

```
cd ~/seance/app
npm install
npm start          # the first run downloads Electron's binary (about 100 MB)
```

### Ubuntu 24.04 and later: allow Electron's sandbox

Ubuntu blocks the sandbox Electron uses for apps installed with npm, so the app crashes on start with:

```
The SUID sandbox helper binary was found, but is not configured correctly.
```

Allow it for this one binary with an AppArmor profile (adjust the path to your checkout):

```
sudo tee /etc/apparmor.d/seance-electron >/dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile seance-electron /home/me/seance/app/node_modules/electron/dist/electron flags=(unconfined) {
  userns,

  include if exists <local/seance-electron>
}
EOF
sudo apparmor_parser -r /etc/apparmor.d/seance-electron
```

Writing the file is not enough: the `apparmor_parser` line loads it. It loads again by itself at every boot. This is the same kind of profile Ubuntu ships for Chrome and VS Code. Running Electron with `--no-sandbox` also works, but turns off the sandbox that keeps the page away from your system.

### A launcher for the dock

Save this as `~/.local/share/applications/seance.desktop` (adjust the paths), then press Super, type `seance`, right-click it and choose Pin to Dash:

```
[Desktop Entry]
Type=Application
Name=seance
Comment=Claude sessions for your tickets, by repo and worktree
Exec=/home/me/seance/app/node_modules/electron/dist/electron /home/me/seance/app
Icon=/home/me/seance/app/icon.svg
Terminal=false
Categories=Development;
StartupWMClass=seance
```

An app started from the dock does not read `~/.bashrc`, so keep seance's settings (`SEANCE_JIRA_URL` and the rest) in `~/.seance/config`, which seance reads however it is started.

### Settings

seance's own settings (in `~/.seance/config`) apply to the app too: `SEANCE_JIRA_URL` makes ticket names into links. Two more, as environment variables, are for the app only:

| Variable | Default | What it does |
|---|---|---|
| `SEANCE_APP_TERMINAL` | `terminator` | The terminal to open sessions in. It must take `-T <title> -x <command>`. |
| `SEANCE_APP_SEANCE` | `seance` | The seance command to run, if it is not on your PATH as `seance`. |

## Using it

The window opens at 1280 × 860, where every column fits across.

### The table (default tab)

One row per session, plus one per ticket worktree that has no session yet.

| Column | Shows |
|---|---|
| Status | Running, Idle, Open elsewhere (open in a terminal somewhere), Stopped, or No session. Running sessions pulse. |
| Ticket and branch | The ticket (a link to Jira when `SEANCE_JIRA_URL` is set) with the worktree's branch under it, or "repo folder" for a session in a repo's own checkout. |
| Repos | Every repo the session works in, as a coloured badge, the one it runs in first. Each repo always has the same colour, worked out from its name. |
| Session | The session's name and short id, with "fork of …" or "not from seance" where that applies. |
| Started | How long ago; hover for the exact time. |

Click a column header to sort by it, and again to reverse.

At the end of each row:

- **Attach** (running or idle sessions) opens the session in a new terminal window.
- **Resume** (stopped sessions) resumes it in its worktree, with access to every worktree it has used. It is greyed out, with the reason on hover, when the worktree has been removed.
- **Open** is greyed out for a session already open in another terminal; hover to see where.
- **Fork** opens the New session dialog set up to fork this session onto another ticket (see below).
- **Start** (a worktree with no session) starts one there. Worktrees seance did not make (no matching branch) say "not a seance worktree" instead.
- **The eye** hides the row. See [Filtering](#filtering).

Double-clicking a row does the same as its Attach or Resume button. Hovering over a session shows a pencil by its name: **Rename** sets the few words at the end of its name (`<repo>-<ticket>-<words>`), with a live preview. Only sessions seance started can be renamed.

### The Repos tab

A card per repo with work in progress, showing each worktree and the sessions in it, much like `seance list`. A session across several repos appears under each of them. Repos with nothing in progress fold into a list at the bottom. The same buttons, filters and search apply.

### Filtering

- **Search** (press `/`) matches tickets, repos, branches, session names and ids. `Esc` clears it.
- **Status chips** under the search, with counts, turn each status on and off.
- **Repo**: the dropdown on the right, or click any repo badge to show only that repo (click it again for all).
- **Hidden rows**: the eye at the end of a row hides it. **Show hidden** (with a count) brings hidden rows back, dimmed and tagged, with the eye to unhide them.
- **Clear filters** appears when anything is filtered, and resets the lot.

### Starting a session

The **+** button (or press `n`) opens the New session dialog:

- **Ticket or branch name**: a Jira key like `PROJ-123`, or any name with **Jira ticket** unticked.
- **Title** (optional): a few words; the session starts named `<repo>-<ticket>-<words>`. Without it, the session names itself once it has read the ticket.
- **Base branch** (optional): start new branches from `origin/<this>`, for example `develop`, instead of the repo's default.
- **Repos**: tick one or more; the first you tick is where the session runs. The filter box narrows the list.

The dialog shows the exact `seance` command it will run. **Create** opens a terminal running it: you see the fetch and the session start there, and if seance fails, the window stays open on the error.

**Fork** on a row opens the same dialog titled Fork session, showing which session you are forking and starting with its repos. The new session starts with that session's whole conversation, in a fresh worktree for the new ticket; the original is left as it is.

### Keyboard

| Key | Does |
|---|---|
| `/` | focus the search |
| `Esc` | clear the search, or close a dialog |
| `n` | New session |
| Enter | in a dialog, Create, Fork or Rename |
| `Ctrl+R` | reload the page (after an update to the app's page files) |

## What it remembers

Only how you like to see things, in the app's own storage: the tab, the sort, the status and repo filters, Show hidden, and which rows you hid. A hidden row is forgotten once its session or worktree is gone for good. Nothing about your sessions is stored by the app; seance's records in `~/.seance/` are the only ones.

## How it is locked down

- The page has no access to your system (Electron's context isolation and sandbox are on, Node is off). It can ask the app's main process for five things only: the list, opening a session by id, starting (or forking) a session, naming a session, and opening a Jira link.
- The main process checks each request against a fresh `seance list --json` before acting: the session must exist, repos must be in the lookup table, names, titles and branches must be well formed.
- It runs only `seance` (and the terminal it opens seance in), always with arguments passed one by one and never through a shell command line.
- It opens only Jira links that seance itself produced, in your default browser. The page cannot navigate anywhere or open windows.

## Troubleshooting

**The app does not open from the dock (the icon spins, then nothing).** Usually the sandbox: see [Ubuntu 24.04 and later](#ubuntu-2404-and-later-allow-electrons-sandbox). `journalctl --user -e | grep seance` shows the error.

**Ticket names are not links.** seance does not know your Jira site. Put `SEANCE_JIRA_URL=https://yourcompany.atlassian.net` in `~/.seance/config`; the app picks it up within a few seconds.

**Clicking Attach or Resume opens nothing.** Check that `seance open <session-id>` works in a terminal. With Terminator, the app passes `-u` so each session gets its own Terminator process: a Terminator that is already running splits the command on spaces, which would break it.

**"Open elsewhere" but you cannot find it.** The session is open in some terminal; the button's tooltip gives its process id.

**After updating the app**, reload with `Ctrl+R` for changes to the page; close and reopen it for changes to `main.js` or `preload.js`.
