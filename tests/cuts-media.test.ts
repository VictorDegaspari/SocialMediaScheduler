import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { selectHighlights, downloadCutSource, renderCut, type Cue } from '../src/cuts-media.js';

test('ranking chooses complete, distinct speech passages and never rewrites source words',()=>{
  const cues:Cue[]=Array.from({length:24},(_,i)=>({start:i*5,end:i*5+4.5,text:i===12?'Como aprender esta técnica?':`Fala original número ${i}.`}));
  const result=selectHighlights(cues,120,3,25);
  assert.equal(result.length,3);
  for(const clip of result){
    assert.ok(clip.start>=0&&clip.end<=120);
    assert.ok(clip.end-clip.start<=30.2);
    const original=cues.filter(c=>c.start>=clip.start&&c.end<=clip.end).map(c=>c.text).join(' ');
    assert.ok(original.startsWith(clip.title.replace(/…$/,'')),'title quotes the transcript');
  }
  assert.ok(result.some(c=>c.title.includes('Como aprender')),'explanatory opening receives a higher score');
  for(let i=1;i<result.length;i++)assert.ok(result[i].start>=result[i-1].end-0.05,'clips do not repeat the same passage');
});

test('short sources produce only the available number of meaningful cuts',()=>{
  assert.deepEqual(selectHighlights([],10,3,30),[]);
  const clips=selectHighlights([{start:1,end:3,text:'Sim.'},{start:3.2,end:7,text:'Este é o trecho completo.'}],8,5,30);
  assert.equal(clips.length,1);
  assert.ok(clips[0].end<=8);
  assert.ok(clips[0].title.includes('trecho completo'));
  assert.throws(()=>selectHighlights([],NaN,1,30));
  assert.throws(()=>selectHighlights([],10,11,30));
  assert.throws(()=>selectHighlights([],10,1,181));
});

test('URLs outside a specific HTTPS YouTube video are rejected before download',async()=>{
  for(const url of ['file:///etc/passwd','https://www.youtube.com.evil.test/watch?v=dQw4w9WgXcQ','https://127.0.0.1/watch?v=dQw4w9WgXcQ','https://youtube.com/playlist?list=abc','https://username:password@youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com:8443/watch?v=dQw4w9WgXcQ','https://youtu.be/dQw4w9WgXcQ/extra']){
    await assert.rejects(()=>downloadCutSource(url,'/unused-cuts-directory'),/link/);
  }
});

test('render rejects invalid ranges, unsafe IDs and captions outside speech before invoking FFmpeg',async()=>{
  const id='12345678-1234-4321-1234-123456789abc';
  const good={start:0,end:10,captions:[{start:1,end:3,text:'Fala.'}],framing:'fit' as const};
  await assert.rejects(()=>renderCut('/unused',`../../${id}`,good),/Identificador/);
  await assert.rejects(()=>renderCut('/unused',id,{...good,end:181}),/trecho/);
  await assert.rejects(()=>renderCut('/unused',id,{...good,captions:[{start:20,end:30,text:'Fora.'}]}),/fala/);
  await assert.rejects(()=>renderCut('/unused',id,{...good,captions:[{start:2,end:1,text:'Inválida.'}]}),/legendas/);
});

test('Python transcription adapter keeps recognized words and exact word times without translation',()=>{
  // Replace only the speech engine, exercising our real Python adapter without
  // downloading a model. Recognition accuracy itself still needs human review.
  const script=`import json, runpy, sys, types
class Word:
    def __init__(self, start, end, word): self.start, self.end, self.word = start, end, word
class Engine:
    def __init__(self, *args, **kwargs):
        assert kwargs['device'] == 'cpu' and kwargs['compute_type'] == 'int8'
    def transcribe(self, *args, **kwargs):
        assert kwargs['task'] == 'transcribe' and kwargs['word_timestamps'] and kwargs['vad_filter']
        assert kwargs['language'] == 'pt' and 'initial_prompt' not in kwargs
        return [types.SimpleNamespace(words=[Word(1.25,1.7,' Olá,'),Word(1.8,2.3,' você!'),Word(3,3.2,' Café'),Word(3.3,3.8,' com'),Word(3.9,4.2,' ação.')])], None
sys.modules['faster_whisper'] = types.SimpleNamespace(WhisperModel=Engine)
sys.argv = ['transcribe-cuts.py','--input','source.mp4','--language','pt','--cache-dir','unused']
runpy.run_path('scripts/transcribe-cuts.py',run_name='__main__')
`;
  const result=JSON.parse(execFileSync(process.env.CUTS_PYTHON||'python3',['-c',script],{encoding:'utf8'}));
  assert.equal(result[0].text,'Olá, você!');
  assert.deepEqual(result[0].words,[{start:1.25,end:1.7,text:'Olá,'},{start:1.8,end:2.3,text:'você!'}]);
  assert.equal(result[1].text,'Café com ação.');
  assert.equal(result[1].start,3);assert.equal(result[1].end,4.2);
});
