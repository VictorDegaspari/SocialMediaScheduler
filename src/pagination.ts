import { z } from 'zod';
import { AppError } from './config.js';

export type PageOptions={scope:string;limit:number;cursor:{time:string;id:string}|null};
export type PageMetadata={limit:number;hasMore:boolean;nextCursor:string|null};
type PageSettings={scope:string;prefix?:string;defaultLimit?:number;maxLimit?:number;idType?:'uuid'|'bigint'};
const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Opaque, collection-specific keysets keep histories bounded without OFFSET. */
export function parsePagination(query:Record<string,unknown>,settings:PageSettings):PageOptions{
  const limitName=settings.prefix?settings.prefix+'Limit':'limit',cursorName=settings.prefix?settings.prefix+'Cursor':'cursor';
  const rawLimit=query[limitName],rawCursor=query[cursorName];
  const maximum=settings.maxLimit||100;
  if(rawLimit!==undefined&&(typeof rawLimit!=='string'||!/^\d{1,3}$/.test(rawLimit)||Number(rawLimit)<1||Number(rawLimit)>maximum))
    throw new AppError(`Informe ${limitName} entre 1 e ${maximum}.`);
  const limit=rawLimit===undefined?settings.defaultLimit||20:Number(rawLimit);
  let cursor:PageOptions['cursor']=null;
  if(rawCursor!==undefined){
    try{
      if(typeof rawCursor!=='string'||rawCursor.length>512||! /^[A-Za-z0-9_-]+$/.test(rawCursor))throw new Error();
      const data=JSON.parse(Buffer.from(rawCursor,'base64url').toString('utf8'));
      if(data.v!==1||data.scope!==settings.scope||typeof data.time!=='string'||!timestamp.test(data.time)||!Number.isFinite(Date.parse(data.time))||typeof data.id!=='string')throw new Error();
      // Date.parse normalizes some impossible dates that PostgreSQL rejects.
      if(data.time.startsWith('0000-')||new Date(data.time).toISOString().slice(0,23)!==data.time.slice(0,23))throw new Error();
      if(settings.idType==='bigint'){
        if(!/^[1-9]\d{0,18}$/.test(data.id)||BigInt(data.id)>9223372036854775807n)throw new Error();
      }else if(!z.string().uuid().safeParse(data.id).success)throw new Error();
      cursor={time:data.time,id:data.id};
    }catch{throw new AppError(`O cursor de ${settings.scope} é inválido. Volte à primeira página.`);}
  }
  return {scope:settings.scope,limit,cursor};
}

/** PostgreSQL microseconds must survive encoding even though JS Date uses ms. */
export function cursorFields(timeColumn:string,idColumn:string):string{
  for(const column of [timeColumn,idColumn])if(!/^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/i.test(column))throw new Error('Invalid pagination column');
  return `to_char(${timeColumn} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS __cursor_time,${idColumn}::text AS __cursor_id`;
}

export function keysetClause(page:PageOptions,timeColumn:string,idColumn:string,values:unknown[],idType:'uuid'|'bigint'='uuid'):string{
  cursorFields(timeColumn,idColumn);
  if(!page.cursor)return '';
  values.push(page.cursor.time,page.cursor.id);
  return ` AND (${timeColumn},${idColumn})<($${values.length-1}::timestamptz,$${values.length}::${idType})`;
}

export function pageLimit(page:PageOptions,values:unknown[]):string{
  values.push(page.limit+1);return ` LIMIT $${values.length}`;
}

export function paginateRows<T extends Record<string,any>>(rows:T[],page:PageOptions):{items:Omit<T,'__cursor_time'|'__cursor_id'>[];pagination:PageMetadata}{
  const hasMore=rows.length>page.limit,selected=rows.slice(0,page.limit),last=selected.at(-1);
  const nextCursor=hasMore&&last?Buffer.from(JSON.stringify({v:1,scope:page.scope,time:last.__cursor_time,id:last.__cursor_id})).toString('base64url'):null;
  return {items:selected.map(row=>{const {__cursor_time,__cursor_id,...item}=row;return item;}),pagination:{limit:page.limit,hasMore,nextCursor}};
}
