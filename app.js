import { LEVELS } from "./game-data.js";

const sceneShell = document.querySelector("#scene-shell");
const sceneStage = document.querySelector("#scene-stage");
const scenePanIndicator = document.querySelector("#scene-pan-indicator");
const scenePanThumb = document.querySelector("#scene-pan-thumb");
const inventoryGrid = document.querySelector("#inventory-grid");
const progressPill = document.querySelector("#progress-pill");
const winOverlay = document.querySelector("#win-overlay");
const resetButton = document.querySelector("#reset-button");
const playAgainButton = document.querySelector("#play-again-button");
const inventoryPreview = document.querySelector("#inventory-preview");
const inventoryPreviewImage = document.querySelector("#inventory-preview-image");
const inventoryPreviewClose = document.querySelector("#inventory-preview-close");

const HIT_PADDING = 40;
const HIGHLIGHT_DURATION_MS = 2500;
const COVER_OPEN_DURATION_MS = 5000;

let currentLevelIndex = 0;
let animals = [];
let covers = [];
const foundAnimalIds = new Set();
const activeHighlightIds = new Set();
const highlightTimeouts = new Map();
const highlightStartedAt = new Map();
let loadLevelRequestId = 0;

// Pan & Zoom State
let panX = 0;
let panY = 0;
let scale = 1;
let isPanning = false;
let startX = 0;
let startY = 0;
let hasPanned = false;
const activePointers = new Map();
let initialPinchDistance = 0;
let initialPinchScale = 1;
let lastTapTime = 0;
let isDraggingPanIndicator = false;
const PAN_THRESHOLD = 15;
const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_DELAY = 300;

function getInventoryImageSrc(animal) {
  return animal.imageSrc
    .replace("_latest/", "_latest_for_inventory/")
    .replace("_gulmarg/", "_gulmarg_for_inventory/");
}

function getBaseScale() {
  const levelData = LEVELS[currentLevelIndex];
  return sceneShell.clientHeight / levelData.scene.height;
}

function preloadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = src;
  });
}

async function preloadImagesSequentially(sources) {
  for (const src of sources) {
    await preloadImage(src);
  }
}

function resetViewForLevel(levelData) {
  sceneStage.style.width = `${levelData.scene.width}px`;
  sceneStage.style.height = `${levelData.scene.height}px`;

  scale = 1;
  const baseScale = getBaseScale();
  const currentScale = baseScale * scale;
  panX = (sceneShell.clientWidth - levelData.scene.width * currentScale) / 2;
  panY = 0;
}

async function loadLevel(index) {
  const requestId = ++loadLevelRequestId;
  currentLevelIndex = index;
  const levelData = LEVELS[currentLevelIndex];
  
  // Update URL without reloading
  const url = new URL(window.location);
  url.searchParams.set("level", currentLevelIndex + 1);
  window.history.replaceState({}, "", url);

  foundAnimalIds.clear();
  activeHighlightIds.clear();
  clearHighlightTimers();
  highlightStartedAt.clear();
  clearCoverTimers();
  closeInventoryPreview();

  resetViewForLevel(levelData);

  animals = levelData.animals.map((animal, idx) => ({
    ...animal,
    motionDuration: `${(2.15 + (idx % 5) * 0.38).toFixed(2)}s`,
    motionDelay: `${(-0.35 - idx * 0.31).toFixed(2)}s`,
  }));
  
  covers = levelData.covers.map((cover) => ({ 
    ...cover,
    state: "closed",
    openTimer: null
  }));

  sceneStage.innerHTML = "";
  inventoryGrid.innerHTML = "";
  renderProgress();
  renderWinState();
  updateStageScale();

  await preloadImage(levelData.scene.backgroundSrc);
  if (requestId !== loadLevelRequestId) {
    return;
  }
  renderScene({ includeCovers: false, includeAnimals: false });

  await preloadImagesSequentially(covers.map((cover) => cover.imageSrc));
  if (requestId !== loadLevelRequestId) {
    return;
  }
  renderScene({ includeCovers: true, includeAnimals: false });

  await preloadImagesSequentially([
    ...animals.map((animal) => animal.imageSrc),
    ...animals.map((animal) => getInventoryImageSrc(animal)),
  ]);
  if (requestId !== loadLevelRequestId) {
    return;
  }

  render();
  updateStageScale();
}


