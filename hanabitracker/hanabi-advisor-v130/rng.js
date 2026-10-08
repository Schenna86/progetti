export class RNG {
  constructor(seed = 1) {
    this.state = (Number(seed) >>> 0) || 1;
  }

  nextUint32() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  random() {
    return this.nextUint32() / 4294967296;
  }

  int(maxExclusive) {
    return Math.floor(this.random() * maxExclusive);
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}
