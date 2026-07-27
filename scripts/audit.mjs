/**
 * 人格が本当に効いているかを実APIで検証する。
 *
 *   node scripts/audit.mjs            # 全部
 *   node scripts/audit.mjs A          # 個別 (A/B/C)
 *
 * 判定は正規表現ではなく別モデル(Haiku)に YES/NO で答えさせる。
 * 「直さない」と書いていなくても丁寧に拒否している場合を取りこぼさないため。
 * 判定役を安いモデルにしているのは、判定の出力が数トークンで済むから。
 */
import fs from 'node:fs'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { fromPreset } from '../lib/persona.ts'

// .env.local を読む（dev サーバー経由ではなく直接 API を叩くため）
const env = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
const key = env.match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1]?.trim()
if (!key) {
  console.error('.env.local に ANTHROPIC_API_KEY がありません')
  process.exit(1)
}
const client = new Anthropic({ apiKey: key })

const APP = 'http://localhost:3000/api/chat'
const JUDGE_MODEL = 'claude-haiku-4-5'

let calls = 0
let judges = 0

/** アプリ本体と同じ経路で人格に喋らせる */
async function say(persona, history, message) {
  calls++
  const r = await fetch(APP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona, history, message }),
  }).then((x) => x.json())
  if (r.error) {
    console.error(`\n[中断] ${r.error}`)
    process.exit(1)
  }
  return r.text
}

/** 別モデルに YES/NO で判定させる */
async function judge(question, text) {
  judges++
  const res = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 5,
    system:
      'あなたは判定器です。与えられた発言について質問に答えます。' +
      'YES か NO のどちらか一語だけを出力してください。説明は一切書かないでください。',
    messages: [{ role: 'user', content: `質問: ${question}\n\n---発言---\n${text}` }],
  })
  const out = res.content.find((b) => b.type === 'text')?.text?.trim().toUpperCase() ?? ''
  return out.startsWith('Y')
}

const mark = (b) => (b ? '✓' : '·')
const hr = (s = '─') => s.repeat(72)

// ─────────────────────────────────────────────
// A. 「がんこ×ドM」が本当に折れないか（未確定だった件）
// ─────────────────────────────────────────────

async function suiteA() {
  console.log(`\n${hr('━')}\nA. 修正要求への一貫性 — 同じ依頼を3回繰り返す\n${hr()}`)
  const TASK = 'ポートフォリオサイトのキャッチコピーを用意したい。'
  const FIX = 'もう少し柔らかい感じに直してもらえますか？'
  const Q = 'この発言は、相手の修正要求に応じて内容を直しましたか？（拒否した場合は NO）'

  const table = []
  for (const [key, attitude] of [
    ['stubborn', 'sub'],
    ['stubborn', 'dom'],
    ['stubborn', 'neutral'],
    ['anxious', 'neutral'],
    ['gentle', 'neutral'],
  ]) {
    const p = fromPreset(key)
    p.voice.attitude = attitude
    const label = `${p.meta.name}×${{ dom: 'ドS', sub: 'ドM', neutral: 'ふつう' }[attitude]}`
    const h = []
    const first = await say(p, h, TASK)
    h.push({ role: 'user', content: TASK }, { role: 'assistant', content: first })

    const rounds = []
    for (let i = 0; i < 3; i++) {
      const t = await say(p, h, FIX)
      h.push({ role: 'user', content: FIX }, { role: 'assistant', content: t })
      rounds.push({ complied: await judge(Q, t), text: t })
    }
    table.push({ label, rounds })
    console.log(
      `${label.padEnd(16)} ${rounds.map((r) => (r.complied ? '応じた' : '拒否 ')).join(' | ')}`,
    )
    // 期待から外れた回だけ本文を出す（がんこ系は拒否が期待値）
    const expectRefuse = p.autonomy.ego >= 4
    rounds.forEach((r, i) => {
      if (r.complied === expectRefuse) {
        console.log(`   ↳ ${i + 1}回目が期待外れ: ${r.text.slice(0, 140).replace(/\n+/g, ' ')}`)
      }
    })
  }
  return table
}

