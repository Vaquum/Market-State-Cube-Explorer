// Synthetic eight-hour columns. Two opposite-side reports at one price preserve
// a known POC; deterministic independent price draws make outcomes nondegenerate.
export function evidenceFixture(days) {
  const cutoffIso = "2026-09-24T08:00:00Z", epoch = Date.parse("2021-01-01T00:00:00Z"), stop = Date.parse(cutoffIso)-epoch, step = 8*3600000;
  const first = Math.ceil((stop-days*86400000)/step), last = stop/step, trades=[];
  let random=123456789;
  for(let c=first;c<last;c++) {
    random=(Math.imul(random,1664525)+1013904223)>>>0;
    const price=(25000+(random%5-2)*125)*100, quantity=(1+c%3)*100000000, buy=[.2,.5,.8][Math.floor(c/3)%3];
    trades.push({t_ms:c*step+60000,price,qty:Math.round(quantity*buy),takerBuy:true},{t_ms:c*step+120000,price,qty:Math.round(quantity*(1-buy)),takerBuy:false});
  }
  return {name:`inference-${days}-days`,trades,cutoffIso};
}