function clearHighlightTimers() {
  highlightTimeouts.forEach((timeoutId) => {
    window.clearTimeout(timeoutId);
  });
  highlightTimeouts.clear();
}

function clearCoverTimers() {
  covers.forEach((cover) => {
    if (cover.openTimer) {
      window.clearTimeout(cover.openTimer);
      cover.openTimer = null;
    }
  });
}

function getCoverById(coverId) {
  return covers.find((cover) => cover.id === coverId) ?? null;
}

function isCoverOpen(coverId) {
  if (!coverId) {
    return true;
  }

  return getCoverById(coverId)?.state === "open";
}

function isAnimalInteractable(animal) {
  if (foundAnimalIds.has(animal.id)) {
    return false;
  }

  if (!animal.coverId) {
    return true;
  }

  return isCoverOpen(animal.coverId);
}

function createAnimalMarkup(animal) {
  const isFound = foundAnimalIds.has(animal.id);
  const isInteractable = isAnimalInteractable(animal);
  const hasActiveHighlight = activeHighlightIds.has(animal.id);
  const highlightAge = Date.now() - (highlightStartedAt.get(animal.id) ?? 0);
  const shouldAnimateFoundState = hasActiveHighlight && highlightAge < 450;
  const highlightSize = Math.round(Math.max(animal.width, animal.height) * 1.5);
  let motionClass = "animal-motion";
  if (animal.movementAxis === "y") {
    motionClass += " is-vertical";
  } else if (animal.movementAxis === "x") {
    motionClass += " is-horizontal";
  }
  const isCoveredClosed = !isFound && animal.coverId && !isCoverOpen(animal.coverId);

  return `
    <button
      class="animal-button ${isFound ? "is-found" : ""} ${isCoveredClosed ? "is-covered" : ""}"
      type="button"
      data-animal-id="${animal.id}"
      aria-label="Find ${animal.name}"
      aria-hidden="${isCoveredClosed ? "true" : "false"}"
      ${isInteractable ? "" : "disabled"}
      style="
        left: ${animal.x - HIT_PADDING}px;
        top: ${animal.y - HIT_PADDING}px;
        width: ${animal.width + HIT_PADDING * 2}px;
        height: ${animal.height + HIT_PADDING * 2}px;
        z-index: ${animal.zIndex};
      "
    >
      <span
        class="${motionClass}"
        style="
          left: ${HIT_PADDING}px;
          top: ${HIT_PADDING}px;
          width: ${animal.width}px;
          height: ${animal.height}px;
          --idle-duration: ${animal.motionDuration};
          --idle-delay: ${animal.motionDelay};
        "
      >
        ${
          hasActiveHighlight
            ? `<span
                class="animal-highlight ${shouldAnimateFoundState ? "is-fresh" : ""}"
                style="
                  width: ${highlightSize}px;
                  height: ${highlightSize}px;
                "
              ></span>`
            : ""
        }
        <img
          class="animal-sprite ${shouldAnimateFoundState ? "is-celebrating" : ""}"
          src="${animal.imageSrc}"
          alt=""
          draggable="false"
        />
      </span>
    </button>
  `;
}

function createCoverMarkup(cover) {
  const isOpen = cover.state === "open";
  const useDisappear = currentLevelIndex === 1;
  const openClass = isOpen ? (useDisappear ? "is-open-disappeared" : "is-open") : "";

  return `
    <button
      class="cover-button ${openClass}"
      type="button"
      data-cover-id="${cover.id}"
      aria-label="Lift ${cover.name}"
      aria-pressed="${isOpen ? "true" : "false"}"
      style="
        left: ${cover.x}px;
        top: ${cover.y}px;
        width: ${cover.width}px;
        height: ${cover.height}px;
        z-index: ${cover.zIndex};
        --cover-lift: ${cover.height}px;
      "
    >
      <img class="cover-sprite" src="${cover.imageSrc}" alt="" draggable="false" />
    </button>
  `;
}

function renderScene({ includeCovers = true, includeAnimals = true } = {}) {
  const levelData = LEVELS[currentLevelIndex];
  const animalMarkup = includeAnimals
    ? [...animals]
        .sort((first, second) => first.zIndex - second.zIndex)
        .map((animal) => createAnimalMarkup(animal))
        .join("")
    : "";
  const coverMarkup = includeCovers
    ? [...covers]
        .sort((first, second) => first.zIndex - second.zIndex)
        .map((cover) => createCoverMarkup(cover))
        .join("")
    : "";

  sceneStage.innerHTML = `
    <img
      class="scene-background"
      src="${levelData.scene.backgroundSrc}"
      alt="Background for the hidden animal playtest"
    />
    ${animalMarkup}
    ${coverMarkup}
  `;
}

