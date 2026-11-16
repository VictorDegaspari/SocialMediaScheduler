import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.ENCRYPTION_KEY ||= '00'.repeat(32);
const { BrowserJournal, tiktokCaption } = await import('../src/browser-tiktok.js');
const { metadataSchema } = await import('../src/domain.js');
const directory = await mkdtemp(join(tmpdir(), 'watcher-browser-journal-'));
const journal = new BrowserJournal(directory);
await journal.init();

test('claim do navegador impede dois uploads concorrentes do mesmo conteúdo', async () => {
  const hash = 'a'.repeat(64);
  const results = await Promise.all([journal.claim(hash, 'video.mp4', true), journal.claim(hash, 'copia.mp4', true)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await journal.get(hash))?.status, 'preparing');
  assert.equal((await stat(join(directory, hash + '.json'))).mode & 0o777, 0o600);
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
});

test('revisão e resultados desconhecidos persistem após reiniciar e continuam deduplicados', async () => {
  const hash = 'b'.repeat(64);
  const job = (await journal.claim(hash, 'video.mp4', true))!;
  await journal.update(job, 'unknown');
  const restarted = new BrowserJournal(directory);
  assert.equal((await restarted.get(hash))?.status, 'unknown');
  assert.equal(await restarted.claim(hash, 'renomeado.mp4', true), undefined);
  const review = await restarted.update(job, 'review');
  assert.equal(review.madeWithAI, true);
  assert.equal((await journal.get(hash))?.status, 'review');
  await assert.rejects(() => journal.get('../outside'), /inválido/);
});

test('só permite liberar claim quando o controlador confirmou que a transferência não começou', async () => {
  const hash = 'c'.repeat(64);
  await journal.claim(hash, 'video.mp4', false);
  await journal.releaseBeforeUpload(hash);
  assert.equal(await journal.get(hash), undefined);
  assert(await journal.claim(hash, 'video.mp4', false));
});

test('monta legenda do JSON sem omitir título e rejeita truncamento silencioso', () => {
  const metadata = metadataSchema.parse({title:'Minha dica',description:'Descrição.',hashtags:['#rotina','minha dica'],tiktok:{madeWithAI:true}});
  assert.equal(tiktokCaption(metadata), 'Minha dica\n\nDescrição.\n\n#rotina #minhadica');
  assert.equal(metadata.tiktok.madeWithAI, true);
  assert.throws(() => tiktokCaption(metadataSchema.parse({title:'Vídeo',description:'x'.repeat(2200)})), /2.200/);
});

after(() => rm(directory, {recursive:true,force:true}));
