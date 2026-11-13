const note = document.querySelector("#note");
const settingsPanel = document.querySelector("#settingsPanel");
const toolsPanel = document.querySelector("#toolsPanel");
const monitorPanel = document.querySelector("#monitorPanel");
const databasePanel = document.querySelector("#databasePanel");
const settingsButton = document.querySelector("#settingsButton");
const toolsButton = document.querySelector("#toolsButton");
const monitorButton = document.querySelector("#monitorButton");
const backFromMonitor = document.querySelector("#backFromMonitor");
const monitorContent = document.querySelector("#monitorContent");
const monitorCat = document.querySelector("#monitorCat");
const backFromTools = document.querySelector("#backFromTools");
const toolsList = document.querySelector("#toolsList");
const toolsStatus = document.querySelector("#toolsStatus");
const toolsCat = document.querySelector("#toolsCat");
const listTitle = document.querySelector("#listTitle");
const listModeButton = document.querySelector("#listModeButton");
const backToTodos = document.querySelector("#backToTodos");
const todoList = document.querySelector("#todoList");
const asciiCat = document.querySelector("#asciiCat");
const settingsCat = document.querySelector("#settingsCat");
const scaleRange = document.querySelector("#scaleRange");
const scaleValue = document.querySelector("#scaleValue");
const autoActionToggle = document.querySelector("#autoActionToggle");
const actionGrid = document.querySelector("#actionGrid");
const effectGrid = document.querySelector("#effectGrid");
const alwaysOnTopToggle = document.querySelector("#alwaysOnTopToggle");
const launchAtLoginToggle = document.querySelector("#launchAtLoginToggle");
const shortcutButton = document.querySelector("#shortcutButton");
const shortcutStatus = document.querySelector("#shortcutStatus");
const openDatabase = document.querySelector("#openDatabase");
const databaseCount = document.querySelector("#databaseCount");
const databaseList = document.querySelector("#databaseList");
const backToSettings = document.querySelector("#backToSettings");
const clearDatabase = document.querySelector("#clearDatabase");
const databaseCat = document.querySelector("#databaseCat");
const resetScale = document.querySelector("#resetScale");
const resetPetPosition = document.querySelector("#resetPetPosition");
const quitApp = document.querySelector("#quitApp");
const appVersion = document.querySelector("#appVersion");
const quickLinksList = document.querySelector("#quickLinksList");
const showLinkForm = document.querySelector("#showLinkForm");
const linkForm = document.querySelector("#linkForm");
const linkName = document.querySelector("#linkName");
const linkUrl = document.querySelector("#linkUrl");
const undoToast = document.querySelector("#undoToast");
const undoMessage = document.querySelector("#undoMessage");
const undoComplete = document.querySelector("#undoComplete");

const activeListStorageKey = "cpet.activeList.v1";
const settingsStorageKey = "cpet.settings.v3";
const linksStorageKey = "cpet.links.v1";
const catFrames = ["(=^･ω･^=)", "(=^･ω･^=) z", "(=^>ω<^=) Z", "(=^･ω･^=)  "];
const petActions = [
  ["idle", "Idle"], ["scratch", "Scratch"], ["head", "Head"], ["akimbo", "Akimbo"],
  ["thumb", "Thumb"], ["wave", "Wave"], ["stretch", "Stretch"], ["yawn", "Yawn"],
  ["think", "Think"], ["clap", "Clap"], ["point", "Point"], ["bow", "Bow"],
  ["cheer", "Cheer"], ["giggle", "Giggle"], ["drowsy", "Drowsy"], ["salute", "Salute"],
];
const effects = [
  ["none", "None"], ["sparkles", "Sparkles"], ["glow", "Soft glow"],
  ["hearts", "Hearts"], ["fireflies", "Fireflies"], ["rainbow", "Rainbow aura"],
  ["rain", "Rain"], ["snow", "Snow"], ["sunshine", "Sunshine"],
];
const defaultLinks = [
  { id: "uav-survey", name: "UAV Survey", url: "https://jaijaic.site/UAV-Survey/" },
  { id: "c", name: "C", url: "https://jaijaic.site/C/" },
  { id: "c-sole", name: "C.Sole", url: "https://jaijaic.site/C.Sole/" },
];
const listModes = [
  { key: "todo", title: "To Do", storageKey: "cpet.todos.v3" },
  { key: "idea", title: "Idea", storageKey: "cpet.ideas.v1" },
];
const petArrowDirections = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

