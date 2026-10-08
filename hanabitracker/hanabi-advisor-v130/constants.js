export const BASE_COLORS = ["Gia", "Ros", "Blu", "Ver", "Bia"];
export const RAINBOW_COLOR = "Arc";

// Mutable arrays on purpose: all strategy modules keep the same live references.
// configureVariant() mutates them before a game is created.
export const COLORS = [...BASE_COLORS];
export const COLOR_CLUES = [...BASE_COLORS];
export const NUMBERS = [1, 2, 3, 4, 5];
export const COPIES = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 };

let ACTIVE_VARIANT = "standard";

export function configureVariant(variant = "standard") {
  const normalized = String(variant || "standard").toLowerCase();
  if (!["standard", "sixth", "rainbow"].includes(normalized)) {
    throw new Error(`Variante non valida: ${variant}`);
  }

  ACTIVE_VARIANT = normalized;
  COLORS.splice(0, COLORS.length, ...BASE_COLORS);
  COLOR_CLUES.splice(0, COLOR_CLUES.length, ...BASE_COLORS);

  if (normalized === "sixth" || normalized === "rainbow") {
    COLORS.push(RAINBOW_COLOR);
  }
  if (normalized === "sixth") {
    COLOR_CLUES.push(RAINBOW_COLOR);
  }
  // rainbow: Arc is a sixth firework but cannot itself be named by a color clue.
  return getVariantConfig();
}

export function getVariantConfig() {
  return {
    name: ACTIVE_VARIANT,
    colors: [...COLORS],
    colorClues: [...COLOR_CLUES],
    rainbowColor: RAINBOW_COLOR,
    targetScore: targetScore()
  };
}

export function activeVariant() {
  return ACTIVE_VARIANT;
}

export function targetScore() {
  return COLORS.length * 5;
}

export function isLegalColorClue(value) {
  return COLOR_CLUES.includes(value);
}

export function colorHintTouches(cardColor, clueColor) {
  if (!isLegalColorClue(clueColor)) return false;
  if (ACTIVE_VARIANT === "rainbow" && cardColor === RAINBOW_COLOR) return true;
  return cardColor === clueColor;
}

export function colorsConsistentWithPositiveColorClue(clueColor) {
  if (!isLegalColorClue(clueColor)) return [];
  if (ACTIVE_VARIANT === "rainbow") return [clueColor, RAINBOW_COLOR];
  return [clueColor];
}

export function colorsExcludedByNegativeColorClue(clueColor) {
  return colorsConsistentWithPositiveColorClue(clueColor);
}

export function colorCluesTouchingCardColor(cardColor) {
  return COLOR_CLUES.filter(clue => colorHintTouches(cardColor, clue));
}

export function cardsPerPlayer(players) {
  return players <= 3 ? 5 : 4;
}

export const BONUS_TYPES = [
  "CLUE",
  "CLUE_AND_STRIKE_RECOVERY",
  "FREE_COLOR_HINT",
  "FREE_NUMBER_HINT",
  "PLAY_FROM_DISCARD",
  "RETURN_DISCARD_TO_DECK"
];
