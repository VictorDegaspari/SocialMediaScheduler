const clamp=value=>Math.max(0,Math.min(1,value));
export function overlayVisible(overlay,time,duration){return time>=overlay.start&&time<Math.min(overlay.end??duration,duration);}

function wrapParagraph(paragraph,width,measure){
  const lines=[];
  let line='';
  for(const word of paragraph.match(/\S+/gu)??[]){
    const next=line?line+' '+word:word;
    if(measure(next)<=width){line=next;continue;}
    if(line){lines.push(line);line='';}
    if(measure(word)<=width){line=word;continue;}
    for(const character of word){
      if(line&&measure(line+character)>width){lines.push(line);line='';}
      line+=character;
    }
  }
  lines.push(line);
  return lines;
}

export function overlayTextLayout(overlay,output,ctx){
  const scale=output.height/1280,widthLimit=output.width*overlay.width;
  const paragraphs=overlay.text.replace(/\r/g,'').split('\n');
  const measure=text=>ctx.measureText(text).width;
  let fontSize=overlay.fontSize*scale,rows=[],font='';
  for(let i=0;i<8;i++){
    font=`bold ${fontSize}px "DejaVu Sans", sans-serif`;
    ctx.font=font;
    rows=paragraphs.flatMap(paragraph=>{
      const lines=wrapParagraph(paragraph,widthLimit,measure);
      return lines.map((text,index)=>({text,canJustify:index<lines.length-1}));
    });
    const height=rows.length*fontSize*1.2;
    if(height<=output.height*.9||i===7)break;
    fontSize*=output.height*.9/height;
  }
  const width=Math.ceil(Math.max(1,overlay.alignment?widthLimit:0,...rows.map(row=>measure(row.text))));
  const lineHeight=fontSize*1.2;
  const lines=rows.map(({text,canJustify})=>{
    const textWidth=measure(text);
    if(overlay.alignment==='center')return [{text,x:(width-textWidth)/2}];
    if(overlay.alignment==='right')return [{text,x:width-textWidth}];
    if(overlay.alignment!=='justify'||!canJustify)return [{text,x:0}];
    const words=text.split(' ');
    if(words.length<=1)return [{text,x:0}];
    const widths=words.map(measure);
    const gap=(width-widths.reduce((sum,value)=>sum+value,0))/(words.length-1);
    let x=0;
    return words.map((word,index)=>{
      const position=x;
      x+=widths[index]+gap;
      return {text:word,x:position};
    });
  });
  return {lines,font,lineHeight,scale,width,height:Math.ceil(lineHeight*lines.length)};
}

export function overlayTextBox(overlay,output,{width,height}){
  return {width,height,x:Math.round((output.width-width)*overlay.x),y:Math.round((output.height-height)*overlay.y)};
}

export function drawOverlayText(ctx,overlay,layout,x,y){
  const {lines,width,height,font,scale,lineHeight}=layout;
  if(overlay.background==='box'){
    const padding=8*scale;
    ctx.fillStyle='rgba(0,0,0,.65)';
    ctx.fillRect(x-padding,y-padding,width+padding*2,height+padding*2);
  }
  ctx.font=font;
  ctx.textBaseline='top';
  ctx.textAlign='left';
  ctx.lineWidth=4*scale;
  ctx.lineJoin='round';
  ctx.strokeStyle='#000';
  ctx.fillStyle=overlay.color;
  for(const [index,line] of lines.entries()){
    for(const word of line){
      ctx.strokeText(word.text,x+word.x,y+index*lineHeight);
      ctx.fillText(word.text,x+word.x,y+index*lineHeight);
    }
  }
}

export function overlayImageBox(overlay,output,image){
  const scale=Math.min(output.width*overlay.width/image.width,output.height*.95/image.height);
  const width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale));
  return {width,height,x:Math.round((output.width-width)*clamp(overlay.x)),y:Math.round((output.height-height)*clamp(overlay.y))};
}
