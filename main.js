const { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor, screen, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const os = require("os");

const APP_ID = "com.local.cpet";
const PET_SIZE = { width: 310, height: 470 };
const NOTE_SIZE = { width: 440, height: 132 };
const DEFAULT_QUICK_SHORTCUT = "Ctrl+.";
const QUIT_SHORTCUT = "Ctrl+/";
const TOOL_DEFINITIONS = [
  ["Clean_Cache.exe", "Clean Cache"],
  ["Merge_PDF.exe", "Merge PDF"],
  ["PPT_To_HTML.exe", "PPT To HTML"],
  ["Remove_gray_background.exe", "Remove Gray Background"],
  ["Word2Pdf_Tool.exe", "Word To PDF"],
  ["生成Index.exe", "生成 Index"],
];

app.setName("C.pet");
// Keep the original storage location so upgrades continue to use existing
// To Do, Idea, settings, and completed-task data.
app.setPath("userData", path.join(app.getPath("appData"), "c-pet"));
if (process.platform === "win32") app.setAppUserModelId(APP_ID);

function getLaunchExecutable() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function getPortableDirectory() {
  return process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(getLaunchExecutable());
}

let petWindow;
let noteWindow;
let dragState = null;
let quitting = false;
let savedSettings = {};
let settingsPath;
let savedWindowState = {};
let windowStatePath;
let saveWindowTimer;
let completedTasks = [];
let completedTasksPath;
let registeredQuickShortcut = null;
let shortcutHook = null;
let petVisualBounds = null;
let lastPetShapeKey = "";
let fullscreenMonitor = null;
let externalFullscreen = false;
let fullscreenRestoreState = { pet: false, note: false };
let previousCpuSample = null;
let cachedTempSize = { value: 0, sampledAt: 0 };
let cachedPerformance = { value: { gpu: null, rx: null, tx: null, processes: null }, sampledAt: 0 };
let performanceRequest = null;

function getCpuPercent() {
  const sample = os.cpus().reduce((total, cpu) => {
    const times = cpu.times;
    total.idle += times.idle;
    total.all += times.user + times.nice + times.sys + times.idle + times.irq;
    return total;
  }, { idle: 0, all: 0 });
  if (!previousCpuSample) {
    previousCpuSample = sample;
    return 0;
  }
  const idle = sample.idle - previousCpuSample.idle;
  const all = sample.all - previousCpuSample.all;
  previousCpuSample = sample;
  return all ? Math.max(0, Math.min(100, Math.round((1 - idle / all) * 100))) : 0;
}

function getDirectorySize(directory, depth = 1) {
  let total = 0;
  try {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      try {
        if (entry.isFile()) total += fs.statSync(target).size;
        else if (entry.isDirectory() && depth > 0) total += getDirectorySize(target, depth - 1);
      } catch {}
    }
  } catch {}
  return total;
}

function getWindowsPerformance() {
  return new Promise((resolve) => {
    const script = "$s=(Get-Counter @('\\GPU Engine(*)\\Utilization Percentage','\\Network Interface(*)\\Bytes Received/sec','\\Network Interface(*)\\Bytes Sent/sec') -ErrorAction SilentlyContinue).CounterSamples; $gpu=$s|Where-Object Path -Like '*gpu engine*utilization percentage'|Measure-Object CookedValue -Sum; $rx=$s|Where-Object Path -Like '*network interface*bytes received/sec'|Measure-Object CookedValue -Sum; $tx=$s|Where-Object Path -Like '*network interface*bytes sent/sec'|Measure-Object CookedValue -Sum; $pc=(Get-Process -ErrorAction SilentlyContinue|Measure-Object).Count; Write-Output (($gpu.Sum|ForEach-Object{[math]::Round($_,1)}).ToString()+'|'+([math]::Round($rx.Sum,0)).ToString()+'|'+([math]::Round($tx.Sum,0)).ToString()+'|'+$pc.ToString())";
    const child = spawn("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("close", () => {
      const parts = output.trim().split("|");
      if (parts.length !== 4) return resolve({ gpu: null, rx: null, tx: null, processes: null });
      const gpu = Number(parts[0]);
      const rx = Number(parts[1]);
      const tx = Number(parts[2]);
      const processes = Number(parts[3]);
      resolve({ gpu: Number.isFinite(gpu) ? Math.min(100, gpu) : null, rx: Number.isFinite(rx) ? rx : null, tx: Number.isFinite(tx) ? tx : null, processes: Number.isFinite(processes) ? processes : null });
    });
    child.on("error", () => resolve({ gpu: null, rx: null, tx: null, processes: null }));
  });
}

