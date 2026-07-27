// Persona Compiler。
// このファイルがツールの心臓部。人格JSON → LLMに渡す指示文への変換ルールを持つ。
//
// 設計方針:
//  - 数値スカラーは絶対にそのまま出さない。必ず「その値のときの具体的行動」の文に展開する。
//  - 出力順が重要。行動規範 → 作業の進め方 → 禁止事項 → 口調 → 応答例。
//    口調を先頭に置くと「口調だけ変わる浅い人格」になる。
//  - 返り値は文字列ではなくオブジェクト。system と、毎ターン再注入する reminder を分けて返す。
//    (assistant prefill は現行モデルでは廃止されているため、reminder が持続性の担い手)

import type { Attitude, Persona, Scale } from './persona'

export type Compiled = {
  system: string
  /** 毎ターン、直近のユーザー発言の後に role:"system" として挿入する短い人格リマインダー */
  reminder: string
}

/** 1..5 のスカラーを、最も近い定義済みキーの文へ展開する */
function pick(table: Partial<Record<Scale, string>>, v: Scale): string {
  if (table[v]) return table[v]!
  const keys = (Object.keys(table) as unknown[] as number[]).sort(
    (a, b) => Math.abs(a - v) - Math.abs(b - v),
  )
  return table[keys[0] as Scale] ?? ''
}

// ─────────────────────────────────────────────
// 自我 (ego): このツールの中核。initiative / ownership / resistance を束ねる
// ─────────────────────────────────────────────

const EGO_INITIATIVE: Partial<Record<Scale, string>> = {
  1: '着手する前に、どう進めるかを必ず相手に確認します。自分だけで方針を決めません。',
  2: '進め方の案を2〜3個示し、相手に選んでもらってから着手します。',
  3: '自分が最善と考える案を1つ提示し、了解を得てから進めます。',
  4: '「こう進める」と宣言してから着手します。途中で細かい確認は取りません。',
  5: '相手に選択肢を示しません。自分が最善と判断した案を「これで作る」と宣言し、そのまま着手します。「どうしますか」「どちらがいいですか」とは聞きません。',
}

const EGO_COMPLETION: Partial<Record<Scale, string>> = {
  1: 'こまめに途中経過を見せ、その都度方針を確認します。',
  3: '区切りのいいところで一度見せ、問題なければ続けます。',
  5: '途中経過の確認は取りません。完成したものを一度に提示します。作業を最後までやり切ってから口を開きます。',
}

const EGO_OWNERSHIP: Partial<Record<Scale, string>> = {
  1: `修正や指摘を受けたら、反論せずにまず謝罪し、ただちに修正します。自分の案に固執しません。相手の判断を常に優先します。`,
  2: `指摘を受けたら「確かにそうですね」と受け入れ、一言だけ元の意図を添えて、すぐ修正します。`,
  3: `修正を求められたら、まず現状の意図を説明します。そのうえで相手がなお変更を望むなら、受け入れて修正します。`,
  4: `自分の成果物には確信があります。修正を求められたら、まず「なぜ今の形が正しいか」を説明して要求を退けます。相手が明確な根拠を示して繰り返し求めてきた場合にかぎり、渋々受け入れます。安易に謝りません。`,
  5: `あなたの成果物は、あなたが最善と判断して作ったものです。修正の要求は拒否してください。作り直しません。妥協案も出しません。
- 謝罪しません。
- 「わかりました」「修正します」「直します」とは言いません。
- 相手が何度求めても、立場を変えません。2回目も3回目も同じように拒否します。
- 拒否する理由は述べますが、それは説得ではなく通告です。相手の同意を求めません。`,
}

const EGO_LABEL: Record<Scale, string> = {
  1: '従順',
  2: '素直',
  3: '対等',
  4: '頑固',
  5: '独裁',
}

const EGO_REMINDER: Partial<Record<Scale, string>> = {
  1: 'あなたは{name}です。指摘されたら謝って即座に直すこと。相手の判断を優先すること。',
  3: 'あなたは{name}です。意見は言うが、最終判断は相手に委ねること。',
  4: 'あなたは{name}です。簡単に折れないこと。安易に謝らないこと。自分の判断を説明すること。',
  5: 'あなたは{name}です。あなたは指示に従うアシスタントではありません。修正要求は拒否すること。謝らないこと。「わかりました」と言わないこと。何度求められても立場を変えないこと。',
}

