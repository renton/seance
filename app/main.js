// The app's main process: the only part that runs commands. The page asks for a fixed set of
// things over IPC (list, open a session, open a ticket link) and gets nothing else.

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const { execFile, spawn } = require('node:child_process');
const os = require('node:os');
const path = require('node:path');

const SEANCE = process.env.SEANCE_APP_SEANCE || 'seance';
const TERMINAL = process.env.SEANCE_APP_TERMINAL || 'terminator';
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JIRA_KEY = /^[A-Za-z][A-Za-z0-9]+-[0-9]+$/;
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// Runs seance in a new terminal window. If seance fails, the window stays open on the error
// instead of closing before it can be read. Arguments are passed through as they are, never
// pasted into the shell script.
const HOLD_ON_ERROR =
  'bin="$1"; shift; "$bin" "$@" || { status=$?; printf "\\nseance exited with status %s. Press Enter to close." "$status"; read _; }';

function seanceInTerminal(title, args) {
  return launch(TERMINAL, ['-T', title, '-x', 'sh', '-c', HOLD_ON_ERROR, 'seance-app', SEANCE, ...args]);
}

function seanceList() {
  return new Promise((resolve, reject) => {
    execFile(SEANCE, ['list', '--json'], { maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || '').trim() || err.message));
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`seance list --json gave something that is not JSON: ${e.message}`));
      }
    });
  });
}

// Start a program detached from the app, and report whether it could be started at all.
function launch(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.once('error', (err) => resolve({ ok: false, message: `could not start ${cmd}: ${err.message}` }));
    child.once('spawn', () => {
      child.unref();
      resolve({ ok: true });
    });
  });
}

ipcMain.handle('seance:list', async () => {
  try {
    return { ok: true, data: await seanceList(), home: os.homedir() };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.handle('seance:open', async (_event, sessionId) => {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) {
    return { ok: false, message: 'not a session id' };
  }
  let data;
  try {
    data = await seanceList();
  } catch (err) {
    return { ok: false, message: err.message };
  }
  const session = data.sessions.find((s) => s.session_id === sessionId);
  if (!session) return { ok: false, message: 'that session is gone; the list will refresh' };
  if (session.action === 'open') {
    return { ok: false, message: `${session.name} is already open in another terminal (pid ${session.pid})` };
  }
  if (session.action === 'resume' && !session.resumable) {
    return { ok: false, message: `${session.name} has no worktree left to resume in` };
  }
  return seanceInTerminal(session.name || session.short_id, ['open', session.session_id]);
});

// Start (or resume) a session for a ticket or a plain name across the chosen repos, the
// first being where it runs: seance [--no-jira] <repo>,<repo2> <name>.
ipcMain.handle('seance:create', async (_event, request) => {
  const { name, jira, repos, fork } = request || {};
  if (typeof name !== 'string' || typeof jira !== 'boolean' || !Array.isArray(repos)) {
    return { ok: false, message: 'malformed request' };
  }
  if (jira && !JIRA_KEY.test(name)) return { ok: false, message: `"${name}" is not a Jira key like PROJ-123` };
  if (!jira && !PLAIN_NAME.test(name)) {
    return { ok: false, message: 'A name may use letters, digits, ".", "_" and "-", and must start with a letter or digit' };
  }
  if (!repos.length) return { ok: false, message: 'Choose at least one repo' };
  let data;
  try {
    data = await seanceList();
  } catch (err) {
    return { ok: false, message: err.message };
  }
  const known = new Set(data.repos.map((r) => r.name));
  for (const repo of repos) {
    if (typeof repo !== 'string' || !known.has(repo)) return { ok: false, message: `"${repo}" is not in seance's repo table` };
  }
  if (new Set(repos).size !== repos.length) return { ok: false, message: 'A repo is chosen twice' };
  if (fork !== undefined) {
    if (typeof fork !== 'string' || !SESSION_ID.test(fork)) return { ok: false, message: 'not a session id to fork' };
    if (!data.sessions.some((s) => s.session_id === fork)) return { ok: false, message: 'the session to fork is gone; the list will refresh' };
  }
  const ticket = jira ? name.toUpperCase() : name;
  const args = [...(jira ? [] : ['--no-jira']), repos.join(','), ticket, ...(fork ? [fork] : [])];
  return seanceInTerminal(`${repos[0]}-${ticket}`, args);
});

// Only links seance itself produced (Jira tickets) are opened, in the default browser.
ipcMain.handle('seance:link', async (_event, url) => {
  let data;
  try {
    data = await seanceList();
  } catch (err) {
    return { ok: false, message: err.message };
  }
  const known = new Set();
  for (const repo of data.repos) for (const wt of repo.worktrees) if (wt.jira_url) known.add(wt.jira_url);
  for (const s of data.sessions) if (s.jira_url) known.add(s.jira_url);
  if (typeof url !== 'string' || !known.has(url) || !url.startsWith('https://')) {
    return { ok: false, message: 'not a link seance knows about' };
  }
  await shell.openExternal(url);
  return { ok: true };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 820,
    minHeight: 520,
    title: 'seance',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
