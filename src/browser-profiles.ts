import {resolve,join} from 'node:path';
export function browserProfileDirectory(id='default',root=resolve('.browser-data/tiktok')) {
  if(id==='default')return root;
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))throw new Error('Perfil do navegador inválido.');
  return join(root,'accounts',id);
}
