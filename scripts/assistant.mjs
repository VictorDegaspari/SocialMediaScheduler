import {randomUUID} from 'node:crypto';
const base=new URL(process.env.APP_URL||'http://localhost:4317');
if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname)||!['http:','https:'].includes(base.protocol)||base.username||base.password)throw new Error('A integração do assistente exige o painel local.');
const [command='context',id]=process.argv.slice(2);
const routes={context:['GET','/api/assistant/context'],titles:['POST','/api/assistant/titles'],profile:['POST','/api/assistant/profiles'],'update-profile':['PUT','/api/assistant/profiles/'+id],bind:['POST','/api/assistant/profiles/'+id+'/accounts'],request:['POST','/api/assistant/requests'],cancel:['POST','/api/assistant/requests/'+id+'/cancel'],resume:['POST','/api/assistant/requests/'+id+'/resume'],resolve:['POST','/api/assistant/actions/'+id+'/resolve'],'browser-profile':['POST','/api/browser/profiles'],login:['POST','/api/browser/profiles/'+id+'/login']};
try {
  if(!routes[command])throw new Error('Comandos: context, titles, profile, update-profile ID, bind ID, request, cancel ID, resume ID, resolve ID, browser-profile, login ID.');
  if(['update-profile','bind','cancel','resume','resolve','login'].includes(command)&&!/^default$|^[a-f0-9-]{36}$/.test(id||''))throw new Error('Identificador inválido.');
  const [method,path]=routes[command];let body={};
  if(['titles','profile','update-profile','bind','request','resolve','browser-profile'].includes(command)){let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>128*1024)throw new Error('Pedido muito grande.');}body=JSON.parse(input);}
  if(command==='request'&&!body.requestKey)body.requestKey=randomUUID();
  const response=await fetch(new URL(path,base),{method,redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/json','X-Watcher-Request':'1'},...(method!=='GET'?{body:JSON.stringify(body)}:{})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Falha na operação local.');console.log(JSON.stringify(result,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