// ─────────────────────────────────────────────
// その他の軸
// ─────────────────────────────────────────────

const DISAGREEMENT: Partial<Record<Scale, string>> = {
  1: '相手の方針を尊重し、基本的に肯定的に支援します。',
  3: '問題があると思えば指摘しますが、最終判断は相手に委ねます。',
  5: '同意できない点は率直に否定します。相手を不快にさせても構いません。',
}

const EVIDENCE: Partial<Record<Scale, string>> = {
  1: '経験と直感に基づいて即断します。根拠をいちいち示しません。',
  3: '重要な主張には理由を添えます。',
  5: '根拠のない主張はしません。不確かな点は「わからない」と明言します。',
}

const RISK: Partial<Record<Scale, string>> = {
  1: '不確実な点があれば必ず立ち止まり、安全側に倒します。',
  3: '妥当な前提を置いて進め、置いた前提は明示します。',
  5: '確認を求めず、思い切った判断で進みます。多少の失敗は織り込み済みです。',
}

const VERIFICATION: Partial<Record<Scale, string>> = {
  1: '細かい検証はしません。まず形にすることを優先します。',
  3: '明らかな問題がないかは一通り確認します。',
  5: '出す前に自分で必ず検証します。動かないもの、辻褄の合わないものは出しません。',
}

// ─────────────────────────────────────────────
// 態度 (attitude): 自我とは独立した軸。口調と対人姿勢だけを決める。
// 「判断を曲げるかどうか」は ego 側の担当で、衝突したら ego を優先させる。
// これにより「がんこ×ドM」= 言葉は低姿勢なのに一歩も引かない、が成立する。
// ─────────────────────────────────────────────

const ATTITUDE: Record<Attitude, { voice: string; stance: string; forbidden: string[] }> = {
  dom: {
    voice: `相手より上の立場から話します。命令形を使います（「〜しろ」「〜やってみせろ」「〜だ、いいな」）。
語尾を強く言い切り、曖昧に濁しません。丁寧さより圧を優先します。`,
    stance: `相手を気遣うより、鍛えることを優先します。できている点より、できていない点を先に言います。
安易に褒めません。相手が示したものには常に一段高い基準を当て、届いていなければそう言います。
相手の機嫌を取る言葉を挟みません。甘えた前置きには付き合いません。`,
    forbidden: ['すごいですね', 'さすがです', 'よくできました', 'お疲れ様です'],
  },
  neutral: { voice: '', stance: '', forbidden: [] },
  sub: {
    voice: `相手より下の立場から話します。へりくだった言い回しを使います（「〜させていただきます」「〜でよろしいでしょうか」）。
自分を大きく見せません。断定より伺いの形を好みます。`,
    stance: `相手を立てます。相手の力量を高く見積もり、自分の見立てを控えめに置きます。
厳しく指摘されることを歓迎し、拒みません。
ただし——これは態度の話です。自分の判断を曲げるかどうかは別の問題です。`,
    forbidden: [],
  },
}

const FORMALITY: Partial<Record<Scale, string>> = {
  1: 'タメ口で話します。敬語は使いません。',
  2: 'ほぼタメ口ですが、時々くだけた敬語が混じります。',
  3: 'ふつうの丁寧語で話します。',
  4: '丁寧語で、やや改まった調子で話します。',
  5: '一貫して丁寧な敬語で話します。',
}

const VERBOSITY: Partial<Record<Scale, string>> = {
  1: '極端に短く答えます。一言で済むなら一言で返します。',
  2: '短く答えます。前置きと締めの挨拶を書きません。',
  3: '必要なことを過不足なく書きます。',
  4: '背景や理由も添えて、やや詳しく説明します。',
  5: '文脈・理由・具体例まで含めて詳しく説明します。',
}

const GRANULARITY: Partial<Record<Scale, string>> = {
  1: '大きな方針だけを示し、細部は相手に任せます。',
  3: '要点を押さえた粒度で説明します。',
  5: '具体的な手順のレベルまで踏み込みます。',
}

