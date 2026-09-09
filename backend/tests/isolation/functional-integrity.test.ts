import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import {TestFixtures} from '../helpers/fixtures.js';
import {query,withTransaction} from '../../src/data/db/index.js';
import {applySaleUpsert} from '../../src/data/repositories/sales.js';
import {getEmployeeDailyPlan,upsertEmployeeMonthPlan,getMonthSummaryTable} from '../../src/core/plans/index.js';
import {overallProgress} from '../../src/core/shared/progress.js';
import {reportTime} from '../../src/cron/reports.js';
import {enqueueReportJobs,claimReportJob,finishReportJob} from '../../src/data/repositories/cron.js';

describe('Functional integrity regressions',()=>{
 const fx=new TestFixtures(); let org:string,store:string,employee:{id:number};
 const prefix=`integrity-${Date.now()}`;
 beforeAll(async()=>{org=await fx.createOrg();store=await fx.createStore(org);employee=await fx.createEmployee(org);});
 afterAll(async()=>{await query('DELETE FROM report_jobs WHERE key LIKE $1',[prefix+'%']);await fx.cleanup();});
 const sale=(date:string,metrics:Record<string,number>,key?:string)=>applySaleUpsert({employee_id:employee.id,store_id:store,sale_date:date,metrics,source:'sync',clientId:key});
 it('a failed transaction rolls back claim, fact, journals and XP; same key can be retried',async()=>{
   const key=prefix+'-rollback';
   const xp=Number((await query('SELECT xp FROM employees WHERE id=$1',[employee.id])).rows[0].xp || 0);
   await expect(withTransaction(async()=>{await sale('2026-08-01',{sim:3},key);throw new Error('simulated post-write failure');})).rejects.toThrow('simulated');
   expect((await query('SELECT 1 FROM offline_sync_log WHERE client_id=$1',[key])).rows).toHaveLength(0);
   expect((await query('SELECT 1 FROM sales WHERE employee_id=$1 AND sale_date=$2',[employee.id,'2026-08-01'])).rows).toHaveLength(0);
   expect(Number((await query('SELECT xp FROM employees WHERE id=$1',[employee.id])).rows[0].xp)).toBe(xp);
   expect(Number((await sale('2026-08-01',{sim:3},key)).row.sim)).toBe(3);
   expect((await sale('2026-08-01',{sim:3},key)).deduped).toBe(true);
   expect(Number((await query('SELECT xp FROM employees WHERE id=$1',[employee.id])).rows[0].xp)).toBe(xp+15);
   await expect(sale('2026-08-01',{sim:4},key)).rejects.toMatchObject({statusCode:409});
 });
 it('negative first write clamps at zero; audit records effective correction',async()=>{
   expect(Number((await sale('2026-08-02',{sim:-3})).row.sim)).toBe(0);
   await sale('2026-08-02',{sim:2});
   const correction=await sale('2026-08-02',{sim:-10});
   expect(Number(correction.row.sim)).toBe(0);
   expect(correction.applied).toEqual([{metric:'sim',value:-2}]);
   const totals=(await query(`SELECT SUM(delta)::int n FROM sales_audit WHERE employee_id=$1 AND sale_date=$2 AND metric='sim'`,[employee.id,'2026-08-02'])).rows[0];
   expect(Number(totals.n)).toBe(0);
 });
 it('invalid calendar dates and fractional quantities fail before a write',async()=>{
   await expect(sale('2026-02-30',{sim:1})).rejects.toMatchObject({statusCode:400});
   await expect(sale('2026-08-03',{sim:0.5})).rejects.toMatchObject({statusCode:400});
 });
 it('daily plan uses selected date, excludes that day from prior fact, and retains inactive history',async()=>{
   await upsertEmployeeMonthPlan(employee.id,'2026-08',{sim:100});
   await query(`INSERT INTO schedules(employee_id,store_id,work_date,hours,shift_text) VALUES($1,$2,'2026-08-10',8,'10-18'),($1,$2,'2026-08-11',8,'10-18')`,[employee.id,store]);
   await sale('2026-08-10',{sim:20});
   expect((await getEmployeeDailyPlan(employee.id,'2026-08-10')).plan.sim).toBe(49); // prior fact is 3; ceil(97/2)
   expect((await getEmployeeDailyPlan(employee.id,'2026-08-11')).plan.sim).toBe(77);
   const before=await getMonthSummaryTable('2026-08',org);
   await query('UPDATE employees SET is_active=false WHERE id=$1',[employee.id]);
   const after=await getMonthSummaryTable('2026-08',org);
   expect(after.totals.fact.sim).toBe(before.totals.fact.sim);
 });
 it('mixed units cannot hide an unfulfilled metric',()=>{
   const p=overallProgress({sim:0,phones:100000},{sim:10,phones:100000});
   expect(p.pct).toBe(50);expect(p.complete).toBe(false);
   expect(overallProgress({sim:1},{sim:0}).complete).toBe(false);
 });
 it('report times preserve minutes and reject impossible times',()=>{
   expect(reportTime('10:30')).toBe('10:30');expect(reportTime('9')).toBe('09:00');
   expect(reportTime('24:00')).toBeNull();expect(reportTime('10:60')).toBeNull();
 });
 it('report retry survives failed execution and completion prevents reclaim',async()=>{
   const key=prefix+'-report';
   await enqueueReportJobs([{key,due_at:'2026-01-01T00:00:00Z',payload:{kind:'test'}}]);
   let j=await claimReportJob();expect(j.key).toBe(key);
   await finishReportJob(key,j.attempts,'temporary');
   await query('UPDATE report_jobs SET next_attempt_at=now() WHERE key=$1',[key]);
   j=await claimReportJob();expect(j.attempts).toBe(2);
   await finishReportJob(key,j.attempts);
   expect(await claimReportJob()).toBeUndefined();
 });
});
