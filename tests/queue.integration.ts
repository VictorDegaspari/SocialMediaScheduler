import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Queue} from 'bullmq';
const url=new URL(process.env.REDIS_URL!);url.pathname='/14';process.env.REDIS_URL=url.toString();
const {LocalScheduler}=await import('../src/scheduler.js');
const name='watcher-test-'+randomUUID();
const connection={host:url.hostname,port:Number(url.port||6379),db:14,maxRetriesPerRequest:1};
const queue=new Queue(name,{connection});
const uploads=new Queue(name+'-uploads',{connection});
let ticked=0,processed=0,active=0,maximum=0;
const intents=new Set<string>();
let transferGate:Promise<void>|undefined;
const fakeWorker={tick:async()=>{ticked++;},native:{ready:async()=>[...intents],process:async(id:string)=>{active++;maximum=Math.max(maximum,active);await (transferGate||new Promise(resolve=>setTimeout(resolve,20)));if(intents.delete(id))processed++;active--;}}};
const schedulers:InstanceType<typeof LocalScheduler>[]=[];
async function until(condition:()=>boolean) {const limit=Date.now()+5000;while(!condition()){if(Date.now()>limit)throw new Error('Queue did not reach expected state');await new Promise(resolve=>setTimeout(resolve,25));}}
test('Redis persiste jobs e scheduler único retoma após reinício com concorrência global limitada',async()=>{
  // A publication queued before a worker exists must survive until it starts.
  intents.add('before-start');await queue.add('publish',{id:'before-start'},{jobId:'publish-before-start',removeOnComplete:true});
  const first=new LocalScheduler(fakeWorker as any,100,name);schedulers.push(first);await first.start();
  await until(()=>processed===1 && ticked>0);await first.stop();schedulers.pop();
  intents.add('after-restart');await queue.add('publish',{id:'after-restart'},{jobId:'publish-after-restart',removeOnComplete:true});
  const second=new LocalScheduler(fakeWorker as any,100,name),third=new LocalScheduler(fakeWorker as any,100,name);schedulers.push(second,third);
  await Promise.all([second.start(),third.start()]);await until(()=>processed===2);
  assert.equal((await queue.getJobSchedulers()).length,1);assert.equal(maximum,1);
  assert.equal((await second.state()).backend,'BullMQ + Redis');
});
test('upload demorado permite novos ciclos e a fila de transferências limita concorrência global a dois',async()=>{
  let release!:()=>void;transferGate=new Promise<void>(resolve=>{release=resolve;});
  const before=ticked;
  for(const id of ['slow-a','slow-b','slow-c'])intents.add(id);
  try {
    await until(()=>active===2);await until(()=>ticked>=before+3);
    assert.equal(maximum,2);assert.equal(active,2);
  }finally{transferGate=undefined;release();}
  await until(()=>!intents.size&&active===0);assert.equal(maximum,2);
});
after(async()=>{for(const scheduler of schedulers)await scheduler.stop();await queue.obliterate({force:true});await uploads.obliterate({force:true});await queue.close();await uploads.close();});
