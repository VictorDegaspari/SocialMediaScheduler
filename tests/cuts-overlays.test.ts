import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cutOverlaysSchema,validateOverlayTimes} from '../src/cuts-overlays.js';
import {overlayVisible,overlayImageBox,overlayTextLayout} from '../public/cuts-overlays-layout.js';

test('overlay contracts reject unsafe styling, duplicate identity and invalid timing',()=>{
  const text={id:randomUUID(),type:'text',text:'Título com acentos e % literal'};
  const [parsed]=cutOverlaysSchema.parse([text]);assert.equal(parsed.end,null);assert.equal(parsed.start,0);
  assert.doesNotThrow(()=>validateOverlayTimes([parsed],8));
  for(const fields of [{color:'white:movie=/etc/passwd'},{x:-1},{width:3},{fontSize:500},{text:''},{text:'a\u0000b'},{start:Infinity}])assert.throws(()=>cutOverlaysSchema.parse([{...text,...fields}]));
  assert.throws(()=>cutOverlaysSchema.parse([text,text]));
  assert.throws(()=>cutOverlaysSchema.parse([{id:randomUUID(),type:'image',imageId:'../../source.mp4'}]));
  for(const timing of [{start:8,end:null},{start:3,end:2},{start:1,end:9}])assert.throws(()=>validateOverlayTimes(cutOverlaysSchema.parse([{...text,...timing}]),8));
  assert.equal(overlayVisible({start:1,end:3},.9,8),false);assert.equal(overlayVisible({start:1,end:3},1,8),true);assert.equal(overlayVisible({start:1,end:3},3,8),false);
  assert.equal(overlayVisible({start:0,end:null},7.99,8),true);
});
test('image positioning preserves aspect ratio and keeps tall images inside either output',()=>{
  for(const output of [{width:1080,height:1920},{width:1920,height:1080}]){
    const box=overlayImageBox({x:1,y:1,width:.8},output,{width:100,height:1000});
    assert(box.x>=0&&box.y>=0&&box.x+box.width<=output.width&&box.y+box.height<=output.height);
    assert(Math.abs(box.width/box.height-.1)<.002);
  }
  const layout=overlayTextLayout({text:'Uma mensagem extensa com várias palavras.\nSegunda linha.',fontSize:100,width:.4},{width:720,height:1280});
  assert(layout.lines.length>2);assert.equal(layout.lines.join('').replace(/\s/g,''),'Uma mensagem extensa com várias palavras.\nSegunda linha.'.replace(/\s/g,''));
  assert(layout.lines.every(line=>!line.includes('\n')));
});