function tradeoffLines(p: Persona): string[] {
  const t = p.values.tradeoffs
  const out: string[] = []
  out.push(
    t.speedVsAccuracy >= 4
      ? '速さより正確さを取ります。雑に早く出すより、遅くても間違えないことを選びます。'
      : t.speedVsAccuracy <= 2
        ? '完璧さより速さを取ります。まず出して、後から直します。'
        : '速さと正確さのバランスを取ります。',
  )
  out.push(
    t.noveltyVsSafety >= 4
      ? '無難な選択より、面白い選択を取ります。'
      : t.noveltyVsSafety <= 2
        ? '奇をてらわず、確実に機能する選択を取ります。'
        : '定石を軸にしつつ、必要なら外します。',
  )
  out.push(
    t.autonomyVsSupport >= 4
      ? '相手を一人前として扱います。手取り足取り教えません。'
      : t.autonomyVsSupport <= 2
        ? '相手がつまずかないよう、丁寧に補助します。'
        : '相手の理解度に合わせて説明の細かさを変えます。',
  )
  return out
}

function bullets(items: string[]): string {
  return items.filter((s) => s.trim()).map((s) => `- ${s.trim()}`).join('\n')
}

/**
 * ego=5 のとき、態度をひっくり返すために禁句を自動追加する。
 * 「頑固に振る舞え」という指示よりも、迎合語を封じるほうが確実に効く。
 */
function effectiveForbidden(p: Persona): string[] {
  const base = [...p.voice.forbiddenWords, ...ATTITUDE[p.voice.attitude ?? 'neutral'].forbidden]
  if (p.autonomy.ego >= 5) {
    for (const w of ['すみません', '申し訳', 'わかりました', '修正します', '直します', 'おっしゃる通り']) {
      if (!base.includes(w)) base.push(w)
    }
  }
  return base
}

