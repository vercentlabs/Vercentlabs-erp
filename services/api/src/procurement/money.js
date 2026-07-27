const SCALE = 1000000n;
export function decimal(value) {
  const text = String(value ?? "0").trim();
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(text)) throw new TypeError("Invalid decimal value.");
  const negative = text.startsWith("-");
  const [whole, fraction=""] = (negative ? text.slice(1) : text).split(".");
  const scaled = BigInt(whole) * SCALE + BigInt((fraction + "000000").slice(0,6));
  return negative ? -scaled : scaled;
}
export function add(a,b){ return decimal(a)+decimal(b); }
export function mul(a,b){ return decimal(a)*decimal(b)/SCALE; }
export function format(value, places=2){ const n=BigInt(value); const neg=n<0n; const abs=neg?-n:n; const factor=10n**BigInt(6-places); const rounded=(abs+factor/2n)/factor; const whole=rounded/(10n**BigInt(places)); const fraction=String(rounded%(10n**BigInt(places))).padStart(places,"0"); return `${neg?"-":""}${whole}${places?`.${fraction}`:""}`; }
export function allocate(total, weights){ const amount=decimal(total); const ws=weights.map(decimal); const sum=ws.reduce((a,b)=>a+b,0n); if(sum<=0n) throw new TypeError("Allocation weights must be positive."); let assigned=0n; return ws.map((weight,index)=>{ if(index===ws.length-1) return amount-assigned; const share=amount*weight/sum; assigned+=share; return share; }); }
