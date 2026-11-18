const clamp=value=>Math.max(0,Math.min(1,value));
export function overlayVisible(overlay,time,duration){return time>=overlay.start&&time<Math.min(overlay.end??duration,duration);}

// One wrapping rule keeps the same line breaks in the canvas and FFmpeg.
export function wrapOverlayText(text,fontSize,width){
  const weight=char=>/[ilI.,'!:;|]/u.test(char)?.32:/[MW@#%]/u.test(char)?.95:/\s/u.test(char)?.35:/[A-ZÀ-Ý]/u.test(char)?.75:.64;
  const lines=[];
  for(const paragraph of text.replace(/\r/g,'').split('\n')){
    let line='',used=0;
    for(const word of paragraph.split(/(\s+)/u)){
      const size=Array.from(word).reduce((n,c)=>n+weight(c)*fontSize,0);
      if(line.trim()&&used+size>width){lines.push(line.trimEnd());line='';used=0;}
      for(const char of word){
        const next=weight(char)*fontSize;
        if(used+next>width&&line){lines.push(line.trimEnd());line='';used=0;}
        if(!line&&/\s/u.test(char))continue;
        line+=char;used+=next;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function overlayTextLayout(overlay,output){
  let fontSize=overlay.fontSize*output.height/1280,lines=[];
  for(let i=0;i<8;i++){
    lines=wrapOverlayText(overlay.text,fontSize,output.width*overlay.width);
    const height=lines.length*fontSize*1.2;
    if(height<=output.height*.9)break;
    fontSize*=output.height*.9/height;
  }
  return {lines,fontSize,lineHeight:fontSize*1.2};
}

export function overlayImageBox(overlay,output,image){
  const scale=Math.min(output.width*overlay.width/image.width,output.height*.95/image.height);
  const width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale));
  return {width,height,x:Math.round((output.width-width)*clamp(overlay.x)),y:Math.round((output.height-height)*clamp(overlay.y))};
}
