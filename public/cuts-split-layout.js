const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const evenFloor=value=>Math.floor(value/2)*2;
const evenRound=value=>Math.round(value/2)*2;

export function defaultSplitLayout(){
  const pane={fit:'crop',focusX:0.5,focusY:0.5,zoom:1};
  return {topRatio:0.5,webcam:{...pane,region:{x:0,y:0,width:0.3,height:0.35}},content:{...pane,region:{x:0,y:0,width:1,height:1}}};
}

/** Even source/output pixels keep the canvas and YUV420 export on the same crop. */
export function splitPaneGeometry(sourceWidth,sourceHeight,width,height,pane){
  const region=pane.region;
  const selectedWidth=clamp(evenFloor(sourceWidth*region.width),2,evenFloor(sourceWidth));
  const selectedHeight=clamp(evenFloor(sourceHeight*region.height),2,evenFloor(sourceHeight));
  const left=clamp(evenFloor(sourceWidth*region.x),0,evenFloor(sourceWidth)-selectedWidth);
  const top=clamp(evenFloor(sourceHeight*region.y),0,evenFloor(sourceHeight)-selectedHeight);
  const scale=(pane.fit==='fit'?Math.min(width/selectedWidth,height/selectedHeight):Math.max(width/selectedWidth,height/selectedHeight))*pane.zoom;
  const viewportWidth=width/scale,viewportHeight=height/scale;
  const cropWidth=clamp(evenFloor(Math.min(selectedWidth,viewportWidth)),2,selectedWidth);
  const cropHeight=clamp(evenFloor(Math.min(selectedHeight,viewportHeight)),2,selectedHeight);
  // A rounded source crop must still cover an axis that the viewport fills.
  const scaledWidth=viewportWidth<=selectedWidth?width:clamp(evenRound(cropWidth*scale),2,width);
  const scaledHeight=viewportHeight<=selectedHeight?height:clamp(evenRound(cropHeight*scale),2,height);
  return {width,height,
    crop:{x:left+evenFloor((selectedWidth-cropWidth)*pane.focusX),y:top+evenFloor((selectedHeight-cropHeight)*pane.focusY),width:cropWidth,height:cropHeight},
    scaled:{width:scaledWidth,height:scaledHeight},pad:{x:evenFloor((width-scaledWidth)*pane.focusX),y:evenFloor((height-scaledHeight)*pane.focusY)}};
}

export function splitLayoutGeometry(sourceWidth,sourceHeight,width,height,layout){
  const topHeight=clamp(evenRound(height*layout.topRatio),2,height-2);
  return {webcam:splitPaneGeometry(sourceWidth,sourceHeight,width,topHeight,layout.webcam),
    content:splitPaneGeometry(sourceWidth,sourceHeight,width,height-topHeight,layout.content)};
}
