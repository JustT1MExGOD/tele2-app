export function overallProgress(fact: Record<string,unknown>,plan: Record<string,unknown>) {
  const keys=Object.keys(plan).filter(k=>Number(plan[k])>0);
  if(!keys.length) return {pct:0,complete:false,planned:0};
  const ratios=keys.map(k=>Math.max(0,Number(fact[k])||0)/Number(plan[k]));
  return {pct:Math.round(ratios.reduce((s,x)=>s+Math.min(1,x),0)/keys.length*100),
    complete:ratios.every(x=>x>=1),planned:keys.length};
}
