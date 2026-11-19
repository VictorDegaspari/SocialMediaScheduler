import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,rename,rm,stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createCanvas} from '@napi-rs/canvas';
import {z} from 'zod';
import {AppError} from './config.js';
import {drawOverlayText,overlayImageBox,overlayTextBox,overlayTextLayout} from '../public/cuts-overlays-layout.js';

const placement={id:z.string().uuid(),start:z.number().finite().min(0).max(180).default(0),end:z.number().finite().positive().max(180).nullable().default(null),x:z.number().finite().min(0).max(1).default(.5),y:z.number().finite().min(0).max(1).default(.1),width:z.number().finite().min(.05).max(1).default(.8)};
export const cutOverlaySchema=z.discriminatedUnion('type',[
  z.object({...placement,type:z.literal('text'),text:z.string().trim().min(1).max(1000).refine(t=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(t),'O texto contém caracteres inválidos.'),fontSize:z.number().finite().min(24).max(160).default(64),color:z.string().regex(/^#[a-fA-F0-9]{6}$/).default('#FFFFFF'),background:z.enum(['none','box']).default('none'),alignment:z.enum(['left','center','right','justify']).optional()}),
  z.object({...placement,type:z.literal('image'),imageId:z.string().uuid(),opacity:z.number().finite().min(0).max(1).optional(),watermark:z.boolean().optional()})
]);
export const cutOverlaysSchema=z.array(cutOverlaySchema).max(20).refine(items=>new Set(items.map(i=>i.id)).size===items.length,'Cada elemento precisa ter um identificador diferente.');
export type CutOverlay=z.infer<typeof cutOverlaySchema>;
export function validateOverlayTimes(overlays:CutOverlay[],duration:number){
  if(overlays.some(o=>o.start>=duration||(o.end!==null&&(o.end<=o.start||o.end>duration+.001))))throw new AppError('Ajuste os tempos dos textos e imagens à duração final do vídeo.');
}
const imageMeta=z.object({width:z.number().int().positive(),height:z.number().int().positive(),mime:z.enum(['image/png','image/jpeg','image/webp'])});
const execute=promisify(execFile);
const imagePath=(dir:string,id:string)=>join(dir,'overlay-'+z.string().uuid().parse(id)+'.image');
export async function overlayImage(dir:string,id:string){
  try{
    const path=imagePath(dir,id),meta=imageMeta.parse(JSON.parse(await readFile(path+'.json','utf8')));
    await stat(path);return {path,...meta};
  }catch{throw new AppError('Uma imagem deste projeto não está mais disponível. Adicione a imagem novamente.',404);}
}
export async function saveOverlayImage(dir:string,bytes:Buffer){
  const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':bytes[0]===255&&bytes[1]===216&&bytes[2]===255?'image/jpeg':bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP'?'image/webp':null;
  if(!mime||bytes.length>20*1024*1024)throw new AppError('Escolha uma imagem PNG, JPEG ou WebP de até 20 MB.');
  if((await readdir(dir)).filter(f=>/^overlay-.*\.image$/.test(f)).length>=100)throw new AppError('Este projeto atingiu o limite de imagens adicionadas. Use uma imagem já presente ou crie outro projeto.');
  const id=randomUUID(),path=imagePath(dir,id),temporary=path+'.part';
  try{
    await writeFile(temporary,bytes,{flag:'wx'});
    const {stdout}=await execute('ffprobe',['-v','error','-show_entries','stream=codec_type,codec_name,width,height','-of','json',temporary],{timeout:15_000,maxBuffer:64*1024});
    const streams=JSON.parse(stdout).streams||[],image=streams[0];
    if(streams.length!==1||image.codec_type!=='video'||!['png','mjpeg','webp'].includes(image.codec_name)||!image.width||!image.height||image.width>16384||image.height>16384||image.width*image.height>40_000_000)throw new Error('invalid image');
    await execute('ffmpeg',['-v','error','-xerror','-i',temporary,'-frames:v','1','-f','null','-'],{timeout:15_000,maxBuffer:64*1024});
    const meta=imageMeta.parse({width:image.width,height:image.height,mime});
    await rename(temporary,path);await writeFile(path+'.json',JSON.stringify(meta),{flag:'wx'});
    return {id,...meta};
  }catch{await Promise.all([rm(path,{force:true}),rm(path+'.json',{force:true})]);throw new AppError('Não foi possível ler a imagem. Use um PNG, JPEG ou WebP válido de até 40 megapixels.');}
  finally{await rm(temporary,{force:true});}
}

export async function cutOverlayFilters(dir:string,clipId:string,overlays:CutOverlay[],output:{width:number;height:number},duration:number,inputCount:number){
  validateOverlayTimes(overlays,duration);
  const args:string[]=[],graph:string[]=[],temporary:string[]=[];
  let base='overlaybase',imageIndex=inputCount;
  try{
    for(const [index,o] of overlays.entries()){
      const next='overlay'+index,enable=`gte(t,${o.start})*lt(t,${o.end??duration})`;
      let position:{x:number;y:number},input:string,transform:string;
      if(o.type==='image'){
        const image=await overlayImage(dir,o.imageId),box=overlayImageBox(o,output,image);
        position=box;
        input=image.path;
        transform=`format=rgba,scale=${box.width}:${box.height}:flags=lanczos`;
        if(o.opacity!==undefined&&o.opacity!==1)transform+=`,colorchannelmixer=aa=${o.opacity}`;
      }else{
        const layout=overlayTextLayout(o,output,createCanvas(1,1).getContext('2d'));
        const box=overlayTextBox(o,output,layout),padding=Math.ceil(8*layout.scale)+2;
        const canvas=createCanvas(box.width+2*padding,box.height+2*padding);
        drawOverlayText(canvas.getContext('2d'),o,layout,padding,padding);
        input=join(dir,`${clipId}.overlay-${index}.png`);
        temporary.push(input);
        await writeFile(input,await canvas.encode('png'));
        position={x:box.x-padding,y:box.y-padding};
        transform='format=rgba';
      }
      args.push('-threads','1','-i',input);
      graph.push(`[${imageIndex++}:v:0]${transform}[overlayimage${index}]`);
      graph.push(`[${base}][overlayimage${index}]overlay=x=${position.x}:y=${position.y}:eof_action=repeat:enable='${enable}'[${next}]`);
      base=next;
    }
    return {args,graph,label:base,temporary};
  }catch(error){await Promise.all(temporary.map(path=>rm(path,{force:true})));throw error;}
}
