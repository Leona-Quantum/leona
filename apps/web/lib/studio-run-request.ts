/** Sampling fields for the run request, omitted rather than guessed.
 *
 * The API validates `shots` (1..1e6) and `seed` (0..2**31-1) and the planner
 * clamps shots / DROPS an out-of-range seed — a clamped seed is a different seed
 * presented as the user's. Sending a blank or unparseable field as 0 or NaN would
 * make Studio the thing that invented a value, so anything that is not a
 * non-negative integer is left out entirely and the planner chooses.
 */
export function sampling(shots: string, seed: string): { shots?: number; seed?: number } {
  const fields: { shots?: number; seed?: number } = {};
  const parsedShots = Number(shots.trim());
  if (shots.trim() !== "" && Number.isInteger(parsedShots) && parsedShots >= 1) {
    fields.shots = parsedShots;
  }
  const parsedSeed = Number(seed.trim());
  if (seed.trim() !== "" && Number.isInteger(parsedSeed) && parsedSeed >= 0) {
    fields.seed = parsedSeed;
  }
  return fields;
}
