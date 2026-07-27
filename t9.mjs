const { fromPreset, displayName } = await import('/Users/nsohiro/persona-forge/lib/persona.ts')
// タメ口の人格(頑固, formality 1)で男女差を見る
for (const [g, h] of [['boy','くん'],['girl','さん']]) {
  const p = fromPreset('stubborn')
  p.identity.gender = g; p.meta.honorific = h
  const r = await fetch('http://localhost:3000/api/chat',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({persona:p,history:[],message:'週末どこか行こうと思うんだけど、どう思う？'})}).then(r=>r.json())
  if (r.error){console.log('ERR',r.error);process.exit(1)}
  console.log(`\n【頑固 / ${g==='boy'?'男の子':'女の子'}】表示名: ${displayName(p)}`)
  console.log(r.text.slice(0,200).replace(/\n+/g,'\n'))
}
