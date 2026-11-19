import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCanvas} from '@napi-rs/canvas';
import {cutOverlaysSchema,validateOverlayTimes} from '../src/cuts-overlays.js';
import {overlayVisible,overlayImageBox,overlayTextLayout} from '../public/cuts-overlays-layout.js';

test('overlay contracts reject unsafe styling, duplicate identity and invalid timing',()=>{
  const text={id:randomUUID(),type:'text',text:'Título com acentos e % literal'};
  const [parsed]=cutOverlaysSchema.parse([text]);assert.equal(parsed.end,null);assert.equal(parsed.start,0);
  assert.doesNotThrow(()=>validateOverlayTimes([parsed],8));
  for(const fields of [{color:'white:movie=/etc/passwd'},{x:-1},{width:3},{fontSize:500},{text:''},{text:'a\u0000b'},{start:Infinity},{alignment:'spread'}])assert.throws(()=>cutOverlaysSchema.parse([{...text,...fields}]));
  assert.throws(()=>cutOverlaysSchema.parse([text,text]));
  assert.throws(()=>cutOverlaysSchema.parse([{id:randomUUID(),type:'image',imageId:'../../source.mp4'}]));
  const image={id:randomUUID(),type:'image',imageId:randomUUID()};
  for(const opacity of [-.01,1.01,Infinity,'0.5'])assert.throws(()=>cutOverlaysSchema.parse([{...image,opacity}]));
  for(const opacity of [0,.65,1])assert.equal(cutOverlaysSchema.parse([{...image,opacity,watermark:true}])[0].type,'image');
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
});
test('text aligns inside its box and justifies only between words on wrapped lines',()=>{
  const ctx=createCanvas(1,1).getContext('2d'),output={width:720,height:1280};
  const style={text:'Olá mundo',fontSize:48,width:.5};
  const left=overlayTextLayout({...style,alignment:'left'},output,ctx);
  const center=overlayTextLayout({...style,alignment:'center'},output,ctx);
  const right=overlayTextLayout({...style,alignment:'right'},output,ctx);
  assert.equal(left.lines[0][0].x,0);
  assert(center.lines[0][0].x>0);
  assert.equal(right.lines[0][0].x,center.lines[0][0].x*2);
  assert.equal(overlayTextLayout(style,output,ctx).width,Math.ceil(ctx.measureText(style.text).width),'a saved text without alignment keeps its fitted box');
  const text='Um dois três quatro cinco seis sete.\nFim.';
  const layout=overlayTextLayout({...style,text,alignment:'justify'},output,ctx);
  assert.equal(layout.lines.flat().map(part=>part.text).join('').replace(/\s/g,''),text.replace(/\s/g,''));
  const first=layout.lines[0],lastWord=first.at(-1)!;
  assert(first.length>2);
  assert.equal(first[0].x,0);
  assert(Math.abs(lastWord.x+ctx.measureText(lastWord.text).width-layout.width)<.001);
  const firstGap=first[1].x-ctx.measureText(first[0].text).width;
  const secondGap=first[2].x-first[1].x-ctx.measureText(first[1].text).width;
  assert(Math.abs(firstGap-secondGap)<.001);
  assert.deepEqual(layout.lines.at(-1),[{text:'Fim.',x:0}]);
});