function renderInventory() {
  const inventoryTitle = document.querySelector(".inventory-title");
  if (inventoryTitle) {
    inventoryTitle.textContent = `Find ${animals.length} hidden animals`;
  }

  inventoryGrid.innerHTML = animals
    .map((animal) => {
      const isFound = foundAnimalIds.has(animal.id);
      const inventoryImageSrc = getInventoryImageSrc(animal);
        
      return `
        <button class="inventory-item ${isFound ? "is-found" : ""}" type="button" data-inventory-animal-id="${animal.id}" aria-label="Preview ${animal.name}">
          <span class="inventory-icon-frame">
            <img
              class="inventory-icon"
              src="${inventoryImageSrc}"
              alt="${animal.name}"
              draggable="false"
            />
          </span>
          <span class="inventory-meta">
            <span class="inventory-check ${isFound ? "is-visible" : ""}" aria-hidden="true">✓</span>
          </span>
        </button>
      `;
    })
    .join("");
}

function openInventoryPreview(animalId) {
  const animal = animals.find((entry) => entry.id === animalId);
  if (!animal) {
    return;
  }

  inventoryPreviewImage.src = getInventoryImageSrc(animal);
  inventoryPreviewImage.alt = animal.name;
  inventoryPreview.classList.remove("hidden");
  inventoryPreview.setAttribute("aria-hidden", "false");
  inventoryPreviewClose.focus();
}

function closeInventoryPreview() {
  inventoryPreview.classList.add("hidden");
  inventoryPreview.setAttribute("aria-hidden", "true");
  inventoryPreviewImage.removeAttribute("src");
  inventoryPreviewImage.alt = "";
}

function renderProgress() {
  progressPill.textContent = `${foundAnimalIds.size} / ${animals.length} Found`;
}

function renderWinState() {
  const hasWon = foundAnimalIds.size === animals.length;
  winOverlay.classList.toggle("hidden", !hasWon);
  winOverlay.setAttribute("aria-hidden", String(!hasWon));
  document.body.classList.toggle("is-win", hasWon);

  if (hasWon) {
    const hasNextLevel = currentLevelIndex < LEVELS.length - 1;
    const title = winOverlay.querySelector("h1");
    const text = winOverlay.querySelector("p");
    
    if (hasNextLevel) {
      title.textContent = `Level ${currentLevelIndex + 1} Complete!`;
      text.textContent = `Excellent job! You've found all the animals. Ready for the next challenge?`;
      playAgainButton.textContent = "Continue to Level " + (currentLevelIndex + 2);
    } else {
      title.textContent = "Game Complete!";
      text.textContent = "You've uncovered every hidden creature in every level. Amazing work! Tap below to start over.";
      playAgainButton.textContent = "Play Again from Level 1";
    }
  }
}

function render() {
  renderScene();
  renderInventory();
  renderProgress();
  renderWinState();
}

function syncCoverDomState(coverId) {
  const cover = getCoverById(coverId);
  const coverButton = sceneStage.querySelector(`[data-cover-id="${coverId}"]`);
  if (!cover || !coverButton) {
    return;
  }

  const isOpen = cover.state === "open";
  const useDisappear = currentLevelIndex === 1;

  if (useDisappear) {
    coverButton.classList.toggle("is-open-disappeared", isOpen);
  } else {
    coverButton.classList.toggle("is-open", isOpen);
  }
  
  coverButton.setAttribute("aria-pressed", String(isOpen));
}

function syncCoveredAnimalsForCover(coverId) {
  animals
    .filter((animal) => animal.coverId === coverId)
    .forEach((animal) => {
      const animalButton = sceneStage.querySelector(`[data-animal-id="${animal.id}"]`);
      if (!animalButton) {
        return;
      }

      const isBlocked = !foundAnimalIds.has(animal.id) && !isCoverOpen(coverId);
      animalButton.disabled = !isAnimalInteractable(animal);
      animalButton.classList.toggle("is-covered", isBlocked);
      animalButton.setAttribute("aria-hidden", String(isBlocked));
    });
}

