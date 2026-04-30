import { GAME_DATA } from "./game-data.js";

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
const foundAnimalIds = new Set();
const activeHighlightIds = new Set();
const highlightTimeouts = new Map();
const highlightStartedAt = new Map();
const animals = GAME_DATA.animals.map((animal, index) => ({
  ...animal,
  motionDuration: `${(2.15 + (index % 5) * 0.38).toFixed(2)}s`,
  motionDelay: `${(-0.35 - index * 0.31).toFixed(2)}s`,
}));
const covers = GAME_DATA.covers.map((cover) => ({ ...cover }));

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
  const motionClass =
    animal.movementAxis === "y" ? "animal-motion is-vertical" : "animal-motion is-horizontal";
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

  return `
    <button
      class="cover-button ${isOpen ? "is-open" : ""}"
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
      src="${GAME_DATA.scene.backgroundSrc}"
      alt="Dense jungle background for the hidden animal playtest"
    />
    ${animalMarkup}
    ${coverMarkup}
  `;
}

function renderInventory() {
  inventoryGrid.innerHTML = animals
    .map((animal) => {
      const isFound = foundAnimalIds.has(animal.id);
      return `
        <div class="inventory-item ${isFound ? "is-found" : ""}">
          <div class="inventory-icon-frame">
            <img
              class="inventory-icon"
              src="${animal.imageSrc}"
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
  coverButton.classList.toggle("is-open", isOpen);
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
  const shellWidth = sceneShell.clientWidth;
  const shellHeight = sceneShell.clientHeight;
  const scale = Math.min(
    shellWidth / GAME_DATA.scene.width,
    shellHeight / GAME_DATA.scene.height
  );
  const renderedWidth = GAME_DATA.scene.width * scale;
  const renderedHeight = GAME_DATA.scene.height * scale;
  const offsetX = (shellWidth - renderedWidth) / 2;
  const offsetY = (shellHeight - renderedHeight) / 2;

  sceneStage.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
}

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
  foundAnimalIds.clear();
  activeHighlightIds.clear();
  clearHighlightTimers();
  highlightStartedAt.clear();
  clearCoverTimers();

  animals.forEach((animal) => {
    animal.found = false;
  });

  covers.forEach((cover) => {
    cover.state = "closed";
    cover.openTimer = null;
  });

  render();
}

sceneStage.addEventListener("click", (event) => {
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
playAgainButton.addEventListener("click", resetGame);

const resizeObserver = new ResizeObserver(() => {
  updateStageScale();
});

resizeObserver.observe(sceneShell);

render();
updateStageScale();