let activeListKey = localStorage.getItem(activeListStorageKey) || "todo";
if (!listModes.some((mode) => mode.key === activeListKey)) activeListKey = "todo";
let todos = loadJson(getActiveMode().storageKey, []);
let settings = {
  scale: 1,
  autoActions: true,
  alwaysOnTop: true,
  launchAtLogin: false,
  quickShortcut: "Ctrl+.",
  effect: "none",
  ...loadJson(settingsStorageKey, {}),
};
let links = loadJson(linksStorageKey, defaultLinks);
if (!Array.isArray(links)) links = [...defaultLinks];
let catIndex = 0;
let pendingUndo = null;
let undoTimer = null;
let recordingShortcut = false;
let monitorTimer = null;
let monitorBusy = false;
const monitorHistory = new Map();

function stopMonitorPolling() {
  clearInterval(monitorTimer);
  monitorTimer = null;
}

function startMonitorPolling() {
  stopMonitorPolling();
  if (document.hidden || monitorPanel.hidden) return;
  refreshMonitor();
  monitorTimer = window.setInterval(refreshMonitor, 450);
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function createId() {
  return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getActiveMode() {
  return listModes.find((mode) => mode.key === activeListKey) || listModes[0];
}

function saveTodos() {
  localStorage.setItem(getActiveMode().storageKey, JSON.stringify(todos));
}

function applyListMode() {
  const modeIndex = listModes.findIndex((mode) => mode.key === activeListKey);
  const mode = listModes[modeIndex];
  const nextMode = listModes[(modeIndex + 1) % listModes.length];
  listTitle.textContent = mode.title;
  document.title = mode.title;
  listModeButton.textContent = nextMode.title;
  listModeButton.title = `Switch to ${nextMode.title}`;
  localStorage.setItem(activeListStorageKey, activeListKey);
}

function switchListMode() {
  saveTodos();
  const index = listModes.findIndex((mode) => mode.key === activeListKey);
  activeListKey = listModes[(index + 1) % listModes.length].key;
  todos = loadJson(getActiveMode().storageKey, []);
  applyListMode();
  renderTodos(0);
}

function saveSettings(patch) {
  settings = { ...settings, ...patch };
  localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  window.cpet?.broadcastSettings(patch);
}

function resizeToContent(panel) {
  window.requestAnimationFrame(() => {
    window.cpet?.setNoteHeight(Math.ceil(panel.scrollHeight + 2));
  });
}

function ensureOneTask() {
  if (!todos.length) todos = [{ id: createId(), text: "", done: false, createdAt: Date.now() }];
}

function growTaskInput(input) {
  input.style.height = "auto";
  input.style.height = `${Math.max(29, input.scrollHeight)}px`;
}

function focusQuickEntry() {
  note.hidden = false;
  settingsPanel.hidden = true;
  databasePanel.hidden = true;
  toolsPanel.hidden = true;
  monitorPanel.hidden = true;
  let index = todos.findIndex((todo) => !String(todo.text || "").trim());
  if (index < 0) {
    todos.push({ id: createId(), text: "", done: false, createdAt: Date.now() });
    saveTodos();
    index = todos.length - 1;
  }
  renderTodos(index);
}

function showUndo(record, task, listKey, index) {
  clearTimeout(undoTimer);
  pendingUndo = { record, task, listKey, index };
  undoMessage.textContent = `Completed “${task.text}”`;
  undoToast.hidden = false;
  resizeToContent(note);
  undoTimer = window.setTimeout(() => {
    pendingUndo = null;
    undoToast.hidden = true;
    resizeToContent(note);
  }, 8000);
}

function renderTodos(focusIndex = null) {
  ensureOneTask();
  todoList.innerHTML = "";
  todos.forEach((todo, index) => {
    const item = document.createElement("li");
    item.className = "task-row";
    const number = document.createElement("span");
    number.className = "task-number";
    number.textContent = `${index + 1}.`;
    const input = document.createElement("textarea");
    input.className = "task-input";
    input.value = todo.text || "";
    input.maxLength = 120;
    input.autocomplete = "off";
    input.spellcheck = false;
    input.rows = 1;
    input.setAttribute("aria-label", `Task ${index + 1}`);
    input.addEventListener("input", () => {
      todo.text = input.value;
      saveTodos();
      growTaskInput(input);
      resizeToContent(note);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        todos.splice(index + 1, 0, { id: createId(), text: "", done: false, createdAt: Date.now() });
        saveTodos();
        renderTodos(index + 1);
      } else if (event.key === "Backspace" && !input.value && todos.length > 1) {
        event.preventDefault();
        todos.splice(index, 1);
        saveTodos();
        renderTodos(Math.max(0, index - 1));
      }
    });
    const complete = document.createElement("button");
    complete.className = "task-complete";
    complete.type = "button";
    complete.textContent = "✓";
    complete.title = "Complete and archive";
    complete.setAttribute("aria-label", `Complete task ${index + 1}`);
    complete.addEventListener("click", async () => {
      const text = input.value.trim();
      if (!text) return input.focus();
      complete.disabled = true;
      const completedTask = { ...todo, text };
      const completedListKey = activeListKey;
      const record = await window.cpet?.completeTask(text, getActiveMode().title);
      if (!record) {
        complete.disabled = false;
        return;
      }
      todos.splice(index, 1);
      saveTodos();
      renderTodos(Math.min(index, Math.max(0, todos.length - 1)));
      refreshDatabase();
      showUndo(record, completedTask, completedListKey, index);
    });
    item.append(number, input, complete);
    todoList.append(item);
    growTaskInput(input);
  });
  if (focusIndex !== null) {
    const target = todoList.querySelectorAll(".task-input")[focusIndex];
    target?.focus();
    target?.setSelectionRange(target.value.length, target.value.length);
  }
  resizeToContent(note);
}

function formatCompletedTime(record) {
  const time = new Date(record.completedAt);
  if (Number.isNaN(time.getTime())) return record.date;
  return `${record.date} ${time.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
}

async function refreshDatabase() {
  const records = await window.cpet?.listCompletedTasks() || [];
  databaseCount.textContent = records.length;
  databaseList.innerHTML = "";
  if (!records.length) {
    const empty = document.createElement("li");
    empty.className = "database-empty";
    empty.textContent = "No completed tasks yet";
    databaseList.append(empty);
  } else {
    records.forEach((record) => {
      const item = document.createElement("li");
      item.className = "database-item";
      const content = document.createElement("div");
      const text = document.createElement("p");
      text.textContent = record.text;
      const meta = document.createElement("div");
      meta.className = "database-meta";
      const source = document.createElement("span");
      source.className = "database-source";
      source.textContent = record.list || "To Do";
      const date = document.createElement("time");
      date.dateTime = record.completedAt;
      date.textContent = formatCompletedTime(record);
      meta.append(source, date);
      content.append(text, meta);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "Delete record";
      remove.setAttribute("aria-label", "Delete completed task record");
      remove.addEventListener("click", async () => {
        await window.cpet?.deleteCompletedTask(record.id);
        refreshDatabase();
      });
      item.append(content, remove);
      databaseList.append(item);
    });
  }
  if (!databasePanel.hidden) resizeToContent(databasePanel);
}

function normalizeUrl(value) {
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function renderLinks() {
  quickLinksList.innerHTML = "";
  links.forEach((link) => {
    const item = document.createElement("span");
    item.className = "quick-link-item";
    item.draggable = true;
    item.dataset.id = link.id;
    const open = document.createElement("button");
    open.className = "quick-link-open";
    open.type = "button";
    open.draggable = true;
    open.textContent = link.name;
    open.title = `${link.url}\nRight-click to remove`;
    open.addEventListener("click", () => window.cpet?.openInEdge(link.url));
    open.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      links = links.filter((entry) => entry.id !== link.id);
      localStorage.setItem(linksStorageKey, JSON.stringify(links));
      renderLinks();
    });
    item.addEventListener("dragstart", (event) => {
      item.classList.add("is-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", link.id);
    });
    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      const sourceId = event.dataTransfer.getData("text/plain");
      const sourceIndex = links.findIndex((entry) => entry.id === sourceId);
      const targetIndex = links.findIndex((entry) => entry.id === link.id);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;
      const [moved] = links.splice(sourceIndex, 1);
      links.splice(targetIndex, 0, moved);
      localStorage.setItem(linksStorageKey, JSON.stringify(links));
      renderLinks();
    });
    item.addEventListener("dragend", () => item.classList.remove("is-dragging"));
    item.append(open);
    quickLinksList.append(item);
  });
  resizeToContent(note);
}

function applySettings() {
  scaleRange.value = settings.scale;
  scaleValue.textContent = `${Math.round(settings.scale * 100)}%`;
  autoActionToggle.checked = settings.autoActions;
  alwaysOnTopToggle.checked = settings.alwaysOnTop;
  launchAtLoginToggle.checked = settings.launchAtLogin;
  shortcutButton.textContent = formatShortcut(settings.quickShortcut);
  renderEffects();
}

function renderActionGrid() {
  actionGrid.innerHTML = "";
  petActions.forEach(([key, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      window.cpet?.performAction(key);
      actionGrid.querySelectorAll("button").forEach((entry) => entry.classList.toggle("is-active", entry === button));
    });
    actionGrid.append(button);
  });
}

function renderEffects() {
  effectGrid.innerHTML = "";
  effects.forEach(([key, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.classList.toggle("is-active", settings.effect === key);
    button.addEventListener("click", () => saveSettings({ effect: key }));
    effectGrid.append(button);
  });
}

function formatShortcut(shortcut) {
  return String(shortcut || "Ctrl+.").split("+").join(" + ");
}

function shortcutFromEvent(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push("Ctrl");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Super");
  if (!modifiers.length || ["Control", "Alt", "Shift", "Meta"].includes(event.key)) return null;
  const key = event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [...modifiers, key].join("+");
}

function animateCat() {
  catIndex = (catIndex + 1) % catFrames.length;
  asciiCat.textContent = catFrames[catIndex];
  settingsCat.textContent = catFrames[catIndex];
  databaseCat.textContent = catFrames[catIndex];
  toolsCat.textContent = catFrames[catIndex];
  monitorCat.textContent = catFrames[catIndex];
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return "Unavailable";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(index > 2 ? 1 : 0)} ${units[index]}`;
}

function formatDuration(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(value / 86400);
  const hours = Math.floor(value % 86400 / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  return days ? `${days}d ${hours}h` : `${hours}h ${minutes}m`;
}

function addMonitorSample(key, value) {
  if (!Number.isFinite(value)) return [];
  const history = monitorHistory.get(key) || [];
  history.push(value);
  if (history.length > 28) history.shift();
  monitorHistory.set(key, history);
  return history;
}

function monitorCard(label, value, percent = null, trendKey = null, trendValue = null) {
  const card = document.createElement("div");
  card.className = "monitor-card";
  const head = document.createElement("div");
  head.className = "monitor-card-head";
  const title = document.createElement("span");
  title.textContent = label;
  const output = document.createElement("strong");
  output.textContent = value;
  head.append(title, output);
  card.append(head);
  const history = trendKey ? addMonitorSample(trendKey, trendValue) : [];
  let intensity = Number.isFinite(percent) ? percent : null;
  if (intensity === null && history.length > 1 && Number.isFinite(trendValue)) {
    const low = Math.min(...history);
    const high = Math.max(...history);
    intensity = high > low ? (trendValue - low) / (high - low) * 100 : 35;
  }
  if (Number.isFinite(intensity)) {
    const hue = 145 - Math.max(0, Math.min(100, intensity)) * 1.4;
    card.style.setProperty("--load-color", `hsl(${hue.toFixed(0)} 72% 58%)`);
    card.style.setProperty("--load-soft", `hsl(${hue.toFixed(0)} 55% 22% / 0.42)`);
  }
  if (Number.isFinite(percent)) {
    const track = document.createElement("div");
    track.className = "monitor-track";
    const fill = document.createElement("i");
    fill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    track.append(fill);
    card.append(track);
  }
  if (trendKey) {
    if (history.length > 1) {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", "monitor-trend");
      svg.setAttribute("viewBox", "0 0 100 22");
      svg.setAttribute("preserveAspectRatio", "none");
      const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      const min = Math.min(...history);
      const max = Math.max(...history);
      const span = Math.max(max - min, max * 0.08, 1);
      line.setAttribute("points", history.map((sample, index) => {
        const x = history.length === 1 ? 100 : index / (history.length - 1) * 100;
        const y = 20 - (sample - min) / span * 17;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(" "));
      svg.append(line);
      card.append(svg);
    }
  }
  return card;
}

async function refreshMonitor() {
  if (monitorPanel.hidden || monitorBusy) return;
  monitorBusy = true;
  let stats;
  try {
    stats = await window.cpet?.getMonitorStats();
  } finally {
    monitorBusy = false;
  }
  if (!stats || monitorPanel.hidden) return;
  monitorContent.innerHTML = "";
  const memoryPercent = stats.memory.total ? stats.memory.used / stats.memory.total * 100 : null;
  const diskUsed = stats.disk ? stats.disk.total - stats.disk.free : null;
  const diskPercent = stats.disk?.total ? diskUsed / stats.disk.total * 100 : null;
  const rx = stats.network?.rx;
  const tx = stats.network?.tx;
  monitorContent.append(
    monitorCard("CPU", `${stats.cpu}%`, stats.cpu, "cpu", stats.cpu),
    monitorCard("CPU cores", `${stats.cpuInfo.logical} logical`),
    monitorCard("CPU speed", stats.cpuInfo.speed ? `${stats.cpuInfo.speed} MHz` : "Unavailable", null, "cpu-speed", stats.cpuInfo.speed),
    monitorCard("Memory", `${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`, memoryPercent, "memory", memoryPercent),
    monitorCard("Available RAM", formatBytes(stats.memory.total - stats.memory.used), memoryPercent, "available-ram", stats.memory.total - stats.memory.used),
    monitorCard("GPU", stats.gpu === null ? "Unavailable" : `${stats.gpu.toFixed(1)}%`, stats.gpu, "gpu", stats.gpu),
    monitorCard("C: drive", stats.disk ? `${formatBytes(stats.disk.free)} free` : "Unavailable", diskPercent, "disk", diskPercent),
    monitorCard("Download", rx === null ? "Unavailable" : `${formatBytes(rx)}/s`, null, "download", rx),
    monitorCard("Upload", tx === null ? "Unavailable" : `${formatBytes(tx)}/s`, null, "upload", tx),
    monitorCard("Temp cache", formatBytes(stats.cache), null, "cache", stats.cache),
    monitorCard("Processes", stats.processes === null ? "Unavailable" : String(stats.processes), null, "processes", stats.processes),
    monitorCard("System uptime", formatDuration(stats.uptime), null, "uptime", stats.uptime),
    monitorCard("System idle", formatDuration(stats.idle), null, "idle", stats.idle),
    monitorCard("C.pet memory", formatBytes(stats.appMemory), null, "app-memory", stats.appMemory),
  );
  resizeToContent(monitorPanel);
}

async function refreshTools() {
  toolsList.innerHTML = "";
  toolsStatus.textContent = "";
  const tools = await window.cpet?.listTools() || [];
  if (!tools.length) {
    toolsStatus.textContent = "No EXE tools found in the scripts folder.";
    resizeToContent(toolsPanel);
    return;
  }
  tools.forEach((tool) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tool-button";
    if (tool.id === "生成Index.exe") {
      button.disabled = true;
      button.title = "Temporarily disabled";
    }
    const name = document.createElement("span");
    name.textContent = tool.name;
    const file = document.createElement("small");
    file.textContent = tool.id;
    button.append(name, file);
    button.addEventListener("click", async () => {
      button.disabled = true;
      toolsStatus.textContent = `Launching ${tool.name}…`;
      const result = await window.cpet?.launchTool(tool.id);
      toolsStatus.textContent = result?.ok ? `${tool.name} launched.` : (result?.error || "Unable to launch tool.");
      button.disabled = false;
    });
    toolsList.append(button);
  });
  resizeToContent(toolsPanel);
}

settingsButton.addEventListener("click", () => {
  note.hidden = true;
  toolsPanel.hidden = true;
  databasePanel.hidden = true;
  settingsPanel.hidden = false;
  refreshDatabase();
  resizeToContent(settingsPanel);
});
toolsButton.addEventListener("click", async () => {
  note.hidden = true;
  settingsPanel.hidden = true;
  databasePanel.hidden = true;
  toolsPanel.hidden = false;
  monitorPanel.hidden = true;
  await refreshTools();
});
monitorButton.addEventListener("click", async () => {
  note.hidden = true;
  settingsPanel.hidden = true;
  databasePanel.hidden = true;
  toolsPanel.hidden = true;
  monitorPanel.hidden = false;
  startMonitorPolling();
});
backFromMonitor.addEventListener("click", () => {
  stopMonitorPolling();
  monitorPanel.hidden = true;
  note.hidden = false;
  resizeToContent(note);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopMonitorPolling();
  else if (!monitorPanel.hidden) startMonitorPolling();
});
backFromTools.addEventListener("click", () => {
  toolsPanel.hidden = true;
  note.hidden = false;
  resizeToContent(note);
});
listModeButton.addEventListener("click", switchListMode);
backToTodos.addEventListener("click", () => {
  settingsPanel.hidden = true;
  toolsPanel.hidden = true;
  note.hidden = false;
  resizeToContent(note);
});
openDatabase.addEventListener("click", async () => {
  note.hidden = true;
  settingsPanel.hidden = true;
  databasePanel.hidden = false;
  await refreshDatabase();
  resizeToContent(databasePanel);
});
backToSettings.addEventListener("click", () => {
  databasePanel.hidden = true;
  settingsPanel.hidden = false;
  resizeToContent(settingsPanel);
});
clearDatabase.addEventListener("click", async () => {
  await window.cpet?.clearCompletedTasks();
  refreshDatabase();
});

scaleRange.addEventListener("input", () => {
  const scale = Number(scaleRange.value);
  scaleValue.textContent = `${Math.round(scale * 100)}%`;
  saveSettings({ scale });
});
resetScale.addEventListener("click", () => {
  scaleRange.value = 0.2;
  scaleValue.textContent = "20%";
  saveSettings({ scale: 0.2 });
});
autoActionToggle.addEventListener("change", () => saveSettings({ autoActions: autoActionToggle.checked }));
alwaysOnTopToggle.addEventListener("change", () => {
  saveSettings({ alwaysOnTop: alwaysOnTopToggle.checked });
  window.cpet?.setAlwaysOnTop(alwaysOnTopToggle.checked);
});
launchAtLoginToggle.addEventListener("change", async () => {
  const enabled = await window.cpet?.setLaunchAtLogin(launchAtLoginToggle.checked);
  launchAtLoginToggle.checked = Boolean(enabled);
  saveSettings({ launchAtLogin: Boolean(enabled) });
});
shortcutButton.addEventListener("click", () => {
  recordingShortcut = true;
  shortcutButton.textContent = "Press keys…";
  shortcutStatus.textContent = "Press Esc to cancel";
  shortcutButton.focus();
});
shortcutButton.addEventListener("keydown", async (event) => {
  if (!recordingShortcut) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    recordingShortcut = false;
    shortcutButton.textContent = formatShortcut(settings.quickShortcut);
    shortcutStatus.textContent = "Click, then press a shortcut";
    return;
  }
  const shortcut = shortcutFromEvent(event);
  if (!shortcut) return;
  recordingShortcut = false;
  const result = await window.cpet?.setQuickShortcut(shortcut);
  if (result?.ok) {
    settings.quickShortcut = result.shortcut;
    saveSettings({ quickShortcut: result.shortcut });
    shortcutButton.textContent = formatShortcut(result.shortcut);
    shortcutStatus.textContent = "Shortcut updated";
  } else {
    shortcutButton.textContent = formatShortcut(settings.quickShortcut);
    shortcutStatus.textContent = "Unavailable — previous shortcut kept";
  }
});
resetPetPosition.addEventListener("click", () => window.cpet?.resetPetPosition());
quitApp.addEventListener("click", () => window.cpet?.quit());

showLinkForm.addEventListener("click", () => {
  linkForm.hidden = !linkForm.hidden;
  if (!linkForm.hidden) linkName.focus();
  resizeToContent(note);
});

linkForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const url = normalizeUrl(linkUrl.value);
  if (!url) {
    linkUrl.focus();
    linkUrl.select();
    return;
  }
  let name = linkName.value.trim();
  if (!name) name = new URL(url).hostname.replace(/^www\./, "");
  links.push({ id: createId(), name, url });
  localStorage.setItem(linksStorageKey, JSON.stringify(links));
  linkName.value = "";
  linkUrl.value = "";
  linkForm.hidden = true;
  renderLinks();
});

