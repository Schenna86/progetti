import { RNG } from "./rng.js";
import { HanabiGame } from "./game.js";

export function simulateGame({
  players = 5,
  seed = 1,
  strategy,
  bonusMode = "original",
  variant = "standard"
}) {
  const rng = new RNG(seed);
  const game = new HanabiGame({ players, rng, bonusMode, variant });
  return game.run(strategy);
}