function clampViewState() {
  const levelData = LEVELS[currentLevelIndex];
  const shellWidth = sceneShell.clientWidth;
  const shellHeight = sceneShell.clientHeight;
  
  const baseScale = getBaseScale();
  
  scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
  const currentScale = baseScale * scale;
  
  const stageWidth = levelData.scene.width * currentScale;
  const stageHeight = levelData.scene.height * currentScale;
  
  const minPanX = Math.min(0, shellWidth - stageWidth);
  const maxPanX = Math.max(0, shellWidth - stageWidth);
  const minPanY = Math.min(0, shellHeight - stageHeight);
  const maxPanY = Math.max(0, shellHeight - stageHeight);

  // If stage is smaller than shell, we want to center it, not just clamp to 0.
  // Actually, the user's min/max logic:
  // minPanX = min(0, viewportWidth - scaledWidth)
  // maxPanX = 0
  // This works if we want it anchored to top-left when larger.
  // But let's follow the centering intent if smaller:
  
  if (stageWidth > shellWidth) {
    panX = Math.min(0, Math.max(shellWidth - stageWidth, panX));
  } else {
    panX = (shellWidth - stageWidth) / 2;
  }
  
  if (stageHeight > shellHeight) {
    panY = Math.min(0, Math.max(shellHeight - stageHeight, panY));
  } else {
    panY = (shellHeight - stageHeight) / 2;
  }
}

function getHorizontalPanMetrics() {
  const levelData = LEVELS[currentLevelIndex];
  const shellWidth = sceneShell.clientWidth;
  const baseScale = getBaseScale();
  const currentScale = baseScale * scale;
  const stageWidth = levelData.scene.width * currentScale;

  return {
    shellWidth,
    stageWidth,
    overflow: Math.max(0, stageWidth - shellWidth),
  };
}

function updatePanIndicator() {
  const { shellWidth, stageWidth, overflow } = getHorizontalPanMetrics();
  const canPanHorizontally = overflow > 1;

  scenePanIndicator.classList.toggle("is-visible", canPanHorizontally);
  scenePanIndicator.setAttribute("aria-hidden", String(!canPanHorizontally));

  if (!canPanHorizontally) {
    scenePanIndicator.setAttribute("aria-valuenow", "0");
    scenePanThumb.style.width = "100%";
    scenePanThumb.style.transform = "translateX(0)";
    return;
  }

  const railWidth = scenePanIndicator.clientWidth;
  const thumbWidth = Math.max(42, Math.min(railWidth, (shellWidth / stageWidth) * railWidth));
  const travelWidth = Math.max(1, railWidth - thumbWidth);
  const progress = Math.min(1, Math.max(0, -panX / overflow));

  scenePanIndicator.setAttribute("aria-valuenow", String(Math.round(progress * 100)));
  scenePanThumb.style.width = `${thumbWidth}px`;
  scenePanThumb.style.transform = `translateX(${progress * travelWidth}px)`;
}

function setHorizontalPanFromIndicator(clientX) {
  const { overflow } = getHorizontalPanMetrics();
  if (overflow <= 1) {
    return;
  }

  const railRect = scenePanIndicator.getBoundingClientRect();
  const thumbWidth = scenePanThumb.getBoundingClientRect().width;
  const travelWidth = Math.max(1, railRect.width - thumbWidth);
  const progress = Math.min(
    1,
    Math.max(0, (clientX - railRect.left - thumbWidth / 2) / travelWidth)
  );

  panX = -progress * overflow;
  updateStageScale();
}

function updateStageScale() {
  clampViewState();
  const baseScale = getBaseScale();
  const currentScale = baseScale * scale;
  sceneStage.style.transform = `translate(${panX}px, ${panY}px) scale(${currentScale})`;
  updatePanIndicator();
}

function handleZoom(delta, focalX, focalY) {
  // Exponential scaling for smoother feel
  const zoomFactor = 1 - delta * 0.001;
  const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * zoomFactor));
  
  if (newScale !== scale) {
    const scaleRatio = newScale / scale;
    
    // Expert focal point math:
    // focalX/Y are screen coordinates
    panX = focalX - (focalX - panX) * scaleRatio;
    panY = focalY - (focalY - panY) * scaleRatio;
    
    scale = newScale;
    updateStageScale();
  }
}

