import {z} from 'zod';
import {MAX_CUT_SECTION_SECONDS, type CutSourceRange} from './cuts-source-limits.js';
import type {ReplayData} from './cuts-heatmap.js';

const timecode = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER / 1000)
  .transform(value => Math.round(value * 1000) / 1000);

export const cutSourceRangeSchema = z.object({start: timecode, end: timecode}).strict().refine(range => {
  const milliseconds = Math.round((range.end - range.start) * 1000);
  return milliseconds >= 500 && milliseconds <= MAX_CUT_SECTION_SECONDS * 1000;
}, 'Escolha um trecho entre 0,5 segundo e 30 minutos.');

export function suggestSourceRanges(replay: ReplayData, duration: number): CutSourceRange[] {
  if (replay.status !== 'available' || !Number.isFinite(duration) || duration < .5) return [];
  const length = Math.min(duration, MAX_CUT_SECTION_SECONDS);
  const ranges: CutSourceRange[] = [];
  const peaks = replay.points.filter(point => point.start < duration && point.value > 0)
    .sort((a, b) => b.value - a.value || a.start - b.start);
  for (const peak of peaks) {
    const center = (peak.start + Math.min(peak.end, duration)) / 2;
    const start = Math.floor(Math.max(0, Math.min(duration - length, center - length / 2)));
    const end = Math.floor((start + length) * 1000) / 1000;
    if (ranges.some(range => start < range.end && end > range.start)) continue;
    ranges.push({start, end});
    if (ranges.length === 3) break;
  }
  return ranges;
}
