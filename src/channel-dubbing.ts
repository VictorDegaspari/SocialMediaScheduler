import {mkdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {z} from 'zod';
import {AppError, dataDir} from './config.js';
import {command, detectCutSpeech, type Cue} from './cuts-media.js';
import {validateVideo} from './media.js';

export const maxDubSeconds = 300;
export const dubVersion = 3;
export const dubVoices = [
  {id: 'pf_dora', label: 'Dora (feminina)'},
  {id: 'pm_alex', label: 'Alex (masculina)'},
  {id: 'pm_santa', label: 'Santa (masculina)'},
] as const;
export type DubVoice = typeof dubVoices[number]['id'];
export const defaultDubVoice = dubVoices[0].id;

export function dubFilename(version: number, voice: DubVoice = defaultDubVoice) {
  if (version === 1) return 'pt-br.mp4';
  const suffix = voice === defaultDubVoice ? '' : '-' + voice;
  return `pt-br-v${version}${suffix}.mp4`;
}
const diskError = 'Espaço insuficiente para gerar a dublagem.';
const dubScript = resolve('scripts/dub-channel-video.py');
const durationsSchema = z.object({durations: z.array(z.number().positive().max(120))});
type Speech = Pick<Cue, 'start' | 'end' | 'text'> & {earliest: number};

function groupSpeech(cues: Cue[], duration: number, language: string): Speech[] {
  const separator = ['ja', 'zh', 'yue', 'th', 'lo', 'my', 'km'].includes(language) ? '' : ' ';
  const phrases: Pick<Speech, 'start' | 'end' | 'text'>[] = [];
  for (const {start, end, text} of cues) {
    if (start >= duration || !/[\p{L}\p{N}]/u.test(text)) continue;
    const last = phrases.at(-1);
    const endsSentence = last && /[.!?…。！？]["'”’）)\]]?$/u.test(last.text);
    const gap = last ? start - last.end : 0;
    if (last && (gap < 0 || (
      gap <= 0.85 && end - last.start <= 13 && last.text.length + text.length <= 250 &&
      (!endsSentence || gap <= 0.3 && last.end - last.start <= 2.3)
    ))) {
      last.end = Math.min(duration, Math.max(last.end, end));
      last.text += separator + text;
    } else {
      phrases.push({start, end: Math.min(end, duration), text});
    }
  }
  return phrases.map((phrase, index) => {
    const before = phrase.start - (phrases[index - 1]?.end ?? 0);
    const after = (phrases[index + 1]?.start ?? duration) - phrase.end;
    // Nearby phrases share the silence, with a small pause reserved between them.
    return {...phrase,
      earliest: phrase.start - Math.min(0.32, Math.max(0, before - 0.16) / 3),
      end: phrase.end + Math.min(0.82, Math.max(0, after - 0.16) * 2 / 3),
    };
  });
}

async function synthesizeLocally(work: string, language: string, phrases: Speech[], voice: DubVoice): Promise<number[]> {
  const input = join(work, 'input.json');
  await writeFile(input, JSON.stringify({language, voice, phrases: phrases.map(({text, end, earliest}) => ({text, window: end - earliest}))}));
  try {
    const output = await command(process.env.CUTS_PYTHON || 'python3', [
      dubScript, '--input', input, '--cache-dir', join(dataDir, 'dubbing-models'),
    ], {timeout: 30 * 60_000, cwd: work, maxOutput: 16 * 1024, diskError});
    const result = JSON.parse(output);
    switch (result.error) {
      case 'model_download': throw new AppError('Não foi possível baixar os modelos de dublagem. Confira a conexão e tente novamente.', 502);
      case 'unsupported_language': throw new AppError('O tradutor local não oferece suporte ao idioma identificado neste vídeo.');
      case 'empty_translation': throw new AppError('O tradutor local não conseguiu traduzir todas as falas do vídeo.');
      case 'empty_voice': throw new AppError('O sintetizador local não conseguiu gerar áudio para todas as falas.');
    }
    const {durations} = durationsSchema.parse(result);
    if (durations.length !== phrases.length) throw new Error('missing audio');
    return durations;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Não foi possível traduzir ou gerar a voz local. Verifique as dependências da dublagem e tente novamente.');
  } finally { await rm(input, {force: true}).catch(() => {}); }
}

async function cached<T>(file: string, create: () => Promise<T>): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const value = await create();
  await writeFile(file + '.part', JSON.stringify(value));
  await rename(file + '.part', file);
  return value;
}

type DubTrack = {file: string; start: number; earliest: number; end: number; duration: number};

async function renderDub(source: string, output: string, duration: number, tracks: DubTrack[]) {
  const filters = tracks.map(({start, earliest, end, duration}, index) => {
    const time = Math.max(earliest, Math.min(start, end - duration - 0.02));
    const window = end - time;
    // Leave room for AAC/atempo sample rounding at the end of each spoken segment.
    let ratio = Math.max(1, duration / Math.max(0.01, window - 0.015));
    const tempo: string[] = [];
    while (ratio > 2) {
      tempo.push('atempo=2');
      ratio /= 2;
    }
    if (ratio > 1) tempo.push('atempo=' + ratio.toFixed(6));
    return `[${index + 1}:a]${[...tempo,'aresample=48000', 'atrim=duration=' + window.toFixed(3), 'adelay=' + Math.round(time * 1000) + ':all=1'].join(',')}[a${index}]`;
  });
  const mix = tracks.map((_, index) => `[a${index}]`).join('');
  filters.push(`${mix}amix=inputs=${tracks.length}:normalize=0,apad,atrim=duration=${duration.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=7,aformat=sample_rates=48000:channel_layouts=mono[dub]`);
  await command('ffmpeg', [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-protocol_whitelist', 'file',
    '-f', 'mov', '-i', source, ...tracks.flatMap(({file}) => ['-f','wav','-i',file]),
    '-filter_complex', filters.join(';'), '-map', '0:v:0', '-map', '[dub]', '-c:v', 'copy',
    '-c:a', 'aac', '-b:a', '192k', '-metadata:s:a:0', 'language=por', '-movflags', '+faststart',
    '-f', 'mp4', output,
  ], {timeout: 10 * 60_000, diskError});
}

export async function dubChannelVideo(directory: string, duration: number, voice: DubVoice = defaultDubVoice, dependencies = {
  transcribe: detectCutSpeech, synthesize: synthesizeLocally,
}) {
  const workspace = join(directory, 'dub-work');
  const versionWork = join(workspace, `v${dubVersion}`);
  const work = join(versionWork, voice);
  await mkdir(work, {recursive: true});
  const {language, phrases} = await cached(join(versionWork, 'transcript.json'), async () => {
    const transcript = await dependencies.transcribe(directory);
    return {language: transcript.language, phrases: groupSpeech(transcript.cues, duration, transcript.language)};
  });
  if (!phrases.length) throw new AppError('Não foi encontrada fala suficiente para dublar este vídeo.');
  if (phrases.length > 180) throw new AppError('Há falas demais neste vídeo. Use um trecho menor para dublar.');
  const durations = await cached(join(work, 'durations.json'), () => dependencies.synthesize(work, language, phrases, voice));
  const tracks = phrases.map(({start, earliest, end}, index) =>
    ({file: join(work, index + '.wav'), start, earliest, end, duration: durations[index]}));
  const part = join(directory, 'pt-br.part');
  try {
    await renderDub(join(directory, 'source.mp4'), part, duration, tracks);
    await validateVideo(part, 'any', duration + 0.5);
    await rename(part, join(directory, dubFilename(dubVersion, voice)));
  } catch {
    throw new AppError('Não foi possível montar o vídeo dublado. Confira o espaço em disco e tente novamente.');
  } finally {
    await rm(part, {force: true}).catch(() => {});
  }
  // If the service restarts after the rename, the worker reuses the finished MP4.
  await rm(workspace, {recursive: true, force: true}).catch(() => {});
}
