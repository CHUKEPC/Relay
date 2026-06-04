/** Small, dependency-free id generator usable in any process. */
let counter = 0
export function makeId(prefix = 'id'): string {
  counter = (counter + 1) % 1_000_000
  const rand = Math.random().toString(36).slice(2, 8)
  const time = Date.now().toString(36)
  // Delimited so the time/counter boundary is unambiguous (no accidental collisions).
  return `${prefix}_${time}_${counter.toString(36)}_${rand}`
}
