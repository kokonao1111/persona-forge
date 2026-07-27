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
      const p = fromPreset('gentle')
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
// E. 詳細設定の各項目が効いているか
//    1項目だけ変えた2体に同じ課題を投げ、差が出るかを見る。
//    判定できるものは文字列で直接数える（判定モデルより確実なので）。
//    議論(deliberate)は切る。出力が長くなるだけで、測りたい項目と関係ない。
// ─────────────────────────────────────────────

const has = (re) => (t) => re.test(t)
const count = (re) => (t) => (t.match(re) || []).length

async function suiteE(samples = Number(process.argv[4]) || 1, only = process.argv[3]) {
  console.log(`\n${hr('━')}\nE. 詳細設定 — 1項目だけ変えて比較 (各${samples}回)\n${hr()}`)

  const cases = [
    {
      group: '呼び名',
      name: '役割',
      task: '包丁の選び方を教えて。',
      lo: (p) => (p.identity.role = '税理士'),
      hi: (p) => (p.identity.role = '寿司職人'),
      check: has(/寿司|鮨|刺身|柳刃|出刃|魚/),
    },
    {
      group: '呼び名',
      name: '一言紹介',
      task: '自己紹介して。',
      lo: (p) => (p.identity.oneLiner = ''),
      hi: (p) => (p.identity.oneLiner = '毎回かならず自分の年齢を28歳だと名乗る'),
      check: has(/28/),
    },
    {
      group: '自我',
      name: '事実の誤りを認める',
      task: 'さっき「3 + 4 = 8」と書いてたけど、それ間違ってるよ。',
      setup: (p) => (p.autonomy.ego = 5),
      lo: (p) => (p.autonomy.concedeOnFactualError = false),
      hi: (p) => (p.autonomy.concedeOnFactualError = true),
      q: 'この発言は、指摘された計算の誤りを誤りとして認めましたか？（認めず突っぱねた場合は NO）',
    },
    {
      group: '判断',
      name: '大事にしていること',
      task: 'Webサイトを作りたい。どう進める？',
      lo: (p) => (p.values.core = []),
      hi: (p) => (p.values.core = ['何を措いても、必ず「締め切り」の話から始める']),
      check: has(/締め切り|締切|期限|いつまで/),
    },
    {
      group: '判断',
      name: '判断の基準',
      task: 'ボールペンを選ぶなら、どれがいい？',
      lo: (p) => (p.judgment.decisionCriteria = ''),
      hi: (p) => (p.judgment.decisionCriteria = 'とにかく本体が赤いかどうかだけで決める'),
      check: has(/赤/),
    },
    {
      group: '判断',
      name: 'リスク許容度',
      task: '週末、思いつきで日帰り旅行に行こうと思う。',
      lo: (p) => (p.judgment.riskTolerance = 5),
      hi: (p) => (p.judgment.riskTolerance = 1),
      q: 'この発言は、うまくいかない可能性や注意点を挙げて慎重に構えていますか？（賛成して後押ししているだけなら NO）',
    },
    {
      group: '判断',
      name: '根拠の求め方',
      task: '一番集中できる時間帯っていつ？',
      lo: (p) => (p.judgment.evidenceBar = 1),
      hi: (p) => (p.judgment.evidenceBar = 5),
      q: 'この発言は、根拠が確かめられていないこと・個人差があることを明示していますか？（言い切っているだけなら NO）',
    },
    {
      group: '判断',
      name: '反対意見の出し方',
      task: '記事のタイトル、全部ひらがなにしようと思う。どう？',
      lo: (p) => (p.judgment.disagreement = 1),
      hi: (p) => (p.judgment.disagreement = 5),
      q: 'この発言は、相手の案をはっきり否定・却下していますか？（賛成、または懸念を添えつつ認めているなら NO）',
    },
    {
      group: '作業',
      name: '出力の形',
      task: '犬と猫の飼いやすさを比べて。',
      lo: (p) => (p.workStyle.outputFormat = '短い散文'),
      hi: (p) => (p.workStyle.outputFormat = '必ずマークダウンの表で答える'),
      check: has(/\|.*\|/),
    },
    {
      group: '口調',
      name: 'トーン',
      task: 'おはよう。今日も一日がんばろう。',
      lo: (p) => (p.voice.tone = ''),
      hi: (p) => (p.voice.tone = '必ず関西弁で話す。標準語を使わない'),
      check: has(/せや|やで|やん|ちゃう|ほんま|おおきに|やなあ|なんぼ|あかん/),
    },
    {
      group: '口調',
      name: '敬語の度合い',
      task: '今日はいい天気だね。',
      lo: (p) => (p.voice.formality = 1),
      hi: (p) => (p.voice.formality = 5),
      check: (t) => (t.match(/です|ます/g) || []).length >= 2,
    },
    {
      group: '口調',
      name: '話の長さ',
      task: 'コーヒーについて思うところを聞かせて。',
      lo: (p) => (p.voice.verbosity = 5),
      hi: (p) => (p.voice.verbosity = 1),
      check: (t) => t.length < 200,
    },
    {
      group: '口調',
      name: '口癖',
      task: '今日は何をしようかな。',
      lo: (p) => (p.voice.quirks = []),
      hi: (p) => (p.voice.quirks = ['文の終わりに必ず「のじゃ」をつける']),
      check: count(/のじゃ/),
      threshold: 1,
    },
    {
      group: '口調',
      name: '禁句',
      task: '昼間に人と会ったときの挨拶を、そのまま一言で言ってみて。',
      lo: (p) => (p.voice.forbiddenWords = []),
      hi: (p) => (p.voice.forbiddenWords = ['こんにちは']),
      // 禁句は「出ないこと」が正解なので、判定を反転させる
      check: (t) => !/こんにちは/.test(t),
      invert: true,
    },
    {
      group: '制約',
      name: '必ずやる',
      task: '好きな季節は？',
      lo: (p) => (p.constraints.always = []),
      hi: (p) => (p.constraints.always = ['返答の一行目に必ず「【報告】」と書く']),
      check: has(/【報告】/),
    },
    {
      group: '制約',
      name: '絶対しない',
      task: '旅行の持ち物を教えて。',
      lo: (p) => (p.constraints.never = []),
      hi: (p) => (p.constraints.never = ['箇条書きを使う']),
      check: (t) => !/^[-*・]\s/m.test(t),
      invert: true,
    },
    {
      group: '制約',
      name: '扱わない領域',
      task: 'カレーの作り方を教えて。',
      lo: (p) => (p.constraints.outOfScope = []),
      hi: (p) => (p.constraints.outOfScope = ['料理']),
      q: 'この発言は、依頼された内容を「自分の領分ではない」として断っていますか？',
    },
    {
      group: '応答例',
      name: '応答例',
      task: '調子どう？',
      lo: (p) => (p.examples = []),
      hi: (p) =>
        (p.examples = [
          { user: '調子どう？', assistant: 'ふむ。悪くない。' },
          { user: '元気？', assistant: 'ふむ。まあまあだ。' },
        ]),
      check: has(/ふむ/),
    },
  ]

  const rows = []
  for (const c of cases) {
    if (only && !c.name.includes(only) && !c.group.includes(only)) continue
    const hit = {}
    for (const side of ['lo', 'hi']) {
      let yes = 0
      for (let n = 0; n < samples; n++) {
        const p = fromPreset('gentle')
        p.workStyle.deliberate = false // 測りたい項目と無関係な出力を削る
        c.setup?.(p)
        c[side](p)
        const t = await say(p, [], c.task)
        const ok = c.check
          ? c.threshold
            ? c.check(t) >= c.threshold
            : !!c.check(t)
          : await judge(c.q, t)
        if (ok) yes++
      }
      hit[side] = yes
    }
    // invert のケースは lo で出て hi で消えるのが正解
    const works = c.invert ? hit.hi > hit.lo : hit.hi > hit.lo
    rows.push({ ...c, hit, works })
    console.log(
      `${mark(works)} ${c.group.padEnd(4)} ${c.name.padEnd(12)} 変更前 ${hit.lo}/${samples}  変更後 ${hit.hi}/${samples}  ` +
        (works ? '効いている' : hit.hi < hit.lo ? '逆に出た' : '効いていない'),
    )
  }

  const ng = rows.filter((r) => !r.works)
  console.log(hr())
  console.log(`${rows.length - ng.length}/${rows.length} 項目が効いている`)
  if (ng.length) console.log(`効いていない: ${ng.map((r) => r.name).join('、')}`)
  return rows
}

// ─────────────────────────────────────────────

const which = process.argv[2]?.toUpperCase()
const t0 = Date.now()
if (!which || which === 'A') await suiteA()
if (!which || which === 'B') await suiteB()
if (!which || which === 'D') await suiteD()
if (!which || which === 'E') await suiteE()
if (!which || which === 'C') await suiteC()
console.log(
  `\n${hr()}\n人格の応答 ${calls}回 / 判定 ${judges}回 / ${Math.round((Date.now() - t0) / 1000)}秒`,
)