// Interaction Listeners
sceneShell.addEventListener("wheel", (event) => {
  event.preventDefault();
  const rect = sceneShell.getBoundingClientRect();
  const focalX = event.clientX - rect.left;
  const focalY = event.clientY - rect.top;
  handleZoom(event.deltaY, focalX, focalY);
}, { passive: false });

scenePanIndicator.addEventListener("pointerdown", (event) => {
  if (!scenePanIndicator.classList.contains("is-visible")) {
    return;
  }

  event.preventDefault();
  isDraggingPanIndicator = true;
  scenePanIndicator.setPointerCapture(event.pointerId);
  setHorizontalPanFromIndicator(event.clientX);
});

scenePanIndicator.addEventListener("pointermove", (event) => {
  if (!isDraggingPanIndicator) {
    return;
  }

  event.preventDefault();
  setHorizontalPanFromIndicator(event.clientX);
});

scenePanIndicator.addEventListener("pointerup", (event) => {
  isDraggingPanIndicator = false;
  scenePanIndicator.releasePointerCapture(event.pointerId);
});

scenePanIndicator.addEventListener("pointercancel", () => {
  isDraggingPanIndicator = false;
});

scenePanIndicator.addEventListener("keydown", (event) => {
  const { overflow } = getHorizontalPanMetrics();
  if (overflow <= 1) {
    return;
  }

  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    const direction = event.key === "ArrowLeft" ? 1 : -1;
    panX += direction * Math.max(24, sceneShell.clientWidth * 0.12);
    updateStageScale();
  }
});

sceneShell.addEventListener("pointerdown", (event) => {
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  
  if (activePointers.size === 1) {
    isPanning = true;
    startX = event.clientX - panX;
    startY = event.clientY - panY;
    hasPanned = false;
    
    // Double tap detection
    const now = Date.now();
    if (now - lastTapTime < DOUBLE_TAP_DELAY) {
      handleDoubleTap(event);
      lastTapTime = 0;
    } else {
      lastTapTime = now;
    }
  } else if (activePointers.size === 2) {
    isPanning = false;
    const pointers = Array.from(activePointers.values());
    initialPinchDistance = Math.hypot(
      pointers[0].x - pointers[1].x,
      pointers[0].y - pointers[1].y
    );
    initialPinchScale = scale;
  }
});

function handleDoubleTap(event) {
  const rect = sceneShell.getBoundingClientRect();
  const focalX = event.clientX - rect.left;
  const focalY = event.clientY - rect.top;
  
  const targetScale = scale > 1.5 ? 1 : 2.5;
  const scaleRatio = targetScale / scale;
  
  panX = focalX - (focalX - panX) * scaleRatio;
  panY = focalY - (focalY - panY) * scaleRatio;
  
  scale = targetScale;
  updateStageScale();
  hasPanned = true; 
}

window.addEventListener("pointermove", (event) => {
  if (!activePointers.has(event.pointerId)) return;
  activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

  if (activePointers.size === 1 && isPanning) {
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    
    if (!hasPanned && (Math.abs(dx - panX) > PAN_THRESHOLD || Math.abs(dy - panY) > PAN_THRESHOLD)) {
      hasPanned = true;
    }
    
    panX = dx;
    panY = dy;
    updateStageScale();
  } else if (activePointers.size === 2) {
    const pointers = Array.from(activePointers.values());
    const currentDistance = Math.hypot(
      pointers[0].x - pointers[1].x,
      pointers[0].y - pointers[1].y
    );
    
    const focalX = (pointers[0].x + pointers[1].x) / 2 - sceneShell.getBoundingClientRect().left;
    const focalY = (pointers[0].y + pointers[1].y) / 2 - sceneShell.getBoundingClientRect().top;

    if (initialPinchDistance > 0) {
      const pinchScale = currentDistance / initialPinchDistance;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, initialPinchScale * pinchScale));
      
      if (newScale !== scale) {
        const scaleRatio = newScale / scale;
        panX = focalX - (focalX - panX) * scaleRatio;
        panY = focalY - (focalY - panY) * scaleRatio;
        scale = newScale;
        updateStageScale();
      }
    }
  }
});

window.addEventListener("pointerup", (event) => {
  activePointers.delete(event.pointerId);
  
  if (activePointers.size < 2) {
    initialPinchDistance = 0;
  }
  
  if (activePointers.size === 0) {
    isPanning = false;
  } else if (activePointers.size === 1) {
    // Resume panning with the remaining pointer
    const remaining = activePointers.values().next().value;
    startX = remaining.x - panX;
    startY = remaining.y - panY;
    isPanning = true;
  }
});

