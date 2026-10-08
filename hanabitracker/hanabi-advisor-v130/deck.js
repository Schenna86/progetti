import { COLORS, NUMBERS, COPIES } from "./constants.js";

export function createDeck(rng) {
  const deck = [];
  let id = 1;

  for (const color of COLORS) {
    for (const number of NUMBERS) {
      for (let copy = 1; copy <= COPIES[number]; copy++) {
        deck.push({
          id: id++,
          color,
          number,
          copy
        });
      }
    }
  }

  return rng.shuffle(deck);
}
