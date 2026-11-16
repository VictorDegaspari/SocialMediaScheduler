import { Queue,Worker as QueueWorker } from 'bullmq';
import { logger,errorMessage } from './config.js';
import type { Worker } from './worker.js';

/** Redis holds durable wakeups; PostgreSQL holds schedules, approvals and upload sessions. */
export class LocalScheduler {
  private queue:Queue;
  private uploads:Queue;
  private consumer:QueueWorker|undefined;
  private uploadConsumer:QueueWorker|undefined;
  constructor(private worker:Worker,private every=10_000,private name='drive-watcher') {
    const url=new URL(process.env.REDIS_URL||'redis://localhost:6379');
    this.connection={host:url.hostname,port:Number(url.port||6379),db:Number(url.pathname.slice(1)||0),username:url.username?decodeURIComponent(url.username):undefined,password:url.password?decodeURIComponent(url.password):undefined,maxRetriesPerRequest:null,...(url.protocol==='rediss:'?{tls:{}}:{})};
    this.queue=new Queue(name,{connection:{...this.connection,maxRetriesPerRequest:1,enableOfflineQueue:false},defaultJobOptions:{attempts:1,removeOnComplete:true,removeOnFail:true}});
    this.uploads=new Queue(name+'-uploads',{connection:{...this.connection,maxRetriesPerRequest:1,enableOfflineQueue:false},defaultJobOptions:{attempts:1,removeOnComplete:true,removeOnFail:true}});
    this.queue.on('error',()=>logger.error({event:'queue_unavailable'},'A fila Redis está indisponível. Envios permanecem salvos no PostgreSQL.'));
    this.uploads.on('error',()=>logger.error({event:'upload_queue_unavailable'},'A fila de transferências está indisponível. Envios permanecem salvos no PostgreSQL.'));
  }
  private connection;
  async start() {
    await this.queue.setGlobalConcurrency(1);
    await this.uploads.setGlobalConcurrency(2);
    this.uploadConsumer=new QueueWorker(this.name+'-uploads',async job=>{
      await this.worker.native.process(job.data.id);
    },{connection:this.connection,concurrency:2});
    this.uploadConsumer.on('error',()=>logger.error({event:'upload_worker_error'},'Falha de conexão do worker de transferências.'));
    this.uploadConsumer.on('failed',(_job,error)=>logger.error({event:'upload_job_failed',message:errorMessage(error)},'O envio será reavaliado pelo estado persistido.'));
    this.consumer=new QueueWorker(this.name,async job=>{
      if(job.name==='tick') {
        await this.worker.tick();
        const ids=await this.worker.native.ready();
        if(ids.length)await this.uploads.addBulk(ids.map(id=>({name:'publish',data:{id},opts:{jobId:'publish-'+id}})));
      // Forward persisted jobs from the former shared queue during upgrades.
      } else if(job.name==='publish')await this.uploads.add('publish',job.data,{jobId:'publish-'+job.data.id});
    },{connection:this.connection,concurrency:1});
    this.consumer.on('error',()=>logger.error({event:'queue_worker_error'},'Falha de conexão do worker Redis.'));
    this.consumer.on('failed',(_job,error)=>logger.error({event:'queue_job_failed',message:errorMessage(error)},'O trabalho falhou; o estado persistido será consultado no próximo ciclo.'));
    await this.queue.upsertJobScheduler('watcher-tick',{every:this.every},{name:'tick',data:{},opts:{attempts:1,removeOnComplete:true,removeOnFail:true}});
    await this.queue.add('tick',{}, {jobId:'startup-tick'});
  }
  async state() {
    try{
      const [coordination,uploads]=await Promise.all([this.queue.getJobCounts('waiting','active','delayed','failed'),this.uploads.getJobCounts('waiting','active','delayed','failed')]);
      return {backend:'BullMQ + Redis',waiting:(coordination.waiting||0)+(uploads.waiting||0),active:(coordination.active||0)+(uploads.active||0),
        delayed:(coordination.delayed||0)+(uploads.delayed||0),failed:(coordination.failed||0)+(uploads.failed||0),coordination,uploads};
    }
    catch{return {backend:'BullMQ + Redis',unavailable:true};}
  }
  async stop() {await this.consumer?.close();await this.uploadConsumer?.close();await this.queue.close();await this.uploads.close();}
}