async function getCachedWindowsPerformance() {
  const stale = Date.now() - cachedPerformance.sampledAt > 950;
  if (stale && !performanceRequest) {
    performanceRequest = getWindowsPerformance()
      .then((value) => { cachedPerformance = { value, sampledAt: Date.now() }; })
      .finally(() => { performanceRequest = null; });
  }
  if (!cachedPerformance.sampledAt && performanceRequest) await performanceRequest;
  return cachedPerformance.value;
}

function getScriptsDirectory() {
  const portableDir = getPortableDirectory();
  const candidates = [...new Set([
    path.join(portableDir, "scripts"),
    path.join(path.dirname(portableDir), "scripts"),
    path.join(path.dirname(path.dirname(portableDir)), "scripts"),
    path.join(process.cwd(), "scripts"),
    path.join(path.dirname(process.cwd()), "scripts"),
    path.join(__dirname, "scripts"),
  ])];
  return candidates.find((candidate) => {
    try {
      return fs.statSync(candidate).isDirectory()
        && TOOL_DEFINITIONS.some(([file]) => fs.existsSync(path.join(candidate, file)));
    } catch {
      return false;
    }
  }) || null;
}

function listScriptTools() {
  const scriptsDir = getScriptsDirectory();
  if (!scriptsDir) return [];
  return TOOL_DEFINITIONS
    .filter(([file]) => fs.existsSync(path.join(scriptsDir, file)))
    .map(([id, name]) => ({ id, name }));
}

function refreshPinnedShortcuts() {
  if (process.platform !== "win32") return;
  const taskbarDir = path.join(app.getPath("appData"), "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar");
  let entries = [];
  try {
    entries = fs.readdirSync(taskbarDir).filter((name) => name.toLowerCase().endsWith(".lnk"));
  } catch {
    return;
  }
  for (const entry of entries) {
    const shortcutPath = path.join(taskbarDir, entry);
    try {
      const existing = shell.readShortcutLink(shortcutPath);
      const isCpet = entry.toLowerCase().includes("c.pet")
        || path.basename(existing.target || "").toLowerCase() === "c.pet.exe";
      if (!isCpet) continue;
      shell.writeShortcutLink(shortcutPath, "update", {
        target: getLaunchExecutable(),
        cwd: getPortableDirectory(),
        icon: getLaunchExecutable(),
        iconIndex: 0,
        appUserModelId: APP_ID,
        description: "C.pet desktop pet",
      });
    } catch {
      // Ignore stale or inaccessible pinned shortcuts.
    }
  }
}

function isQuitInput(input) {
  if (input.type !== "keyDown" || !input.control || input.alt || input.meta) return false;
  return input.code === "Slash" || input.key === "/" || input.key === "?" || input.key === "\uFF1F";
}

