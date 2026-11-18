import {splitLayoutGeometry,type SplitPaneGeometry} from '../public/cuts-split-layout.js';
import {splitLayoutSchema,type FramingOptions} from './cuts-edit.js';

/** Crop before scaling, then pad at output size when the viewport exceeds the source. */
function outputCrop(width:number,height:number,options:FramingOptions,output:{width:number;height:number}) {
  const zoom=options.mode==='blur'?Math.max(1,options.zoom):options.zoom;
  const viewportHeight=Math.max(2,Math.floor(Math.min(height,width*output.height/output.width)/zoom/2)*2);
  const viewportWidth=Math.max(2,Math.floor(viewportHeight*output.width/output.height/2)*2);
  const cropHeight=Math.max(2,Math.floor(Math.min(height,viewportHeight)/2)*2);
  const cropWidth=Math.max(2,Math.floor(Math.min(width,viewportWidth)/2)*2);
  const x=Math.max(0,Math.floor((width-cropWidth)*options.focusX/2)*2);
  const y=Math.max(0,Math.floor((height-cropHeight)*options.focusY/2)*2);
  const scaledWidth=Math.max(2,Math.round(cropWidth*output.width/viewportWidth/2)*2);
  const scaledHeight=Math.max(2,Math.round(cropHeight*output.height/viewportHeight/2)*2);
  const padX=Math.floor((output.width-scaledWidth)*options.focusX/2)*2;
  const padY=Math.floor((output.height-scaledHeight)*options.focusY/2)*2;
  return `crop=${cropWidth}:${cropHeight}:${x}:${y},scale=${scaledWidth}:${scaledHeight}:flags=lanczos,pad=${output.width}:${output.height}:${padX}:${padY}:color=black,setsar=1`;
}

function paneFilter(pane:SplitPaneGeometry){
  const {crop,scaled,pad}=pane;
  return `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${scaled.width}:${scaled.height}:flags=lanczos,pad=${pane.width}:${pane.height}:${pad.x}:${pad.y}:color=black,setsar=1,format=yuv420p`;
}

export function cutFramingFilters(base:string,index:number,source:{width:number;height:number},output:{width:number;height:number},options:FramingOptions):string[]{
  const i=index,{width,height}=source;
  if(options.mode==='split'){
    const panes=splitLayoutGeometry(width,height,output.width,output.height,splitLayoutSchema.parse(options.split||{}));
    return [`${base},split=2[top${i}][bottom${i}]`,
      `[top${i}]${paneFilter(panes.webcam)}[webcam${i}]`,
      `[bottom${i}]${paneFilter(panes.content)}[content${i}]`,
      `[webcam${i}][content${i}]vstack=inputs=2[v${i}]`];
  }
  const crop=outputCrop(width,height,options,output);
  const fit=`scale=${output.width}:${output.height}:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${output.width}:${output.height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1`;
  if(options.mode==='blur')return [`${base},split=2[bg${i}][fg${i}]`,
    `[bg${i}]${crop},boxblur=20:2[blur${i}]`,
    `[fg${i}]scale=${output.width}:${output.height}:flags=lanczos:force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1[front${i}]`,
    `[blur${i}][front${i}]overlay=(W-w)/2:(H-h)/2:shortest=1,format=yuv420p[v${i}]`];
  return [`${base},${options.mode==='crop'?crop:fit},format=yuv420p[v${i}]`];
}
