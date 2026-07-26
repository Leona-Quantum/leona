/** The API's own bounds on run sampling, mirrored so Studio can refuse a value
 * before the network does. Both are enforced in
 * `services/api/.../routes/runs.py` `CreateRunRequest`; the plan contract
 * (`SimplePlan.shots`) carries the same shots ceiling. These are the run lane's
 * limits and are unrelated to the browser CPU lane's per-tier `cpuSimShots`,
 * which is larger on the developer tier — sending that number straight through
 * to the API is a 422. */
export const MAX_RUN_SHOTS = 20_000;
export const MAX_RUN_SEED = 2 ** 31 - 1;

/** Sampling fields for the run request, omitted rather than guessed.
 *
 * Anything outside the API's bounds — or blank, or unparseable — is left out
 * entirely and the planner chooses. Studio must not be the thing that invents a
 * value: sending a blank field as 0 or clamping 65,536 shots down to 20,000
 * would both present a number the user did not ask for as if they had.
 */
export function sampling(shots: string, seed: string): { shots?: number; seed?: number } {
  const fields: { shots?: number; seed?: number } = {};
  const parsedShots = Number(shots.trim());
  if (shots.trim() !== "" && Number.isInteger(parsedShots) && parsedShots >= 1 && parsedShots <= MAX_RUN_SHOTS) {
    fields.shots = parsedShots;
  }
  const parsedSeed = Number(seed.trim());
  if (seed.trim() !== "" && Number.isInteger(parsedSeed) && parsedSeed >= 0 && parsedSeed <= MAX_RUN_SEED) {
    fields.seed = parsedSeed;
  }
  return fields;
}
