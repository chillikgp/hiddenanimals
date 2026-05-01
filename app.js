import { LEVELS } from "./game-data.js";

const sceneShell = document.querySelector("#scene-shell");
const sceneStage = document.querySelector("#scene-stage");
const inventoryGrid = document.querySelector("#inventory-grid");
const progressPill = document.querySelector("#progress-pill");
const winOverlay = document.querySelector("#win-overlay");
const resetButton = document.querySelector("#reset-button");
const playAgainButton = document.querySelector("#play-again-button");

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

// Pan & Zoom State
let panX = 0;
let panY = 0;
let scale = 1;
let isPanning = false;
let startX = 0;
let startY = 0;
let hasPanned = false;
const PAN_THRESHOLD = 5;
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

function loadLevel(index) {
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

  // Update scene stage dimensions
  sceneStage.style.width = `${levelData.scene.width}px`;
  sceneStage.style.height = `${levelData.scene.height}px`;

  // Reset pan/zoom on level load
  panX = 0;
  panY = 0;
  scale = 1;

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

function renderScene() {
  const levelData = LEVELS[currentLevelIndex];
  const animalMarkup = [...animals]
    .sort((first, second) => first.zIndex - second.zIndex)
    .map((animal) => createAnimalMarkup(animal))
    .join("");
  const coverMarkup = [...covers]
    .sort((first, second) => first.zIndex - second.zIndex)
    .map((cover) => createCoverMarkup(cover))
    .join("");

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
    inventoryTitle.textContent = `Find all ${animals.length} animals`;
  }

  inventoryGrid.innerHTML = animals
    .map((animal) => {
      const isFound = foundAnimalIds.has(animal.id);
      const inventoryImageSrc = animal.imageSrc
        .replace("_latest/", "_latest_for_inventory/")
        .replace("_gulmarg/", "_gulmarg_for_inventory/");
        
      return `
        <div class="inventory-item ${isFound ? "is-found" : ""}">
          <div class="inventory-icon-frame">
            <img
              class="inventory-icon"
              src="${inventoryImageSrc}"
              alt="${animal.name}"
              draggable="false"
            />
          </div>
          <div class="inventory-meta">
            <span class="inventory-check ${isFound ? "is-visible" : ""}" aria-hidden="true">✓</span>
          </div>
        </div>
      `;
    })
    .join("");
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

function updateStageScale() {
  const levelData = LEVELS[currentLevelIndex];
  const shellWidth = sceneShell.clientWidth;
  const shellHeight = sceneShell.clientHeight;
  
  // Calculate base scale to fit the scene
  const baseScale = Math.min(
    shellWidth / levelData.scene.width,
    shellHeight / levelData.scene.height
  );
  
  const currentScale = baseScale * scale;
  
  // Calculate initial offsets to center the scene
  const initialOffsetX = (shellWidth - levelData.scene.width * currentScale) / 2;
  const initialOffsetY = (shellHeight - levelData.scene.height * currentScale) / 2;

  sceneStage.style.transform = `translate(${initialOffsetX + panX}px, ${initialOffsetY + panY}px) scale(${currentScale})`;
}

// Interaction Listeners
sceneShell.addEventListener("wheel", (event) => {
  event.preventDefault();
  const zoomFactor = event.deltaY > 0 ? 0.95 : 1.05; // Slightly slower zoom
  const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * zoomFactor));
  
  if (newScale !== scale) {
    scale = newScale;
    updateStageScale();
  }
}, { passive: false });

sceneShell.addEventListener("pointerdown", (event) => {
  // Only pan with primary button
  if (event.button !== 0) return;
  
  isPanning = true;
  startX = event.clientX - panX;
  startY = event.clientY - panY;
  hasPanned = false;
});

window.addEventListener("pointermove", (event) => {
  if (!isPanning) return;
  
  const dx = event.clientX - startX;
  const dy = event.clientY - startY;
  
  if (!hasPanned && (Math.abs(dx - panX) > PAN_THRESHOLD || Math.abs(dy - panY) > PAN_THRESHOLD)) {
    hasPanned = true;
  }
  
  panX = dx;
  panY = dy;
  updateStageScale();
});

window.addEventListener("pointerup", (event) => {
  if (!isPanning) return;
  isPanning = false;
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

const resizeObserver = new ResizeObserver(() => {
  updateStageScale();
});

// Initial load from URL
const params = new URLSearchParams(window.location.search);
const levelParam = parseInt(params.get("level"), 10);
const initialLevel = !isNaN(levelParam) && levelParam > 0 && levelParam <= LEVELS.length 
  ? levelParam - 1 
  : 0;

loadLevel(initialLevel);
