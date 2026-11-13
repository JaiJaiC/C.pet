const pet = document.querySelector("#pet");
const petImage = document.querySelector("#petImage");
const petStyle = document.querySelector("#petStyle");
const settingsStorageKey = "cpet.settings.v3";

const actions = [
  ["scratch", "assets/pet-scratch.png"],
  ["head", "assets/pet-head.png"],
  ["akimbo", "assets/pet-akimbo.png"],
  ["thumb", "assets/pet-thumb.png"],
  ["wave", "assets/pet-wave.png"],
  ["stretch", "assets/pet-stretch.png"],
  ["yawn", "assets/pet-yawn.png"],
  ["think", "assets/pet-think.png"],
  ["clap", "assets/pet-clap.png"],
  ["point", "assets/pet-point.png"],
  ["bow", "assets/pet-bow.png"],
  ["cheer", "assets/pet-cheer.png"],
  ["giggle", "assets/pet-giggle.png"],
  ["drowsy", "assets/pet-drowsy.png"],
  ["salute", "assets/pet-salute.png"],
];

let settings = {
  scale: 1,
  autoActions: true,
  alwaysOnTop: true,
  effect: "none",
  ...loadJson(settingsStorageKey, {}),
};
let currentAction = "idle";
let actionTimer = 0;
let pendingDrag = null;
let dragging = false;
let suppressClick = false;
let mouseIgnored = false;

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

