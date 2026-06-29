export const MOVIE_TIMEBASE = 30000;

export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * MOVIE_TIMEBASE);
}

export function ticksToSeconds(ticks: number): number {
  return ticks / MOVIE_TIMEBASE;
}