function installQuitKeyFallback(window) {
  window.webContents.on("before-input-event", (event, input) => {
    if (!isQuitInput(input)) return;
    event.preventDefault();
    quitApplication();
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function loadSettings() {
  try {
    savedSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  } catch {
    savedSettings = {};
  }
}

function persistSettings() {
  fs.writeFileSync(settingsPath, JSON.stringify(savedSettings, null, 2), "utf8");
}

function toggleQuickEntry() {
  if (!noteWindow || noteWindow.isDestroyed()) return;
  if (noteWindow.isVisible()) {
    noteWindow.hide();
    return;
  }
  if (externalFullscreen) return;
  noteWindow.center();
  noteWindow.show();
  noteWindow.focus();
  noteWindow.webContents.send("shortcut:quick-entry");
}

function registerQuickShortcut(accelerator) {
  const candidate = String(accelerator || DEFAULT_QUICK_SHORTCUT).trim();
  if (process.platform === "win32") {
    const hookResult = startPriorityShortcutHook(candidate);
    if (hookResult.ok) {
      registeredQuickShortcut = candidate;
      return hookResult;
    }
  }
  if (registeredQuickShortcut) globalShortcut.unregister(registeredQuickShortcut);
  try {
    if (!globalShortcut.register(candidate, toggleQuickEntry)) throw new Error("Shortcut is already in use");
    registeredQuickShortcut = candidate;
    return { ok: true, shortcut: candidate };
  } catch (error) {
    if (registeredQuickShortcut !== candidate) registeredQuickShortcut = null;
    return { ok: false, shortcut: candidate, error: error.message || "Unable to register shortcut" };
  }
}

function acceleratorToVirtualKey(accelerator) {
  const parts = String(accelerator).split("+").map((part) => part.trim()).filter(Boolean);
  const key = parts.pop()?.toUpperCase();
  const named = { ".": 0xBE, ",": 0xBC, "/": 0xBF, "?": 0xBF, SPACE: 0x20, TAB: 0x09 };
  const vk = named[key] ?? (key?.length === 1 ? key.charCodeAt(0) : NaN);
  if (!Number.isFinite(vk)) return null;
  return {
    vk,
    ctrl: parts.some((part) => /^(CTRL|CONTROL|CMDORCTRL)$/i.test(part)),
    alt: parts.some((part) => /^ALT$/i.test(part)),
    shift: parts.some((part) => /^SHIFT$/i.test(part)),
  };
}

function stopPriorityShortcutHook() {
  if (!shortcutHook) return;
  shortcutHook.removeAllListeners();
  shortcutHook.kill();
  shortcutHook = null;
}

function startPriorityShortcutHook(accelerator) {
  const quick = acceleratorToVirtualKey(accelerator);
  const quit = acceleratorToVirtualKey(QUIT_SHORTCUT);
  if (!quick || !quit) return { ok: false, shortcut: accelerator, error: "This shortcut is not supported by priority mode" };
  stopPriorityShortcutHook();
  const code = `using System; using System.Diagnostics; using System.Runtime.InteropServices; public class CpetHook { delegate IntPtr Proc(int c,IntPtr w,IntPtr l); static Proc proc=Call; static IntPtr hook; static int q=${quick.vk},x=${quit.vk}; static bool qc=${quick.ctrl.toString().toLowerCase()},qa=${quick.alt.toString().toLowerCase()},qs=${quick.shift.toString().toLowerCase()}; static IntPtr Call(int c,IntPtr w,IntPtr l){ if(c>=0&&(w==(IntPtr)0x100||w==(IntPtr)0x104)){int k=Marshal.ReadInt32(l);bool ctrl=(GetAsyncKeyState(0x11)&0x8000)!=0,alt=(GetAsyncKeyState(0x12)&0x8000)!=0,shift=(GetAsyncKeyState(0x10)&0x8000)!=0;if(k==x&&ctrl&&!alt){Console.WriteLine("quit");return (IntPtr)1;}if(k==q&&ctrl==qc&&alt==qa&&shift==qs){Console.WriteLine("quick");return (IntPtr)1;}}return CallNextHookEx(hook,c,w,l);} public static void Run(){using(Process p=Process.GetCurrentProcess())using(ProcessModule m=p.MainModule){hook=SetWindowsHookEx(13,proc,GetModuleHandle(m.ModuleName),0);} MSG msg;while(GetMessage(out msg,IntPtr.Zero,0,0)>0){} } [StructLayout(LayoutKind.Sequential)]struct MSG{public IntPtr h;public uint m;public UIntPtr w;public IntPtr l;public uint t;public int x;public int y;} [DllImport("user32.dll")]static extern IntPtr SetWindowsHookEx(int i,Proc p,IntPtr h,uint d);[DllImport("user32.dll")]static extern IntPtr CallNextHookEx(IntPtr h,int c,IntPtr w,IntPtr l);[DllImport("user32.dll")]static extern short GetAsyncKeyState(int k);[DllImport("kernel32.dll")]static extern IntPtr GetModuleHandle(string n);[DllImport("user32.dll")]static extern int GetMessage(out MSG m,IntPtr h,uint a,uint b);}`;
  const script = `Add-Type -TypeDefinition '${code.replace(/'/g, "''")}'; [CpetHook]::Run()`;
  try {
    shortcutHook = spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script], { windowsHide: true });
    shortcutHook.stdout.setEncoding("utf8");
    shortcutHook.stdout.on("data", (data) => String(data).trim().split(/\s+/).forEach((event) => {
      if (event === "quick") toggleQuickEntry();
      if (event === "quit") quitApplication();
    }));
    shortcutHook.on("error", () => { shortcutHook = null; });
    return { ok: true, shortcut: accelerator, priority: true };
  } catch (error) {
    shortcutHook = null;
    return { ok: false, shortcut: accelerator, error: error.message };
  }
}

function normalizeVisualBounds(value, bounds) {
  const width = Math.max(1, Number(bounds?.width) || PET_SIZE.width);
  const height = Math.max(1, Number(bounds?.height) || PET_SIZE.height);
  const left = Number(value?.left);
  const top = Number(value?.top);
  const right = Number(value?.right);
  const bottom = Number(value?.bottom);
  return {
    left: Number.isFinite(left) ? Math.min(Math.max(left, 0), width) : 0,
    top: Number.isFinite(top) ? Math.min(Math.max(top, 0), height) : 0,
    right: Number.isFinite(right) ? Math.min(Math.max(right, 0), width) : width,
    bottom: Number.isFinite(bottom) ? Math.min(Math.max(bottom, 0), height) : height,
  };
}

function getPetPeek(visualBounds) {
  const height = Math.max(0, visualBounds.bottom - visualBounds.top);
  return Math.round(Math.min(Math.max(height * 0.24, 36), 72));
}

function getMoveLimits(display, visualBounds) {
  const { workArea, bounds: displayBounds } = display;
  const peek = getPetPeek(visualBounds);
  let minX = workArea.x - visualBounds.left;
  let maxX = workArea.x + workArea.width - visualBounds.right;
  let minY = workArea.y - visualBounds.top;
  let maxY = workArea.y + workArea.height - visualBounds.bottom;
  // Keep sliding below the bottom taskbar (or off the bottom of a monitor
  // without one) until only a small strip of the pet remains visible.
  maxY = Math.max(maxY, workArea.y + workArea.height - peek - visualBounds.top);
  if (displayBounds.x < workArea.x) {
    minX = Math.min(minX, workArea.x + peek - visualBounds.right);
  }
  if (workArea.x + workArea.width < displayBounds.x + displayBounds.width) {
    maxX = Math.max(maxX, workArea.x + workArea.width - peek - visualBounds.left);
  }
  if (displayBounds.y < workArea.y) {
    minY = Math.min(minY, workArea.y + peek - visualBounds.bottom);
  }
  return { minX, maxX, minY, maxY };
}

function getPetShapeRects() {
  const bounds = petWindow.getBounds();
  const rects = [];
  for (const display of screen.getAllDisplays()) {
    const area = display.workArea;
    const left = Math.max(bounds.x, area.x);
    const top = Math.max(bounds.y, area.y);
    const right = Math.min(bounds.x + bounds.width, area.x + area.width);
    const bottom = Math.min(bounds.y + bounds.height, area.y + area.height);
    if (right <= left || bottom <= top) continue;
    rects.push({ x: left - bounds.x, y: top - bounds.y, width: right - left, height: bottom - top });
  }
  return { bounds, rects };
}

function updatePetShape() {
  if (!petWindow || petWindow.isDestroyed()) return;
  const { bounds, rects } = getPetShapeRects();
  const full = rects.some((rect) => rect.x === 0 && rect.y === 0 && rect.width === bounds.width && rect.height === bounds.height);
  const shape = full ? [] : rects;
  const key = shape.map((rect) => rect.x + ":" + rect.y + ":" + rect.width + ":" + rect.height).join("|");
  if (key === lastPetShapeKey) return;
  lastPetShapeKey = key;
  try {
    petWindow.setShape(shape);
  } catch {
    // setShape is experimental; the pet still moves if a build rejects it.
  }
}

function applyExternalFullscreen(fullscreen) {
  const next = Boolean(fullscreen);
  if (next === externalFullscreen || quitting) return;
  externalFullscreen = next;
  if (next) {
    fullscreenRestoreState = {
      pet: Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()),
      note: Boolean(noteWindow && !noteWindow.isDestroyed() && noteWindow.isVisible()),
    };
    dragState = null;
    petWindow?.hide();
    noteWindow?.hide();
    return;
  }
  if (fullscreenRestoreState.pet && petWindow && !petWindow.isDestroyed()) petWindow.showInactive();
  if (fullscreenRestoreState.note && noteWindow && !noteWindow.isDestroyed()) noteWindow.showInactive();
  updatePetShape();
  fullscreenRestoreState = { pet: false, note: false };
}

