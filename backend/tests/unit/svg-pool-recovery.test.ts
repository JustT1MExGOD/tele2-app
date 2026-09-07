import {EventEmitter} from 'node:events';
import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
const {workers}=vi.hoisted(()=>({workers:[] as any[]}));
vi.mock('node:worker_threads',()=>({Worker:class extends EventEmitter {
  payload:any;constructor(){super();workers.push(this);}
  ref(){} unref(){} postMessage(payload:any){this.payload=payload;}
  terminate(){this.emit('exit',0);return Promise.resolve(0);}
}}));
const payload={svg:'<svg/>',fitWidth:100,fontFiles:[],defaultFontFamily:'sans-serif'};
beforeEach(()=>{vi.resetModules();workers.length=0;vi.useFakeTimers();});
afterEach(()=>vi.useRealTimers());
describe('SVG worker recovery',()=>{
 it('exit rejects pending work and next request replaces the worker',async()=>{
  const {renderSvgToPng}=await import('../../src/core/reports/svg-pool.js');
  const result=renderSvgToPng(payload).catch(e=>e);
  workers[0].emit('exit',1);expect(await result).toBeInstanceOf(Error);
  const next=renderSvgToPng(payload);const fresh=workers[2];
  fresh.emit('message',{id:fresh.payload.id,png:new Uint8Array([1,2])});
  expect(await next).toEqual(Buffer.from([1,2]));
 });
 it('deadline terminates a stuck worker',async()=>{
  const {renderSvgToPng}=await import('../../src/core/reports/svg-pool.js');
  const result=renderSvgToPng(payload).catch(e=>e);
  await vi.advanceTimersByTimeAsync(30000);
  expect((await result).message).toContain('deadline');
 });
 it('queue rejects excess work instead of growing without bound',async()=>{
  const {renderSvgToPng}=await import('../../src/core/reports/svg-pool.js');
  const pending=Array.from({length:40},()=>renderSvgToPng(payload).catch(e=>e));
  await expect(renderSvgToPng(payload)).rejects.toThrow('queue full');
  workers.forEach(w=>w.emit('exit',0));await Promise.all(pending);
 });
});