function saveSettings() {
  localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function applyScale(value, broadcast = false) {
  settings.scale = clamp(Number(value), 0.2, 1.35);
  document.documentElement.style.setProperty("--pet-scale", settings.scale.toFixed(2));
  saveSettings();
  if (broadcast) window.cpet?.broadcastSettings({ scale: settings.scale });
  window.requestAnimationFrame(() => window.cpet?.setPetBounds(getPetVisualBounds()));
}

function setSprite(action) {
  currentAction = action;
  pet.classList.toggle("is-idle", action === "idle");
  pet.classList.toggle("is-action", action !== "idle");
  pet.style.setProperty("--look", "0deg");
  pet.style.setProperty("--face", "1");
  petImage.src = actions.find(([key]) => key === action)?.[1] || "assets/pet.png";
}

function applyEffect(patch = {}) {
  settings = { ...settings, ...patch };
  const effect = ["none", "sparkles", "glow", "hearts", "fireflies", "rainbow", "rain", "snow", "sunshine"].includes(settings.effect) ? settings.effect : "none";
  settings.effect = effect;
  petStyle.className = `pet-style effect-${effect}`;
  saveSettings();
}

function performAction(action) {
  if (action === "idle" || actions.some(([key]) => key === action)) {
    setSprite(action);
    restartActionTimer();
  }
}

function randomAction() {
  if (!settings.autoActions || pendingDrag || dragging) return;
  const choices = actions.filter(([key]) => key !== currentAction);
  setSprite(choices[Math.floor(Math.random() * choices.length)][0]);
}

function restartActionTimer() {
  window.clearInterval(actionTimer);
  if (settings.autoActions) actionTimer = window.setInterval(randomAction, 30000);
}

async function setMouseIgnored(ignore) {
  if (mouseIgnored === ignore) return;
  mouseIgnored = ignore;
  await window.cpet?.setIgnoreMouse(ignore);
}

function updateMousePassThrough(event) {
  if (dragging) return setMouseIgnored(false);
  const rect = pet.getBoundingClientRect();
  const inside = event.clientX >= rect.left && event.clientX <= rect.right
    && event.clientY >= rect.top && event.clientY <= rect.bottom;
  setMouseIgnored(!inside);
}

function prepareDrag(event) {
  if (event.button !== 0) return;
  window.clearInterval(actionTimer);
  actionTimer = 0;
  pet.classList.add("is-dragging");
  pendingDrag = {
    pointerId: event.pointerId,
    x: event.screenX,
    y: event.screenY,
    lastScreenX: event.screenX,
    lastScreenY: event.screenY,
  };
  setMouseIgnored(false);
  pet.setPointerCapture(event.pointerId);
}

function getPetVisualBounds() {
  const imageRect = petImage.getBoundingClientRect();
  const styleRect = petStyle.getBoundingClientRect();
  return {
    left: Math.max(0, Math.min(imageRect.left, styleRect.left)),
    top: Math.max(0, Math.min(imageRect.top, styleRect.top)),
    right: Math.min(window.innerWidth, Math.max(imageRect.right, styleRect.right)),
    bottom: Math.min(window.innerHeight, Math.max(imageRect.bottom, styleRect.bottom)),
  };
}

function moveDrag(event) {
  if (!pendingDrag || event.pointerId !== pendingDrag.pointerId) return;
  if ((event.buttons & 1) === 0) {
    stopDrag(event);
    return;
  }
  if (!dragging && Math.hypot(event.screenX - pendingDrag.x, event.screenY - pendingDrag.y) >= 5) {
    dragging = true;
    suppressClick = true;
    window.cpet?.startWindowDrag({
      visualBounds: getPetVisualBounds(),
    });
    pendingDrag.lastScreenX = event.screenX;
    pendingDrag.lastScreenY = event.screenY;
    return;
  }
  if (dragging && (event.screenX !== pendingDrag.lastScreenX || event.screenY !== pendingDrag.lastScreenY)) {
    pendingDrag.lastScreenX = event.screenX;
    pendingDrag.lastScreenY = event.screenY;
    window.cpet?.updateWindowDrag();
  }
}

function stopDrag(event) {
  if (!pendingDrag && !dragging) return;
  if (dragging) window.cpet?.stopWindowDrag();
  dragging = false;
  pendingDrag = null;
  pet.classList.remove("is-dragging");
  restartActionTimer();
  if (event?.pointerId !== undefined && pet.hasPointerCapture(event.pointerId)) pet.releasePointerCapture(event.pointerId);
  window.setTimeout(() => {
    suppressClick = false;
  }, 220);
}

pet.addEventListener("pointerdown", prepareDrag);
pet.addEventListener("pointermove", moveDrag);
pet.addEventListener("pointerup", stopDrag);
pet.addEventListener("pointercancel", stopDrag);
pet.addEventListener("lostpointercapture", stopDrag);
pet.addEventListener("contextmenu", (event) => event.preventDefault());
window.addEventListener("pointerup", stopDrag, true);
window.addEventListener("blur", stopDrag);
document.addEventListener("mousemove", updateMousePassThrough);

window.addEventListener("keydown", (event) => {
  // Keyboard handling is intentionally local: it only fires when this C.pet
  // window is focused, so Shift + Arrows keep their normal text-selection
  // meaning in every other application.
  if (!event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || dragging) return;
  const directions = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const direction = directions[event.code];
  if (!direction) return;
  event.preventDefault();
  const step = 4;
  window.cpet?.nudgePet({
    x: direction[0] * step,
    y: direction[1] * step,
    visualBounds: getPetVisualBounds(),
  });
});

pet.addEventListener("click", () => {
  if (!dragging && !suppressClick) window.cpet?.toggleNote();
});

pet.addEventListener("wheel", (event) => {
  event.preventDefault();
  applyScale(settings.scale + (event.deltaY < 0 ? 0.03 : -0.03), true);
  updateMousePassThrough(event);
});

window.cpet?.onSettingsChanged((patch) => {
  settings = { ...settings, ...patch };
  if (patch.scale !== undefined) applyScale(patch.scale);
  if (patch.autoActions !== undefined) {
    if (!settings.autoActions) setSprite("idle");
    else randomAction();
    restartActionTimer();
  }
  if (patch.effect !== undefined) applyEffect(patch);
});

window.cpet?.onActionRequested(performAction);

applyScale(settings.scale);
setSprite("idle");
applyEffect(settings);
restartActionTimer();
window.cpet?.getSettings().then((stored) => {
  settings = { ...settings, ...stored };
  applyScale(settings.scale);
  window.cpet?.setAlwaysOnTop(settings.alwaysOnTop);
  if (!settings.autoActions) setSprite("idle");
  applyEffect(settings);
  restartActionTimer();
});