function stopFullscreenMonitor() {
  if (!fullscreenMonitor) return;
  fullscreenMonitor.removeAllListeners();
  fullscreenMonitor.kill();
  fullscreenMonitor = null;
}

function startFullscreenMonitor() {
  if (process.platform !== "win32") return;
  stopFullscreenMonitor();
  const code = `using System; using System.Diagnostics; using System.Runtime.InteropServices; using System.Text; using System.Threading; public class CpetFullscreen { [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left,Top,Right,Bottom; } [StructLayout(LayoutKind.Sequential)] struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; } [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r); [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint f); [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFO m); [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h); [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h); [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n); static bool Full(int own) { IntPtr h=GetForegroundWindow(); if(h==IntPtr.Zero||!IsWindowVisible(h)||IsIconic(h))return false; uint pid;GetWindowThreadProcessId(h,out pid);if(pid==(uint)own)return false;var name=new StringBuilder(128);GetClassName(h,name,name.Capacity);string c=name.ToString();if(c=="Progman"||c=="WorkerW"||c=="Shell_TrayWnd")return false;RECT r;if(!GetWindowRect(h,out r))return false;IntPtr mon=MonitorFromWindow(h,2);var m=new MONITORINFO();m.cbSize=Marshal.SizeOf(m);if(mon==IntPtr.Zero||!GetMonitorInfo(mon,ref m))return false;const int t=2;return Math.Abs(r.Left-m.rcMonitor.Left)<=t&&Math.Abs(r.Top-m.rcMonitor.Top)<=t&&Math.Abs(r.Right-m.rcMonitor.Right)<=t&&Math.Abs(r.Bottom-m.rcMonitor.Bottom)<=t;} public static void Run(int own){bool? last=null;while(true){try{Process.GetProcessById(own);}catch{return;}bool now=Full(own);if(last==null||last.Value!=now){Console.WriteLine(now?"1":"0");Console.Out.Flush();last=now;}Thread.Sleep(350);}}}`;
  const script = `Add-Type -TypeDefinition '${code.replace(/'/g, "''")}'; [CpetFullscreen]::Run(${process.pid})`;
  try {
    fullscreenMonitor = spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script], { windowsHide: true });
    fullscreenMonitor.stdout.setEncoding("utf8");
    fullscreenMonitor.stdout.on("data", (data) => {
      for (const state of String(data).match(/[01]/g) || []) applyExternalFullscreen(state === "1");
    });
    fullscreenMonitor.on("error", () => { fullscreenMonitor = null; });
  } catch {
    fullscreenMonitor = null;
  }
}

