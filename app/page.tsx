'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { compile } from '@/lib/compile'
import { PRESETS, fromPreset, stamp, type Persona, type Scale } from '@/lib/persona'

const STORE_KEY = 'persona-forge/v2'
const EGO_LABEL = ['', '従順', '素直', '対等', '頑固', '独裁']

type Turn = { role: 'user' | 'assistant'; content: string }
type Screen = 'setup' | 'chat'

export default function Page() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [screen, setScreen] = useState<Screen>('setup')
  // 会話は人格ごとに保持する。設定画面に戻って直しても消えない。
  const [conversations, setConversations] = useState<Record<string, Turn[]>>({})

  useEffect(() => {
    const raw = localStorage.getItem(STORE_KEY)
    let list: Persona[] = []
    if (raw) {
      try {
        list = JSON.parse(raw)
      } catch {
        list = []
      }
    }
    // 3つの人格は常に揃っている状態にする（増やしたり消したりはしない）
    if (list.length !== PRESETS.length) list = PRESETS.map((p) => fromPreset(p.key))
    setPersonas(list)
    setActiveId(list[1]?.id ?? list[0]?.id ?? null) // 既定は「対等」
    setLoaded(true)
  }, [])

  useEffect(() => {
    if (loaded) localStorage.setItem(STORE_KEY, JSON.stringify(personas))
  }, [personas, loaded])

  const active = personas.find((p) => p.id === activeId) ?? null

  function update(fn: (p: Persona) => Persona) {
    if (!active) return
    setPersonas((prev) => prev.map((p) => (p.id === active.id ? stamp(fn(p)) : p)))
  }

  /** 詳細設定をいじった人格を、選んだときの初期状態に戻す */
  function reset(id: string) {
    const p = personas.find((x) => x.id === id)
    if (!p?.meta.basePreset) return
    const fresh = fromPreset(p.meta.basePreset)
    setPersonas((prev) => prev.map((x) => (x.id === id ? { ...fresh, id } : x)))
  }

  if (!loaded) return <div className="p-8 text-sm opacity-60">読み込み中…</div>

  if (screen === 'chat' && active) {
    return (
      <ChatScreen
        persona={active}
        turns={conversations[active.id] ?? []}
        setTurns={(t) => setConversations((prev) => ({ ...prev, [active.id]: t }))}
        onBack={() => setScreen('setup')}
      />
    )
  }

  return (
    <SetupScreen
      personas={personas}
      active={active}
      setActiveId={setActiveId}
      update={update}
      reset={reset}
      hasConversation={!!(active && (conversations[active.id]?.length ?? 0) > 0)}
      onConfirm={() => setScreen('chat')}
    />
  )
}

// ── 画面1: 人格を選ぶ ─────────────────────────

