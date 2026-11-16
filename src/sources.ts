import { GoogleDrive, driveToken } from './clients.js';
import { PackSource } from './pack-source.js';
import { LocalFiles } from './local.js';

class DriveCollection extends GoogleDrive {
  constructor(token:string,private roots:string[]){super(token);}
  override async tree(root:string,recursive:boolean) {
    return super.treeRoots([root,...this.roots],recursive);
  }
}
export async function sourceFor(watch:{source_type?:string;pack_defaults?:unknown;source_roots?:string[]}) {
  if(watch.source_type==='gta6_pack')return new PackSource(watch.pack_defaults||{});
  return watch.source_type==='local'?new LocalFiles():new DriveCollection(await driveToken(),watch.source_roots||[]);
}