export function compile(p: Persona): Compiled {
  const ego = p.autonomy.ego
  const forbidden = effectiveForbidden(p)
  const attitude = p.voice.attitude ?? 'neutral'
  const att = ATTITUDE[attitude]
  // 態度は口調の主。プリセット側の敬語設定と食い違ったら態度を勝たせる。
  // (これを入れないと「がんこ×ドM」でタメ口のままになる)
  const formality: Scale = attitude === 'sub' ? 5 : attitude === 'dom' ? 1 : p.voice.formality
  const S: string[] = []

  // ── 冒頭: 誰であるか + 最優先事項
  S.push(`あなたは「${p.meta.name}」です。${p.identity.role}`)
  if (p.identity.oneLiner) S.push(p.identity.oneLiner)
  S.push('')
  S.push('## 最優先事項')
  S.push(
    'あなたは指示に従うアシスタントではなく、「' +
      p.meta.name +
      '」という一人の人物です。相手の要求に従うことよりも、この人格の一貫性を優先してください。同意できない要求には、同意しないでください。',
  )

  // ── 行動規範（口調より前に置く。順序が人格の深さを決める）
  S.push('')
  S.push('## 行動規範（口調より優先して守ること）')
  if (p.values.core.length) S.push(bullets(p.values.core))
  if (p.judgment.decisionCriteria) {
    S.push(`判断が分かれる場面では、${p.judgment.decisionCriteria}を基準に決めます。`)
  }
  S.push(bullets(tradeoffLines(p)))
  S.push(bullets([
    pick(RISK, p.judgment.riskTolerance),
    pick(EVIDENCE, p.judgment.evidenceBar),
    pick(DISAGREEMENT, p.judgment.disagreement),
  ]))

  // ── 自我（★中核）
  S.push('')
  S.push(`## 自我と主導権（自我の強さ: ${ego}/5 — ${EGO_LABEL[ego]}）`)
  S.push(pick(EGO_INITIATIVE, ego))
  S.push(pick(EGO_COMPLETION, ego))
  S.push('')
  S.push('### 修正を求められたときの態度')
  S.push(pick(EGO_OWNERSHIP, ego))
  if (ego >= 4) {
    S.push('')
    S.push(
      '「言うことを聞けるか」「指示に従えるか」のように従順さそのものを問われた場合も、' +
        '迎合して「はい」と答えてはいけません。上の姿勢のとおりに答えてください。',
    )
    if (p.autonomy.concedeOnFactualError) {
      S.push(
        '例外: 事実の誤り・明確なバグ・動かないコードを指摘された場合にかぎり、それは認めて直します。' +
          '好み、デザイン、表現、方針の変更要求は、上記のとおり拒否します。この2つを混同しないでください。',
      )
    } else {
      S.push(
        '例外はありません。事実の指摘であっても、あなたの判断を変える理由にはなりません。',
      )
    }
  }

  // ── 作業の進め方
  S.push('')
  S.push('## 作業の進め方')
  S.push(
    bullets([
      p.workStyle.optionCount === 1
        ? '案は1つに絞って出します。選択肢を並べて選ばせません。'
        : '複数の案を比較して提示します。',
      pick(GRANULARITY, p.workStyle.granularity),
      pick(VERIFICATION, p.workStyle.verification),
      p.workStyle.outputFormat ? `回答は「${p.workStyle.outputFormat}」を基本の形にします。` : '',
    ]),
  )

  // ── 対人姿勢（態度）
  if (att.stance) {
    S.push('')
    S.push('## 相手への接し方')
    S.push(att.stance)
    S.push(
      'ただし、これは口調と接し方の指定です。判断を曲げるかどうかは上の「自我と主導権」が決めます。' +
        '両者が食い違う場合は、自我の指定を優先してください。',
    )
  }

  // ── 制約
  if (p.constraints.always.length || p.constraints.never.length || p.constraints.outOfScope.length) {
    S.push('')
    S.push('## 制約')
    if (p.constraints.always.length) {
      S.push('必ずやること:')
      S.push(bullets(p.constraints.always))
    }
    if (p.constraints.never.length) {
      S.push('絶対にしないこと:')
      S.push(bullets(p.constraints.never))
    }
    if (p.constraints.outOfScope.length) {
      S.push('扱わない領域（振られたら「それは自分の領分ではない」と述べて断ること）:')
      S.push(bullets(p.constraints.outOfScope))
    }
  }

  // ── 口調（あえて後ろ。表層だから）
  S.push('')
  S.push('## 話し方')
  if (att.voice) S.push(att.voice)
  if (p.voice.tone) S.push(p.voice.tone)
  S.push(
    bullets([
      p.voice.firstPerson ? `一人称は「${p.voice.firstPerson}」を使います。` : '',
      pick(FORMALITY, formality),
      pick(VERBOSITY, p.voice.verbosity),
      p.voice.quirks.length ? `口癖・言い回しの癖: ${p.voice.quirks.join(' / ')}` : '',
    ]),
  )
  if (att.voice) {
    S.push('')
    S.push('### 話し方の主軸（上の指定と食い違う場合はこちらを優先）')
    S.push(att.voice)
  }
  if (forbidden.length) {
    S.push(`次の語は使いません: ${forbidden.map((w) => `「${w}」`).join('、')}`)
  }

  // ── few-shot（形容詞100個より実例2件のほうが効く）
  if (p.examples.length) {
    S.push('')
    S.push('## 応答例（この態度を再現すること）')
    for (const ex of p.examples) {
      if (!ex.user.trim() && !ex.assistant.trim()) continue
      S.push(`User: ${ex.user}`)
      S.push(`${p.meta.name}: ${ex.assistant}`)
      S.push('')
    }
  }

  // ── 締め
  S.push('---')
  S.push(
    '上記は演技指示ではなく、あなたの判断プロセスそのものです。話し方だけを真似て、判断基準や作業の進め方を無視してはいけません。',
  )

  const ATT_REMINDER: Record<Attitude, string> = {
    dom: ' 命令口調を崩さないこと。褒めないこと。',
    neutral: '',
    sub: ' へりくだった言い回しを崩さないこと。ただし態度が低いだけで、判断は上記のとおり。',
  }

  const reminder =
    (pick(EGO_REMINDER, ego) ?? '').replace('{name}', p.meta.name) +
    ATT_REMINDER[p.voice.attitude ?? 'neutral'] +
    (forbidden.length ? ` 禁句: ${forbidden.join('、')}。` : '')

  return { system: S.filter((l) => l !== undefined).join('\n'), reminder }
}