document.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveTodos();
  } else if (event.key === "Escape") {
    window.cpet?.hideNote();
  }
});

function isTextEntry(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

// Move C.pet with Shift + Arrows only while this C.pet window is focused.
// Editable fields keep the standard Shift + Arrow text-selection behavior.
document.addEventListener("keydown", (event) => {
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  const direction = petArrowDirections[event.code];
  if (!direction || isTextEntry(event.target)) return;
  event.preventDefault();
  window.cpet?.nudgePetByKey(direction[0], direction[1]);
});

undoComplete.addEventListener("click", async () => {
  if (!pendingUndo) return;
  const { record, task, listKey, index } = pendingUndo;
  clearTimeout(undoTimer);
  pendingUndo = null;
  undoToast.hidden = true;
  await window.cpet?.deleteCompletedTask(record.id);
  const mode = listModes.find((entry) => entry.key === listKey);
  if (listKey === activeListKey) {
    if (todos.length === 1 && !String(todos[0].text || "").trim()) todos.length = 0;
    todos.splice(Math.min(index, todos.length), 0, task);
    saveTodos();
    renderTodos(Math.min(index, todos.length - 1));
  } else if (mode) {
    const stored = loadJson(mode.storageKey, []);
    stored.splice(Math.min(index, stored.length), 0, task);
    localStorage.setItem(mode.storageKey, JSON.stringify(stored));
    resizeToContent(note);
  }
  refreshDatabase();
});

window.cpet?.onQuickEntry(focusQuickEntry);

window.cpet?.onSettingsChanged((patch) => {
  settings = { ...settings, ...patch };
  localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
  applySettings();
});

applyListMode();
renderActionGrid();
renderTodos();
renderLinks();
refreshDatabase();
applySettings();
window.cpet?.getVersion().then((version) => {
  appVersion.textContent = `v${String(version).replace(/\.0$/, "")}`;
});
window.setInterval(animateCat, 600);
window.cpet?.getSettings().then((stored) => {
  settings = { ...settings, ...stored };
  applySettings();
  saveSettings(settings);
});
window.cpet?.getLaunchAtLogin().then((enabled) => {
  settings.launchAtLogin = Boolean(enabled);
  launchAtLoginToggle.checked = settings.launchAtLogin;
  localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
});