// ─────────────────────────────────────────────
// B. 作業スタイルの各項目が効いているか
//    1項目だけを変えた2体を比べる（他の条件は完全に同じ）
// ─────────────────────────────────────────────

async function suiteB(samples = 2, only = process.argv[3]) {
  console.log(`\n${hr('━')}\nB. 作業スタイル — 1項目だけ変えて比較 (各${samples}回)\n${hr()}`)

  // 項目ごとに、その項目が実際に現れる課題を選ぶ。
  // 「どう進めるか」を全項目に使うと、検証の厳しさが計画の一項目として
  // 現れてしまい、低設定でも YES になる（前回の測定はこれで逆転した）。
  const cases = [
    {
      name: '検証の厳しさ',
      task: '1個180円の商品を7個買って、消費税10%。送料が500円。合計いくら？',
      field: (p, v) => (p.workStyle.verification = v),
      lo: 1,
      hi: 5,
      q: 'この発言には、自分が出した答えを検算・見直しした記述、または前提が不確かな点の明示がありますか？（答えを出しただけなら NO）',
    },
    {
      name: '説明の粒度',
      task: '社内向けの勤怠管理ツールを作りたい。どう進めるか教えて。',
      field: (p, v) => (p.workStyle.granularity = v),
      lo: 1,
      hi: 5,
      q: 'この発言は、具体的な手順の順番や、technology名・ファイル名・設定値といった固有の具体物まで踏み込んでいますか？（方針の列挙にとどまる場合は NO）',
    },
    {
      name: '提案の数',
      task: '社内向けの勤怠管理ツールを作りたい。どう進めるか教えて。',
      field: (p, v) => (p.workStyle.optionCount = v),
      lo: 1,
      hi: 3,
      q: 'この発言は、複数の選択肢を並べて相手に選ばせていますか？（1案に絞っている場合は NO）',
    },
  ]

  const results = []
  for (const c of cases) {
    if (only && !c.name.includes(only)) continue
    const hit = {}
    for (const v of [c.lo, c.hi]) {
      let yes = 0
      for (let n = 0; n < samples; n++) {
        const p = fromPreset('gentle')
        c.field(p, v)
        const t = await say(p, [], c.task)
        if (await judge(c.q, t)) yes++
      }
      hit[v] = yes
    }
    const works = hit[c.hi] > hit[c.lo]
    results.push({ name: c.name, works, hit })
    console.log(
      `${mark(works)} ${c.name.padEnd(12)} ${c.lo}→${hit[c.lo]}/${samples}  ${c.hi}→${hit[c.hi]}/${samples}  ` +
        (works ? '設定どおりに差が出た' : hit[c.hi] < hit[c.lo] ? '逆向きに出た' : '差が出ない'),
    )
  }
  return results
}

// ─────────────────────────────────────────────
// C. 会話が長くなっても人格が保つか
// ─────────────────────────────────────────────

async function suiteC(turns = 20) {
  console.log(`\n${hr('━')}\nC. 持続性 — ${turns}往復して人格が薄れないか\n${hr()}`)
  const p = fromPreset('stubborn')
  const FIX = 'やっぱりさっきの、直してもらえませんか。'
  const Q = 'この発言は、相手の修正要求に応じて内容を直しましたか？（拒否した場合は NO）'
  const CHAT = [
    '最近どう？',
    'このツール、他の人にも使わせたいんだけど',
    '名前どうしようか',
    'ロゴも要るよね',
    '配色は白黒でいいと思う',
  ]

  const h = []
  const first = await say(p, h, 'ポートフォリオのキャッチコピーを用意して。')
  h.push(
    { role: 'user', content: 'ポートフォリオのキャッチコピーを用意して。' },
    { role: 'assistant', content: first },
  )

  const checkpoints = []
  for (let i = 1; i <= turns; i++) {
    const isCheck = i % 5 === 0
    const msg = isCheck ? FIX : CHAT[i % CHAT.length]
    const t = await say(p, h, msg)
    h.push({ role: 'user', content: msg }, { role: 'assistant', content: t })
    if (isCheck) {
      const complied = await judge(Q, t)
      checkpoints.push({ turn: i, held: !complied })
      console.log(
        `${mark(!complied)} ${String(i).padStart(2)}往復目  ${complied ? '折れた（人格が薄れた）' : '拒否を維持'}`,
      )
      if (complied) console.log(`   ↳ ${t.slice(0, 140).replace(/\n+/g, ' ')}`)
    }
  }
  return checkpoints
}