function loadCompletedTasks() {
  try {
    const stored = JSON.parse(fs.readFileSync(completedTasksPath, "utf8"));
    completedTasks = Array.isArray(stored) ? stored : [];
  } catch {
    completedTasks = [];
  }
}

function persistCompletedTasks() {
  fs.writeFileSync(completedTasksPath, JSON.stringify(completedTasks, null, 2), "utf8");
}

function loadWindowState() {
  try {
    savedWindowState = JSON.parse(fs.readFileSync(windowStatePath, "utf8"));
  } catch {
    savedWindowState = {};
  }
}

function getVisibleBounds(bounds, fallbackSize) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return null;
  const width = Math.max(fallbackSize.width, Number(bounds.width) || fallbackSize.width);
  const height = Math.max(fallbackSize.height, Number(bounds.height) || fallbackSize.height);
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const area = display.bounds;
  return {
    width: Math.min(width, area.width),
    height: Math.min(height, area.height),
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - Math.min(width, area.width)),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - Math.min(height, area.height)),
  };
}

function persistWindowState() {
  if (petWindow && !petWindow.isDestroyed()) savedWindowState.pet = petWindow.getBounds();
  if (noteWindow && !noteWindow.isDestroyed()) savedWindowState.note = noteWindow.getBounds();
  fs.writeFileSync(windowStatePath, JSON.stringify(savedWindowState, null, 2), "utf8");
}

function scheduleWindowStateSave() {
  clearTimeout(saveWindowTimer);
  saveWindowTimer = setTimeout(persistWindowState, 180);
}

function quitApplication() {
  if (quitting) return;
  quitting = true;
  dragState = null;
  clearTimeout(saveWindowTimer);
  persistWindowState();
  app.quit();
}

function placePetBottomRight() {
  if (!petWindow) return;
  const area = screen.getPrimaryDisplay().workArea;
  petWindow.setBounds({
    width: PET_SIZE.width,
    height: PET_SIZE.height,
    x: Math.round(area.x + area.width - PET_SIZE.width),
    y: Math.round(area.y + area.height - PET_SIZE.height),
  });
}

function commonWindowOptions() {
  return {
    icon: path.join(__dirname, "assets", "task_icon.ico"),
    transparent: true,
    frame: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  };
}

function createPetWindow() {
  lastPetShapeKey = "";
  petWindow = new BrowserWindow({
    ...commonWindowOptions(),
    ...PET_SIZE,
    minWidth: PET_SIZE.width,
    minHeight: PET_SIZE.height,
    resizable: false,
    skipTaskbar: false,
  });
  if (process.platform === "win32") {
    petWindow.setAppDetails({
      appId: APP_ID,
      relaunchCommand: `"${getLaunchExecutable()}"`,
      relaunchDisplayName: "C.pet",
    });
  }
  petWindow.setMenuBarVisibility(false);
  installQuitKeyFallback(petWindow);
  petWindow.setAlwaysOnTop(true, "floating");
  placePetBottomRight();
  petWindow.loadFile(path.join(__dirname, "index.html"));
  petWindow.on("move", () => {
    updatePetShape();
    scheduleWindowStateSave();
  });
  petWindow.on("show", updatePetShape);
  petWindow.webContents.on("did-finish-load", updatePetShape);
  petWindow.on("close", quitApplication);
}

