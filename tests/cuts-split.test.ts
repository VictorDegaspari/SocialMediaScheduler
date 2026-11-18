import {test} from 'node:test';
import assert from 'node:assert/strict';
import {defaultSplitLayout,splitLayoutGeometry,splitPaneGeometry} from '../public/cuts-split-layout.js';
import {framingOptionsSchema,splitLayoutSchema} from '../src/cuts-edit.js';

test('split settings accept independent regions and keep legacy framing unchanged',()=>{
  assert.deepEqual(framingOptionsSchema.parse({}),{format:'shorts',mode:'fit',focusX:.5,focusY:.5,zoom:1});
  assert.equal(framingOptionsSchema.parse({mode:'split'}).mode,'split');
  const layout=defaultSplitLayout();layout.topRatio=.4;layout.webcam.region={x:.7,y:.1,width:.3,height:.4};layout.content.fit='fit';layout.content.zoom=.5;
  assert.deepEqual(framingOptionsSchema.parse({mode:'split',split:layout}).split,layout);
  assert.deepEqual(splitLayoutSchema.parse({}),defaultSplitLayout());
  const copy=defaultSplitLayout();copy.webcam.region.x=.2;assert.equal(defaultSplitLayout().webcam.region.x,0);
});

test('invalid split coordinates and controls are rejected before rendering',()=>{
  for(const change of [
    {topRatio:.1},{topRatio:.8},{topRatio:NaN},
    {webcam:{...defaultSplitLayout().webcam,region:{x:.8,y:0,width:.3,height:1}}},
    {content:{...defaultSplitLayout().content,region:{x:0,y:.5,width:1,height:.6}}},
    ...[-.1,0,Infinity].map(width=>({webcam:{...defaultSplitLayout().webcam,region:{x:0,y:0,width,height:.3}}})),
    {content:{...defaultSplitLayout().content,zoom:4}},{content:{...defaultSplitLayout().content,focusX:-.1}},
    {webcam:{...defaultSplitLayout().webcam,fit:'stretch'}}
  ])assert.equal(splitLayoutSchema.safeParse({...defaultSplitLayout(),...change}).success,false);
});

test('fit retains the full selected region; filling and focus only crop inside it',()=>{
  const pane={...defaultSplitLayout().webcam,region:{x:.5,y:.5,width:.5,height:.5},fit:'fit' as const};
  const fitted=splitPaneGeometry(1920,1080,1080,960,pane);
  assert.deepEqual(fitted.crop,{x:960,y:540,width:960,height:540});
  assert.equal(fitted.scaled.width,1080);assert.ok(fitted.scaled.height<960);assert.ok(fitted.pad.y>0);
  const left=splitPaneGeometry(1920,1080,1080,960,{...pane,fit:'crop',focusX:0});
  const right=splitPaneGeometry(1920,1080,1080,960,{...pane,fit:'crop',focusX:1});
  assert.equal(left.pad.y,0);assert.equal(right.pad.x,0);assert.ok(right.crop.x>left.crop.x);
  assert.equal(left.crop.x,960);assert.ok(right.crop.x+right.crop.width<=1920);
});

test('zoom and asymmetric divisions stay bounded at preview, HD and 4K sizes',()=>{
  for(const [width,height] of [[720,1280],[1080,1920],[2160,3840],[1920,1080]]){
    for(const topRatio of [.2,.333,.5,.7])for(const zoom of [.25,1,3]){
      const layout=defaultSplitLayout();layout.topRatio=topRatio;
      layout.webcam={...layout.webcam,zoom,region:{x:.7,y:.6,width:.3,height:.4},focusX:1,focusY:1};
      const panes=splitLayoutGeometry(3840,2160,width,height,layout);
      assert.equal(panes.webcam.height+panes.content.height,height);
      for(const pane of Object.values(panes)){
        for(const value of [pane.width,pane.height,...Object.values(pane.crop),...Object.values(pane.scaled),...Object.values(pane.pad)])assert.equal(value%2,0);
        assert.ok(pane.crop.x>=0&&pane.crop.y>=0&&pane.crop.x+pane.crop.width<=3840&&pane.crop.y+pane.crop.height<=2160);
        assert.ok(pane.pad.x>=0&&pane.pad.y>=0&&pane.pad.x+pane.scaled.width<=pane.width&&pane.pad.y+pane.scaled.height<=pane.height);
      }
      assert.ok(panes.webcam.crop.x>=2688&&panes.webcam.crop.y>=1296,'zoom never samples another part of the source');
    }
  }
});
