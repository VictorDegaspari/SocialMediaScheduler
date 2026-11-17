import {test} from 'node:test';
import assert from 'node:assert/strict';

process.env.ENCRYPTION_KEY ||= '00'.repeat(32);
const {canRemovePreparedMedia}=await import('../src/media-cleanup.js');
const delivery={id:'00000000-0000-0000-0000-000000000000',engine:'local',status:'pending',post_id:null,local_file:null,session:null,upload_started_at:null};

test('preserva revisões, sessões interrompidas e uploads sem confirmação mesmo com ID remoto',()=>{
  for(const status of ['review','pending','retry','submitting','unknown']) {
    assert.equal(canRemovePreparedMedia({...delivery,status}),false,status);
    assert.equal(canRemovePreparedMedia({...delivery,status,post_id:'remote-id',browser_confirmed:true}),false,status+' com evidência inconsistente');
  }
  assert.equal(canRemovePreparedMedia({...delivery,status:'failed'}),false);
  assert.equal(canRemovePreparedMedia({...delivery,status:'cancelled',session:'encrypted-session'}),false);
  assert.equal(canRemovePreparedMedia({...delivery,status:'cancelled',upload_started_at:new Date()}),false);
});

test('confirmação da API libera a cópia, incluindo falha de processamento posterior',()=>{
  for(const status of ['processing','scheduled','published','private','unlisted','inbox','completed','failed']) {
    assert.equal(canRemovePreparedMedia({...delivery,status,post_id:'remote-id'}),true,status);
    assert.equal(canRemovePreparedMedia({...delivery,status}),false,status+' sem confirmação');
  }
});

test('agendamentos do navegador exigem confirmação do Studio ou conferência manual',()=>{
  for(const status of ['scheduled','completed']) {
    assert.equal(canRemovePreparedMedia({...delivery,engine:'browser',status}),false);
    assert.equal(canRemovePreparedMedia({...delivery,engine:'browser',status,browser_confirmed:true}),true);
    assert.equal(canRemovePreparedMedia({...delivery,engine:'browser',status,payload:{manualConfirmed:true}}),true);
  }
  assert.equal(canRemovePreparedMedia({...delivery,status:'duplicate'}),true);
  assert.equal(canRemovePreparedMedia({...delivery,status:'cancelled'}),true);
  assert.equal(canRemovePreparedMedia({...delivery,status:'cancelled',upload_started_at:new Date(),payload:{manualConfirmed:true}}),true);
  assert.equal(canRemovePreparedMedia({...delivery,engine:'postiz',status:'published',post_id:'remote-id'}),false);
});