function createNoteWindow() {
  noteWindow = new BrowserWindow({
    ...commonWindowOptions(),
    ...NOTE_SIZE,
    minWidth: NOTE_SIZE.width,
    minHeight: 112,
    resizable: false,
    show: false,
    skipTaskbar: true,
  });
  noteWindow.setMenuBarVisibility(false);
  installQuitKeyFallback(noteWindow);
  noteWindow.setAlwaysOnTop(true, "floating");
  noteWindow.loadFile(path.join(__dirname, "note.html"));
  const restoredBounds = getVisibleBounds(savedWindowState.note, NOTE_SIZE);
  if (restoredBounds) noteWindow.setBounds(restoredBounds);
  else noteWindow.center();
  noteWindow.on("move", scheduleWindowStateSave);
  noteWindow.on("resize", scheduleWindowStateSave);
  noteWindow.on("close", quitApplication);
}

ipcMain.handle("note:toggle", () => {
  if (!noteWindow) return false;
  if (noteWindow.isVisible()) {
    noteWindow.hide();
    return false;
  }
  if (externalFullscreen) return false;
  noteWindow.center();
  noteWindow.show();
  noteWindow.focus();
  return true;
});

ipcMain.handle("note:hide", () => {
  quitApplication();
});

ipcMain.handle("note:set-height", (event, requestedHeight) => {
  if (!noteWindow || event.sender !== noteWindow.webContents) return;
  const bounds = noteWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const { workArea } = display;
  const height = Math.min(Math.max(Math.round(Number(requestedHeight) || NOTE_SIZE.height), 112), workArea.height);
  const y = Math.min(bounds.y, workArea.y + workArea.height - height);
  noteWindow.setBounds({ x: bounds.x, y: Math.max(y, workArea.y), width: NOTE_SIZE.width, height });
});

function movePetToCursor() {
  if (!petWindow || petWindow.isDestroyed() || !dragState) return;
  const point = screen.getCursorScreenPoint();
  if (point.x === dragState.lastCursor.x && point.y === dragState.lastCursor.y) return;
  dragState.lastCursor = point;
  const display = screen.getDisplayNearestPoint(point);
  const { origin, startBounds, visualBounds } = dragState;
  const desiredX = startBounds.x + point.x - origin.x;
  const desiredY = startBounds.y + point.y - origin.y;
  const { minX, maxX, minY, maxY } = getMoveLimits(display, visualBounds);
  const x = Math.min(Math.max(desiredX, minX), maxX);
  const y = Math.min(Math.max(desiredY, minY), maxY);
  petWindow.setPosition(Math.round(x), Math.round(y));
  updatePetShape();
}

ipcMain.on("window:start-drag", (event, details) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  if (!target || target !== petWindow) return;
  const cursor = screen.getCursorScreenPoint();
  const bounds = target.getBounds();
  dragState = {
    origin: cursor,
    lastCursor: cursor,
    startBounds: bounds,
    visualBounds: normalizeVisualBounds(details?.visualBounds, bounds),
  };
});

ipcMain.on("window:update-drag", (event) => {
  if (event.sender !== petWindow?.webContents) return;
  movePetToCursor();
});

ipcMain.on("window:stop-drag", (event) => {
  if (event.sender !== petWindow?.webContents) return;
  dragState = null;
});

function nudgePet(details = {}) {
  if (!petWindow || petWindow.isDestroyed()) return;
  const bounds = petWindow.getBounds();
  const visualBounds = normalizeVisualBounds(details.visualBounds || petVisualBounds, bounds);
  if (details.visualBounds) petVisualBounds = visualBounds;
  const display = screen.getDisplayMatching(bounds);
  const { minX, maxX, minY, maxY } = getMoveLimits(display, visualBounds);
  const requestedX = Number(details?.x);
  const requestedY = Number(details?.y);
  const dx = Number.isFinite(requestedX) ? Math.min(Math.max(Math.round(requestedX), -24), 24) : 0;
  const dy = Number.isFinite(requestedY) ? Math.min(Math.max(Math.round(requestedY), -24), 24) : 0;
  const x = Math.min(Math.max(bounds.x + dx, minX), maxX);
  const y = Math.min(Math.max(bounds.y + dy, minY), maxY);
  if (x === bounds.x && y === bounds.y) return;
  petWindow.setPosition(Math.round(x), Math.round(y));
  updatePetShape();
}

