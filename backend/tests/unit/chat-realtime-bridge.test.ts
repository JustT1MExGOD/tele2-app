import {EventEmitter} from 'node:events';
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
const {clients,broadcast}=vi.hoisted(()=>({clients:[] as any[],broadcast:vi.fn()}));
vi.mock('../../src/core/chat/service.js',()=>({getRealtimeMessage:vi.fn(async(id:string)=>({id}))}));
vi.mock('pg',()=>({default:{Client:class extends EventEmitter {
  query=vi.fn().mockResolvedValue({});end=vi.fn().mockResolvedValue(undefined);
  connect=vi.fn().mockResolvedValue(undefined);
  constructor(){super();clients.push(this);}
}}}));
vi.mock('../../src/core/chat/realtime-registry.js',()=>({broadcastToOrg:broadcast}));
beforeEach(()=>{clients.length=0;broadcast.mockReset();vi.useFakeTimers();});
afterEach(()=>vi.useRealTimers());
describe('PostgreSQL chat notification bridge',()=>{
 it('subscribes, forwards an organization refresh, and ignores notifications after stop',async()=>{
  const {startChatRealtimeBridge}=await import('../../src/core/chat/realtime-bridge.js');
  const stop=startChatRealtimeBridge();await Promise.resolve();
  expect(clients[0].query).toHaveBeenCalledWith('LISTEN t2_chat_changed');
  clients[0].emit('notification',{channel:'t2_chat_changed',payload:JSON.stringify({orgId:'org-a',messageId:'12'})});
  await vi.advanceTimersByTimeAsync(0);
  expect(broadcast).toHaveBeenCalledWith('org-a',{type:'message',message:{id:'12'}});
  await stop();clients[0].emit('notification',{channel:'t2_chat_changed',payload:JSON.stringify({orgId:'org-a',messageId:'12'})});
  expect(broadcast).toHaveBeenCalledTimes(1);
 });
 it('reconnects once after an error and shutdown cancels retries',async()=>{
  const {startChatRealtimeBridge}=await import('../../src/core/chat/realtime-bridge.js');
  const stop=startChatRealtimeBridge();await Promise.resolve();
  clients[0].emit('error',new Error('connection lost'));clients[0].emit('end');
  await vi.advanceTimersByTimeAsync(5000);expect(clients).toHaveLength(2);
  clients[1].emit('error',new Error('lost again'));await stop();
  await vi.advanceTimersByTimeAsync(20000);expect(clients).toHaveLength(2);
 });
});
