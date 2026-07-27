const { fromPreset } = await import('/Users/nsohiro/persona-forge/lib/persona.ts')
const roles = ['戦略家','批評家','読者','実行者','合意']
for (const key of ['stubborn','gentle']) {
  const p = fromPreset(key)
  const r = await fetch('http://localhost:3000/api/chat',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({persona:p,history:[],message:'ポートフォリオサイトを作りたい。どう進めればいい？'})}).then(r=>r.json())
  if (r.error) { console.log('ERR', r.error); process.exit(1) }
  const d = r.deliberation ?? ''
  const found = roles.filter(x => d.includes(x))
  console.log(`\n【${p.meta.name}】 議論 ${d.length}字  役割: ${found.join('/')} (${found.length}/5)`)
  console.log(`  返事の1行目: ${r.text.split('\n')[0].slice(0,70)}`)
  console.log(`  議論の冒頭 : ${d.slice(0,120).replace(/\n/g,' / ')}`)
}