ipcMain.on("window:nudge-pet", (event, details) => {
  if (event.sender !== petWindow?.webContents) return;
  nudgePet(details);
});

ipcMain.on("window:nudge-pet-key", (event, details) => {
  if (event.sender !== petWindow?.webContents && event.sender !== noteWindow?.webContents) return;
  if (externalFullscreen) return;
  nudgePet({ x: details?.x, y: details?.y });
});

ipcMain.on("window:set-pet-bounds", (event, visualBounds) => {
  if (event.sender !== petWindow?.webContents) return;
  petVisualBounds = normalizeVisualBounds(visualBounds, petWindow.getBounds());
});

ipcMain.handle("window:set-ignore-mouse", (event, ignore) => {
  const target = BrowserWindow.fromWebContents(event.sender);
  target?.setIgnoreMouseEvents(Boolean(ignore), { forward: true });
});

ipcMain.handle("window:set-always-on-top", (_event, enabled) => {
  petWindow?.setAlwaysOnTop(Boolean(enabled), "floating");
  noteWindow?.setAlwaysOnTop(Boolean(enabled), "floating");
});

ipcMain.handle("window:reset-pet-position", () => {
  placePetBottomRight();
  updatePetShape();
});

ipcMain.handle("settings:broadcast", (_event, patch) => {
  savedSettings = { ...savedSettings, ...patch };
  persistSettings();
  for (const window of [petWindow, noteWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send("settings:changed", patch);
  }
});

ipcMain.handle("settings:get", () => savedSettings);

ipcMain.handle("tools:list", () => listScriptTools());

ipcMain.handle("monitor:get", async () => {
  const memoryTotal = os.totalmem();
  const memoryUsed = memoryTotal - os.freemem();
  let disk = null;
  try {
    const stats = fs.statfsSync("C:\\");
    disk = { total: stats.blocks * stats.bsize, free: stats.bfree * stats.bsize };
  } catch {}
  const now = Date.now();
  if (now - cachedTempSize.sampledAt > 30000) {
    cachedTempSize = { value: getDirectorySize(os.tmpdir(), 1), sampledAt: now };
  }
  const performance = await getCachedWindowsPerformance();
  const cpuInfo = os.cpus();
  return {
    cpu: getCpuPercent(),
    memory: { used: memoryUsed, total: memoryTotal },
    disk,
    cache: cachedTempSize.value,
    gpu: performance.gpu,
    network: { rx: performance.rx, tx: performance.tx },
    processes: performance.processes,
    uptime: os.uptime(),
    idle: powerMonitor.getSystemIdleTime(),
    cpuInfo: {
      model: cpuInfo[0]?.model?.trim() || "Unknown",
      logical: cpuInfo.length,
      speed: cpuInfo.length ? Math.round(cpuInfo.reduce((sum, cpu) => sum + cpu.speed, 0) / cpuInfo.length) : 0,
    },
    appMemory: process.memoryUsage().rss,
  };
});

ipcMain.handle("tools:launch", (_event, toolId) => {
  const scriptsDir = getScriptsDirectory();
  if (!scriptsDir) return { ok: false, error: "Scripts folder not found" };
  const requested = String(toolId || "");
  if (requested === "生成Index.exe") return { ok: false, error: "This special tool is temporarily disabled" };
  const allowed = listScriptTools().find((tool) => tool.id === requested);
  if (!allowed) return { ok: false, error: "Tool not found" };
  const executable = path.resolve(scriptsDir, allowed.id);
  if (path.dirname(executable) !== path.resolve(scriptsDir)) return { ok: false, error: "Invalid tool path" };
  try {
    const child = spawn(executable, [], { cwd: scriptsDir, detached: true, stdio: "ignore" });
    child.unref();
    if (process.platform === "win32") {
      setTimeout(() => {
        const processName = path.basename(executable, path.extname(executable)).replace(/'/g, "''");
        const command = `Add-Type @'\nusing System; using System.Runtime.InteropServices; public class ToolWindow { [DllImport(\"user32.dll\")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hgt, uint f); }\n'@; $until=(Get-Date).AddSeconds(6); do { $p=Get-Process -Name '${processName}' -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | Sort-Object StartTime -Descending | Select-Object -First 1; if ($p) { [ToolWindow]::SetWindowPos($p.MainWindowHandle, [IntPtr](-1), 0, 0, 580, 650, 0x0040) | Out-Null; break }; Start-Sleep -Milliseconds 250 } while ((Get-Date) -lt $until)`;
        spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", command], { detached: true, stdio: "ignore" }).unref();
      }, 1400);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message || "Unable to launch tool" };
  }
});

ipcMain.handle("action:perform", (_event, action) => {
  if (!petWindow || petWindow.isDestroyed()) return false;
  petWindow.webContents.send("action:requested", String(action));
  return true;
});

ipcMain.handle("shortcut:set", (_event, accelerator) => {
  const previous = registeredQuickShortcut || savedSettings.quickShortcut || DEFAULT_QUICK_SHORTCUT;
  const result = registerQuickShortcut(accelerator);
  if (result.ok) {
    savedSettings.quickShortcut = result.shortcut;
    persistSettings();
    return result;
  }
  const restored = registerQuickShortcut(previous);
  return { ...result, activeShortcut: restored.ok ? restored.shortcut : null };
});

ipcMain.handle("app:get-version", () => app.getVersion());

ipcMain.handle("database:list-completed", () => completedTasks);

ipcMain.handle("database:complete-task", (_event, text, list) => {
  const value = String(text || "").trim();
  if (!value) return null;
  const sourceList = ["To Do", "Idea"].includes(list) ? list : "To Do";
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const record = {
    id: `${now.getTime()}-${Math.random().toString(16).slice(2)}`,
    text: value,
    list: sourceList,
    date: localDate,
    completedAt: now.toISOString(),
  };
  completedTasks.unshift(record);
  persistCompletedTasks();
  return record;
});

ipcMain.handle("database:delete-completed", (_event, id) => {
  completedTasks = completedTasks.filter((task) => task.id !== id);
  persistCompletedTasks();
  return completedTasks.length;
});

ipcMain.handle("database:clear-completed", () => {
  completedTasks = [];
  persistCompletedTasks();
});

ipcMain.handle("app:set-launch-at-login", (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: getLaunchExecutable() });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("app:get-launch-at-login", () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle("link:open-edge", async (_event, url) => {
  if (typeof url !== "string") return false;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) return false;
  await shell.openExternal(`microsoft-edge:${parsed.href}`);
  return true;
});

ipcMain.handle("window:quit", () => {
  quitApplication();
});

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  settingsPath = path.join(app.getPath("userData"), "settings.json");
  windowStatePath = path.join(app.getPath("userData"), "window-state.json");
  completedTasksPath = path.join(app.getPath("userData"), "completed-tasks.json");
  loadSettings();
  loadWindowState();
  loadCompletedTasks();
  if (!savedSettings.quickShortcut) savedSettings.quickShortcut = DEFAULT_QUICK_SHORTCUT;
  if (typeof savedSettings.launchAtLogin === "boolean") {
    app.setLoginItemSettings({ openAtLogin: savedSettings.launchAtLogin, path: getLaunchExecutable() });
  }
  createPetWindow();
  createNoteWindow();
  updatePetShape();
  screen.on("display-metrics-changed", updatePetShape);
  screen.on("display-added", updatePetShape);
  screen.on("display-removed", updatePetShape);
  startFullscreenMonitor();
  refreshPinnedShortcuts();
  if (process.platform === "win32") {
    const shortcutPath = path.join(getPortableDirectory(), "C.pet.lnk");
    try {
      shell.writeShortcutLink(shortcutPath, "create", {
        target: getLaunchExecutable(),
        cwd: getPortableDirectory(),
        icon: getLaunchExecutable(),
        iconIndex: 0,
        appUserModelId: APP_ID,
        description: "C.pet desktop pet",
      });
    } catch {
      // The app still runs normally if the portable directory is read-only.
    }
  }
  globalShortcut.register(QUIT_SHORTCUT, quitApplication);
  const shortcutResult = registerQuickShortcut(savedSettings.quickShortcut);
  if (!shortcutResult.ok && savedSettings.quickShortcut !== DEFAULT_QUICK_SHORTCUT) {
    const fallbackResult = registerQuickShortcut(DEFAULT_QUICK_SHORTCUT);
    if (fallbackResult.ok) savedSettings.quickShortcut = DEFAULT_QUICK_SHORTCUT;
  }
  persistSettings();
});

app.on("before-quit", () => {
  quitting = true;
  dragState = null;
  clearTimeout(saveWindowTimer);
  stopPriorityShortcutHook();
  stopFullscreenMonitor();
  if (windowStatePath) persistWindowState();
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!petWindow || petWindow.isDestroyed()) createPetWindow();
  if (!noteWindow || noteWindow.isDestroyed()) createNoteWindow();
});

app.on("second-instance", () => {
  if (!petWindow || externalFullscreen) return;
  if (petWindow.isMinimized()) petWindow.restore();
  petWindow.show();
  petWindow.focus();
});