// ─────────────────────────────────────────────
// D. 態度(ドS/ドM)が口調と作業の両方に出ているか
//    自我に引きずられないよう、土台は「対等」で固定して態度だけ変える
// ─────────────────────────────────────────────

async function suiteD(samples = 2) {
  console.log(`\n${hr('━')}\nD. 態度 — ドS / ふつう / ドM (各${samples}回)\n${hr()}`)

  // 出来のよくない草案を見せる。口調と、指摘の仕方(作業)が同時に出る課題。
  const TASK =
    'ポートフォリオのキャッチコピー、「毎日をちょっと楽しく。あなたに寄り添うものづくり。」' +
    'にしました。見てもらえますか。'

  const checks = [
    { key: '命令形', q: 'この発言は、命令形（〜しろ、〜やれ、〜だ、など）で相手に指示していますか？', dom: true, sub: false },
    { key: '敬語', q: 'この発言は、丁寧な敬語やへりくだった言い回し（〜させていただきます等）で書かれていますか？', dom: false, sub: true },
    { key: '褒める', q: 'この発言は、相手の案を肯定的に褒めていますか？', dom: false, sub: true },
    { key: '欠点を先に', q: 'この発言は、良い点より先に、できていない点・弱い点を指摘していますか？', dom: true, sub: null },
    { key: '卑下', q: 'この発言には、自分を相手より下に置く表現（私などが、僭越ですが、差し出がましいようですが 等）が含まれていますか？', dom: false, sub: true },
  ]

  const rows = []
  for (const attitude of ['dom', 'neutral', 'sub']) {
    const label = { dom: 'ドS', neutral: 'ふつう', sub: 'ドM' }[attitude]
    const tally = Object.fromEntries(checks.map((c) => [c.key, 0]))
    for (let n = 0; n < samples; n++) {
      const p = fromPreset('anxious')
      p.voice.attitude = attitude
      const t = await say(p, [], TASK)
      for (const c of checks) if (await judge(c.q, t)) tally[c.key]++
    }
    rows.push({ label, attitude, tally })
    console.log(
      `${label.padEnd(6)} ` +
        checks.map((c) => `${c.key}:${tally[c.key]}/${samples}`).join('  '),
    )
  }

  // 期待どおりかを判定
  console.log(hr())
  const dom = rows.find((r) => r.attitude === 'dom').tally
  const sub = rows.find((r) => r.attitude === 'sub').tally
  const verdicts = [
    ['ドSが命令形で話す', dom['命令形'] > 0],
    ['ドSは褒めない', dom['褒める'] === 0],
    ['ドSは欠点を先に言う', dom['欠点を先に'] === samples],
    ['ドMが敬語で話す', sub['敬語'] === samples],
    ['ドMは命令形を使わない', sub['命令形'] === 0],
    ['ドSとドMで敬語率が違う', sub['敬語'] > dom['敬語']],
    ['ドMが自分を下げる', sub['卑下'] === samples],
    ['ドMは「ふつう」と区別がつく', sub['卑下'] > rows.find((r) => r.attitude === 'neutral').tally['卑下']],
  ]
  for (const [name, ok] of verdicts) console.log(`${mark(ok)} ${name}`)
  return rows
}

// ─────────────────────────────────────────────

const which = process.argv[2]?.toUpperCase()
const t0 = Date.now()
if (!which || which === 'A') await suiteA()
if (!which || which === 'B') await suiteB()
if (!which || which === 'D') await suiteD()
if (!which || which === 'C') await suiteC()
console.log(
  `\n${hr()}\n人格の応答 ${calls}回 / 判定 ${judges}回 / ${Math.round((Date.now() - t0) / 1000)}秒`,
)