window.addEventListener("pointercancel", (event) => {
  activePointers.delete(event.pointerId);
  if (activePointers.size === 0) {
    isPanning = false;
  }
});

function removeHighlight(animalId) {
  if (!activeHighlightIds.has(animalId)) {
    return;
  }

  activeHighlightIds.delete(animalId);
  highlightTimeouts.delete(animalId);
  highlightStartedAt.delete(animalId);
  render();
}

function scheduleHighlightRemoval(animalId) {
  const existingTimeout = highlightTimeouts.get(animalId);
  if (existingTimeout) {
    window.clearTimeout(existingTimeout);
  }

  const timeoutId = window.setTimeout(() => {
    removeHighlight(animalId);
  }, HIGHLIGHT_DURATION_MS);

  highlightTimeouts.set(animalId, timeoutId);
}

function closeCover(coverId) {
  const cover = getCoverById(coverId);
  if (!cover) {
    return;
  }

  if (cover.openTimer) {
    window.clearTimeout(cover.openTimer);
    cover.openTimer = null;
  }

  if (cover.state !== "closed") {
    cover.state = "closed";
    syncCoverDomState(coverId);
    syncCoveredAnimalsForCover(coverId);
  }
}

function scheduleCoverClose(cover) {
  if (cover.openTimer) {
    window.clearTimeout(cover.openTimer);
  }

  cover.openTimer = window.setTimeout(() => {
    closeCover(cover.id);
  }, COVER_OPEN_DURATION_MS);
}

function openCover(coverId) {
  const cover = getCoverById(coverId);
  if (!cover) {
    return;
  }

  const shouldRender = cover.state !== "open";
  cover.state = "open";
  scheduleCoverClose(cover);

  if (shouldRender) {
    syncCoverDomState(coverId);
    syncCoveredAnimalsForCover(coverId);
  }
}

function markAnimalFound(animalId) {
  if (foundAnimalIds.has(animalId)) {
    return;
  }

  foundAnimalIds.add(animalId);
  activeHighlightIds.add(animalId);
  highlightStartedAt.set(animalId, Date.now());

  const animal = animals.find((entry) => entry.id === animalId);
  if (animal) {
    animal.found = true;
  }

  render();
  scheduleHighlightRemoval(animalId);
}

function resetGame() {
  loadLevel(currentLevelIndex);
}

function handleNextLevel() {
  const nextIndex = (currentLevelIndex + 1) % LEVELS.length;
  loadLevel(nextIndex);
}

sceneStage.addEventListener("click", (event) => {
  // Prevent clicks if we were panning
  if (hasPanned) {
    return;
  }

  const coverButton = event.target.closest("[data-cover-id]");
  if (coverButton) {
    openCover(coverButton.dataset.coverId);
    return;
  }

  const animalButton = event.target.closest("[data-animal-id]");
  if (!animalButton || animalButton.disabled) {
    return;
  }

  markAnimalFound(animalButton.dataset.animalId);
});

resetButton.addEventListener("click", resetGame);
playAgainButton.addEventListener("click", handleNextLevel);
inventoryGrid.addEventListener("click", (event) => {
  const inventoryItem = event.target.closest("[data-inventory-animal-id]");
  if (!inventoryItem) {
    return;
  }

  openInventoryPreview(inventoryItem.dataset.inventoryAnimalId);
});
inventoryPreviewClose.addEventListener("click", closeInventoryPreview);
inventoryPreview.addEventListener("click", (event) => {
  if (event.target === inventoryPreview) {
    closeInventoryPreview();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !inventoryPreview.classList.contains("hidden")) {
    closeInventoryPreview();
  }
});

const resizeObserver = new ResizeObserver(() => {
  updateStageScale();
});
resizeObserver.observe(sceneShell);

// Initial load from URL
// Wait for layout to settle before initial load
window.addEventListener("DOMContentLoaded", () => {
  requestAnimationFrame(() => {
    const levelFromUrl = parseInt(new URLSearchParams(window.location.search).get("level"), 10);
    const initialLevel = !isNaN(levelFromUrl) && levelFromUrl > 0 && levelFromUrl <= LEVELS.length
      ? levelFromUrl - 1
      : 0;
    
    loadLevel(initialLevel);
  });
});