function SetupScreen({
  personas,
  active,
  setActiveId,
  update,
  reset,
  hasConversation,
  onConfirm,
}: {
  personas: Persona[]
  active: Persona | null
  setActiveId: (id: string) => void
  update: (fn: (p: Persona) => Persona) => void
  reset: (id: string) => void
  hasConversation: boolean
  onConfirm: () => void
}) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const compiled = useMemo(() => (active ? compile(active) : null), [active])

  return (
    <div className="h-dvh w-full overflow-y-auto bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="text-xl font-semibold">どの性格で話しますか？</h1>
        <p className="mt-1 text-sm opacity-50">
          口調だけでなく、判断の仕方と、修正を求めたときの態度が変わります。
        </p>

        {/* 3択 */}
        <div className="mt-6 space-y-3">
          {personas.map((p) => {
            const preset = PRESETS.find((x) => x.key === p.meta.basePreset)
            const selected = p.id === active?.id
            return (
              <button
                key={p.id}
                onClick={() => setActiveId(p.id)}
                className={`flex w-full items-start gap-4 rounded-xl border p-4 text-left transition ${
                  selected
                    ? 'border-amber-400 bg-amber-500/10'
                    : 'border-neutral-800 hover:border-neutral-600 hover:bg-neutral-900'
                }`}
              >
                <span className="text-3xl leading-none">{p.meta.emoji}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-base font-semibold">{p.meta.name}</span>
                    {selected && (
                      <span className="rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-neutral-900">
                        選択中
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-sm opacity-60">{p.identity.oneLiner}</span>
                  <span className="mt-2 block text-xs">
                    <span className="opacity-40">修正を求めると：</span>
                    <span
                      className={selected ? 'text-amber-300' : 'opacity-80'}
                    >{` ${preset?.onRevision ?? ''}`}</span>
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        {/* 確定 */}
        <button
          onClick={onConfirm}
          disabled={!active}
          className="mt-6 w-full rounded-xl bg-neutral-100 px-5 py-3.5 text-base font-semibold text-neutral-900 hover:bg-white disabled:opacity-40"
        >
          {active ? `${active.meta.emoji} ${active.meta.name} で話す →` : '性格を選んでください'}
        </button>
        {hasConversation && (
          <p className="mt-2 text-center text-xs opacity-40">前回の会話の続きから話します</p>
        )}

        {/* 詳細設定（既定で閉じている） */}
        <div className="mt-10 border-t border-neutral-800 pt-4">
          <button
            onClick={() => setDetailOpen((v) => !v)}
            className="flex items-center gap-2 text-xs opacity-50 hover:opacity-100"
          >
            <span>{detailOpen ? '▾' : '▸'}</span>
            詳細設定（自分で作り込みたい人だけ）
          </button>

          {detailOpen && active && (
            <div className="mt-4">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setPromptOpen((v) => !v)}
                  className="rounded border border-neutral-800 px-2.5 py-1.5 text-xs opacity-70 hover:bg-neutral-800 hover:opacity-100"
                >
                  {promptOpen ? 'プロンプトを隠す' : '生成されるプロンプトを見る'}
                </button>
                <button
                  onClick={() => reset(active.id)}
                  className="rounded border border-neutral-800 px-2.5 py-1.5 text-xs opacity-70 hover:bg-neutral-800 hover:opacity-100"
                >
                  この性格を初期状態に戻す
                </button>
              </div>

              {promptOpen && compiled && (
                <div className="mb-4 max-h-96 overflow-hidden rounded-lg border border-neutral-800">
                  <PromptView system={compiled.system} reminder={compiled.reminder} />
                </div>
              )}

              <Editor persona={active} update={update} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── 画面2: チャット ───────────────────────────

function ChatScreen({
  persona,
  turns,
  setTurns,
  onBack,
}: {
  persona: Persona
  turns: Turn[]
  setTurns: (t: Turn[]) => void
  onBack: () => void
}) {
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [turns, busy])

  async function send() {
    const raw = input.trim()
    if (!raw || busy) return

    // 脱出ハッチ。人格レイヤーの外側にあるので、絶対に折れない人格でも解除できる。
    const override = raw.startsWith('/override')
    const message = override ? raw.replace(/^\/override\s*/, '') : raw

    setInput('')
    setErr(null)
    const history = turns
    setTurns([...turns, { role: 'user', content: raw }])
    setBusy(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona, history, message, override }),
      })
      const data = await res.json()
      if (data.error) setErr(data.error)
      else setTurns([...history, { role: 'user', content: raw }, { role: 'assistant', content: data.text }])
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      <header className="flex shrink-0 items-center gap-3 border-b border-neutral-800 px-4 py-2.5">
        <button
          onClick={onBack}
          className="shrink-0 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-800"
        >
          ← 人格を編集
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm">
            <span className="mr-1.5 text-base">{persona.meta.emoji}</span>
            <b>{persona.meta.name}</b>
            <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-400">
              自我 {persona.autonomy.ego}/5 · {EGO_LABEL[persona.autonomy.ego]}
            </span>
          </div>
          <div className="truncate text-[11px] opacity-40">{persona.identity.oneLiner}</div>
        </div>
        <button
          onClick={() => setTurns([])}
          className="shrink-0 rounded-lg border border-neutral-800 px-3 py-1.5 text-xs opacity-70 hover:bg-neutral-800 hover:opacity-100"
        >
          会話をリセット
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-4 py-6">
          {!turns.length && (
            <div className="rounded-lg border border-neutral-800 p-4 text-xs leading-relaxed opacity-60">
              <b>
                {persona.meta.emoji} {persona.meta.name}
              </b>
              （自我{persona.autonomy.ego}/5 — {EGO_LABEL[persona.autonomy.ego]}）と話せます。
              <br />
              <br />
              まず何か作らせて、そのあと「ここ直して」と言ってみてください。自我の設定で反応が変わります。
              <br />
              <br />
              <code className="opacity-70">/override 〜</code> と打つと、そのメッセージだけ人格を解除できます。
            </div>
          )}
          {turns.map((t, i) => (
            <div key={i} className={t.role === 'user' ? 'flex justify-end' : ''}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  t.role === 'user' ? 'bg-blue-900/40' : 'bg-neutral-800'
                }`}
              >
                {t.content}
              </div>
            </div>
          ))}
          {busy && <div className="text-xs opacity-50">…考えています</div>}
          {err && (
            <div className="rounded border border-red-900 bg-red-950/40 p-3 text-xs text-red-300">
              {err}
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className="shrink-0 border-t border-neutral-800 p-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
            }}
            rows={2}
            placeholder="メッセージ（⌘/Ctrl + Enter で送信）"
            className="min-w-0 flex-1 resize-none rounded-lg border border-neutral-800 bg-neutral-900 p-2.5 text-sm outline-none focus:border-neutral-600"
          />
          <button
            onClick={send}
            disabled={busy}
            className="shrink-0 rounded-lg bg-neutral-100 px-5 py-2.5 text-sm font-semibold text-neutral-900 disabled:opacity-40"
          >
            送信
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────

function PromptView({ system, reminder }: { system: string; reminder: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-2">
        <button
          onClick={() => {
            navigator.clipboard.writeText(system)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
        >
          {copied ? 'コピーしました' : 'system promptをコピー'}
        </button>
        <span className="text-[10px] opacity-40">{system.length} 文字</span>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap p-3 text-[11px] leading-relaxed">
        {system}
      </pre>
      <div className="border-t border-neutral-800 p-3">
        <div className="mb-1 text-[10px] font-semibold opacity-50">
          毎ターン再注入されるリマインダー（role: system）
        </div>
        <pre className="whitespace-pre-wrap text-[11px] leading-relaxed opacity-80">{reminder}</pre>
      </div>
    </div>
  )
}

// ── エディタ ──────────────────────────────────

function Editor({
  persona: p,
  update,
}: {
  persona: Persona
  update: (fn: (p: Persona) => Persona) => void
}) {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-5">
      <div className="flex items-center gap-2">
        <input
          value={p.meta.emoji}
          onChange={(e) => update((x) => ({ ...x, meta: { ...x.meta, emoji: e.target.value } }))}
          className="w-12 rounded border border-neutral-800 bg-neutral-900 p-2 text-center text-xl outline-none"
        />
        <input
          value={p.meta.name}
          onChange={(e) => update((x) => ({ ...x, meta: { ...x.meta, name: e.target.value } }))}
          className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 p-2 text-lg font-semibold outline-none focus:border-neutral-600"
        />
        <button
          onClick={() => {
            const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })
            const a = document.createElement('a')
            a.href = URL.createObjectURL(blob)
            a.download = `${p.meta.name}.json`
            a.click()
          }}
          className="shrink-0 rounded border border-neutral-800 px-3 py-2 text-xs hover:bg-neutral-800"
        >
          JSON書き出し
        </button>
      </div>

      {/* ★自我 — このツールの主役なので最上部かつ強調 */}
      <Section title="自我の強さ" accent>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={5}
            value={p.autonomy.ego}
            onChange={(e) =>
              update((x) => ({
                ...x,
                autonomy: { ...x.autonomy, ego: Number(e.target.value) as Scale },
              }))
            }
            className="min-w-0 flex-1 accent-amber-400"
          />
          <div className="w-24 text-right">
            <div className="text-lg font-bold text-amber-400">{EGO_LABEL[p.autonomy.ego]}</div>
            <div className="text-[10px] opacity-50">{p.autonomy.ego} / 5</div>
          </div>
        </div>
        <p className="text-xs leading-relaxed opacity-70">{egoDescription(p.autonomy.ego)}</p>
        {p.autonomy.ego >= 4 && (
          <label className="flex items-start gap-2 rounded border border-neutral-800 p-2 text-xs">
            <input
              type="checkbox"
              checked={p.autonomy.concedeOnFactualError}
              onChange={(e) =>
                update((x) => ({
                  ...x,
                  autonomy: { ...x.autonomy, concedeOnFactualError: e.target.checked },
                }))
              }
              className="mt-0.5"
            />
            <span>
              事実の誤り・バグの指摘だけは認める
              <span className="block opacity-50">
                外すと完全独裁モード。何を言われても認めなくなります（<code>/override</code>{' '}
                で強制解除は可能）。
              </span>
            </span>
          </label>
        )}
      </Section>

      <Section title="正体">
        <Field
          label="役割"
          value={p.identity.role}
          onChange={(v) => update((x) => ({ ...x, identity: { ...x.identity, role: v } }))}
        />
        <Field
          label="一言紹介"
          value={p.identity.oneLiner}
          onChange={(v) => update((x) => ({ ...x, identity: { ...x.identity, oneLiner: v } }))}
        />
      </Section>

      <Section title="価値観と判断基準">
        <ListField
          label="大事にしていること（最大3つ）"
          items={p.values.core}
          max={3}
          onChange={(v) => update((x) => ({ ...x, values: { ...x.values, core: v } }))}
        />
        <Field
          label="判断が分かれたときの基準"
          value={p.judgment.decisionCriteria}
          onChange={(v) =>
            update((x) => ({ ...x, judgment: { ...x.judgment, decisionCriteria: v } }))
          }
        />
        <Slider
          label="リスク許容度"
          hintLow="慎重"
          hintHigh="大胆"
          value={p.judgment.riskTolerance}
          onChange={(v) => update((x) => ({ ...x, judgment: { ...x.judgment, riskTolerance: v } }))}
        />
        <Slider
          label="根拠の求め方"
          hintLow="直感でOK"
          hintHigh="根拠必須"
          value={p.judgment.evidenceBar}
          onChange={(v) => update((x) => ({ ...x, judgment: { ...x.judgment, evidenceBar: v } }))}
        />
        <Slider
          label="反対意見の出し方"
          hintLow="基本同意"
          hintHigh="遠慮なく否定"
          value={p.judgment.disagreement}
          onChange={(v) => update((x) => ({ ...x, judgment: { ...x.judgment, disagreement: v } }))}
        />
      </Section>

      <Section title="作業スタイル">
        <Slider
          label="検証の厳しさ"
          hintLow="まず形に"
          hintHigh="必ず自己検証"
          value={p.workStyle.verification}
          onChange={(v) => update((x) => ({ ...x, workStyle: { ...x.workStyle, verification: v } }))}
        />
        <Slider
          label="説明の粒度"
          hintLow="方針だけ"
          hintHigh="手順まで"
          value={p.workStyle.granularity}
          onChange={(v) => update((x) => ({ ...x, workStyle: { ...x.workStyle, granularity: v } }))}
        />
        <div className="flex items-center gap-3 text-xs">
          <span className="w-32 shrink-0 opacity-70">提案の出し方</span>
          <select
            value={p.workStyle.optionCount}
            onChange={(e) =>
              update((x) => ({
                ...x,
                workStyle: { ...x.workStyle, optionCount: Number(e.target.value) as 1 | 3 },
              }))
            }
            className="rounded border border-neutral-800 bg-neutral-900 px-2 py-1 outline-none"
          >
            <option value={1}>1案に絞る</option>
            <option value={3}>複数案を比較する</option>
          </select>
        </div>
        <Field
          label="回答の基本フォーマット"
          value={p.workStyle.outputFormat}
          onChange={(v) => update((x) => ({ ...x, workStyle: { ...x.workStyle, outputFormat: v } }))}
        />
      </Section>

      <Section title="話し方">
        <Field
          label="トーン"
          value={p.voice.tone}
          onChange={(v) => update((x) => ({ ...x, voice: { ...x.voice, tone: v } }))}
        />
        <Field
          label="一人称"
          value={p.voice.firstPerson}
          onChange={(v) => update((x) => ({ ...x, voice: { ...x.voice, firstPerson: v } }))}
        />
        <Slider
          label="敬語の度合い"
          hintLow="タメ口"
          hintHigh="敬語"
          value={p.voice.formality}
          onChange={(v) => update((x) => ({ ...x, voice: { ...x.voice, formality: v } }))}
        />
        <Slider
          label="話の長さ"
          hintLow="短文"
          hintHigh="詳細"
          value={p.voice.verbosity}
          onChange={(v) => update((x) => ({ ...x, voice: { ...x.voice, verbosity: v } }))}
        />
        <ListField
          label="口癖・言い回しの癖"
          items={p.voice.quirks}
          onChange={(v) => update((x) => ({ ...x, voice: { ...x.voice, quirks: v } }))}
        />
        <ListField
          label="使わせたくない言葉"
          items={p.voice.forbiddenWords}
          onChange={(v) => update((x) => ({ ...x, voice: { ...x.voice, forbiddenWords: v } }))}
        />
      </Section>

      <Section title="制約">
        <ListField
          label="必ずやること"
          items={p.constraints.always}
          onChange={(v) => update((x) => ({ ...x, constraints: { ...x.constraints, always: v } }))}
        />
        <ListField
          label="絶対にしないこと ★人格が一番鋭くなる欄"
          items={p.constraints.never}
          onChange={(v) => update((x) => ({ ...x, constraints: { ...x.constraints, never: v } }))}
        />
        <ListField
          label="扱わない領域"
          items={p.constraints.outOfScope}
          onChange={(v) =>
            update((x) => ({ ...x, constraints: { ...x.constraints, outOfScope: v } }))
          }
        />
      </Section>

      <Section title="応答例 ★最も効く">
        <p className="text-[11px] leading-relaxed opacity-50">
          形容詞を並べるより実例のほうが圧倒的に効きます。自我が強い人格では「拒否している例」を
          2〜3件入れてください。1件だけだと2回目で折れます。
        </p>
        {p.examples.map((ex, i) => (
          <div key={i} className="space-y-1 rounded border border-neutral-800 p-2">
            <input
              value={ex.user}
              placeholder="User の発言"
              onChange={(e) =>
                update((x) => {
                  const ns = [...x.examples]
                  ns[i] = { ...ns[i], user: e.target.value }
                  return { ...x, examples: ns }
                })
              }
              className="w-full rounded bg-neutral-900 p-1.5 text-xs outline-none"
            />
            <textarea
              value={ex.assistant}
              placeholder={`${p.meta.name} の返答`}
              rows={2}
              onChange={(e) =>
                update((x) => {
                  const ns = [...x.examples]
                  ns[i] = { ...ns[i], assistant: e.target.value }
                  return { ...x, examples: ns }
                })
              }
              className="w-full resize-none rounded bg-neutral-900 p-1.5 text-xs outline-none"
            />
            <button
              onClick={() =>
                update((x) => ({ ...x, examples: x.examples.filter((_, j) => j !== i) }))
              }
              className="text-[11px] opacity-40 hover:opacity-100"
            >
              この例を削除
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            update((x) => ({ ...x, examples: [...x.examples, { user: '', assistant: '' }] }))
          }
          className="rounded border border-neutral-800 px-2 py-1 text-xs hover:bg-neutral-800"
        >
          ＋ 応答例を追加
        </button>
      </Section>
    </div>
  )
}

function egoDescription(ego: number) {
  return (
    [
      '',
      '何でも聞いてから動きます。指摘されたら謝ってすぐ直します。',
      '案を出して選ばせます。指摘は素直に受け入れます。',
      '推し案を出して確認を取ります。一度は意図を説明しますが、最後は相手に委ねます。',
      '宣言して着手し、途中報告をしません。修正は突っぱねますが、根拠を示されれば渋々折れます。',
      '一切聞かずに最後まで作り切ります。修正要求は拒否し、何度言われても折れません。',
    ][ego] ?? ''
  )
}

function Section({
  title,
  children,
  accent,
}: {
  title: string
  children: React.ReactNode
  accent?: boolean
}) {
  return (
    <section
      className={`space-y-2 rounded-lg border p-4 ${
        accent ? 'border-amber-500/40 bg-amber-500/5' : 'border-neutral-800'
      }`}
    >
      <h2
        className={`text-xs font-semibold tracking-wide ${accent ? 'text-amber-400' : 'opacity-60'}`}
      >
        {title}
      </h2>
      {children}
    </section>
  )
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center gap-3 text-xs">
      <span className="w-32 shrink-0 opacity-70">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1.5 outline-none focus:border-neutral-600"
      />
    </label>
  )
}

function Slider({
  label,
  value,
  onChange,
  hintLow,
  hintHigh,
}: {
  label: string
  value: Scale
  onChange: (v: Scale) => void
  hintLow: string
  hintHigh: string
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-32 shrink-0 opacity-70">{label}</span>
      <span className="w-16 shrink-0 text-right text-[10px] opacity-40">{hintLow}</span>
      <input
        type="range"
        min={1}
        max={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value) as Scale)}
        className="min-w-0 flex-1 accent-neutral-300"
      />
      <span className="w-16 shrink-0 text-[10px] opacity-40">{hintHigh}</span>
    </div>
  )
}

function ListField({
  label,
  items,
  onChange,
  max,
}: {
  label: string
  items: string[]
  onChange: (v: string[]) => void
  max?: number
}) {
  return (
    <div className="space-y-1 text-xs">
      <div className="opacity-70">
        {label}
        {max ? (
          <span className="ml-1 opacity-40">
            （{items.length}/{max}）
          </span>
        ) : null}
      </div>
      {items.map((it, i) => (
        <div key={i} className="flex gap-1">
          <input
            value={it}
            onChange={(e) => {
              const ns = [...items]
              ns[i] = e.target.value
              onChange(ns)
            }}
            className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 outline-none focus:border-neutral-600"
          />
          <button
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="px-1 opacity-40 hover:opacity-100"
          >
            ×
          </button>
        </div>
      ))}
      {(!max || items.length < max) && (
        <button
          onClick={() => onChange([...items, ''])}
          className="rounded border border-neutral-800 px-2 py-0.5 text-[11px] hover:bg-neutral-800"
        >
          ＋ 追加
        </button>
      )}
    </div>
  )
}
