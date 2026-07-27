'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { compile } from '@/lib/compile'
import {
  ATTITUDES,
  PRESETS,
  fromPreset,
  stamp,
  type Attitude,
  type Persona,
  type Scale,
} from '@/lib/persona'

const STORE_KEY = 'persona-forge/v3'
const EGO_LABEL = ['', '従順', '素直', '対等', '頑固', '独裁']

type Turn = { role: 'user' | 'assistant'; content: string }
type Screen = 'setup' | 'chat'

function attitudeOf(p: Persona): Attitude {
  return p.voice.attitude ?? 'neutral'
}

/** 「がんこ / ドS」のような組み合わせ名 */
function comboName(p: Persona): string {
  const a = ATTITUDES.find((x) => x.key === attitudeOf(p))
  return attitudeOf(p) === 'neutral' ? p.meta.name : `${p.meta.name} / ${a?.label}`
}

export default function Page() {
  const [personas, setPersonas] = useState<Persona[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [screen, setScreen] = useState<Screen>('setup')
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
    if (list.length !== PRESETS.length) list = PRESETS.map((p) => fromPreset(p.key))
    setPersonas(list)
    setActiveId(list[1]?.id ?? list[0]?.id ?? null)
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

  function reset(id: string) {
    const p = personas.find((x) => x.id === id)
    if (!p?.meta.basePreset) return
    const fresh = fromPreset(p.meta.basePreset)
    setPersonas((prev) => prev.map((x) => (x.id === id ? { ...fresh, id } : x)))
  }

  if (!loaded) {
    return <div className="p-8 text-xs text-faint">loading…</div>
  }

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

// ── 画面1: 選ぶ ───────────────────────────────

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
  const attitude = active ? attitudeOf(active) : 'neutral'
  const attitudeDef = ATTITUDES.find((a) => a.key === attitude)

  return (
    <div className="h-dvh overflow-y-auto">
      <div className="mx-auto w-full max-w-[52rem] px-6 pb-24 pt-10">
        <header className="flex items-baseline justify-between border-b border-line-2 pb-3">
          <h1 className="text-sm tracking-[0.2em]">PERSONA FORGE</h1>
          <p className="text-[10px] text-faint">人格を system prompt にコンパイルする</p>
        </header>

        {/* 01 性格 */}
        <section className="mt-10">
          <div className="flex items-baseline gap-3">
            <span className="label">01</span>
            <h2 className="text-xs">性格</h2>
            <span className="ml-auto text-[10px] text-faint">修正を求めたときの態度で決まる</span>
          </div>

          <div className="mt-3 border-t border-line">
            {personas.map((p, i) => {
              const preset = PRESETS.find((x) => x.key === p.meta.basePreset)
              const on = p.id === active?.id
              return (
                <button
                  key={p.id}
                  onClick={() => setActiveId(p.id)}
                  className={`group flex w-full items-baseline gap-4 border-b border-line px-3 py-3.5 text-left ${
                    on ? 'bg-panel' : 'hover:bg-panel/60'
                  }`}
                >
                  <span
                    className={`w-4 shrink-0 text-[10px] ${on ? 'text-accent' : 'text-faint'}`}
                    aria-hidden
                  >
                    {on ? '■' : String(i + 1).padStart(2, '0')}
                  </span>
                  <span className={`w-20 shrink-0 text-sm ${on ? 'text-accent' : ''}`}>
                    {p.meta.name}
                  </span>
                  <span className="min-w-0 flex-1 font-sans text-xs leading-relaxed text-dim">
                    {preset?.onRevision ?? p.identity.oneLiner}
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {/* 02 態度 */}
        <section className="mt-10">
          <div className="flex items-baseline gap-3">
            <span className="label">02</span>
            <h2 className="text-xs">態度</h2>
            <span className="ml-auto text-[10px] text-faint">口調と対人姿勢。性格とは別の軸</span>
          </div>

          <div className="mt-3 flex border border-line-2">
            {ATTITUDES.map((a) => {
              const on = attitude === a.key
              return (
                <button
                  key={a.key}
                  onClick={() =>
                    update((x) => ({ ...x, voice: { ...x.voice, attitude: a.key } }))
                  }
                  className={`flex-1 border-r border-line-2 py-2.5 text-xs last:border-r-0 ${
                    on ? 'bg-accent text-black' : 'text-dim hover:bg-panel hover:text-fg'
                  }`}
                >
                  {a.label}
                </button>
              )
            })}
          </div>
          <p className="mt-2 px-1 font-sans text-xs leading-relaxed text-faint">
            {attitudeDef?.hint}
          </p>
        </section>

        {/* まとめ + 確定 */}
        {active && (
          <section className="mt-10 border-t border-line-2 pt-5">
            <div className="flex items-baseline gap-3">
              <span className="label">selected</span>
              <span className="text-accent">{comboName(active)}</span>
            </div>
            <p className="mt-2 font-sans text-xs leading-relaxed text-dim">
              {active.identity.oneLiner}
              {attitude !== 'neutral' && ` — ${attitudeDef?.hint}`}
            </p>

            <button
              onClick={onConfirm}
              className="mt-5 w-full bg-accent py-3 text-sm font-bold tracking-wide text-black hover:brightness-110"
            >
              話す →
            </button>
            {hasConversation && (
              <p className="mt-2 text-center text-[10px] text-faint">
                前回の会話の続きから話します
              </p>
            )}
          </section>
        )}

        {/* 詳細設定 */}
        <section className="mt-14 border-t border-line pt-4">
          <button
            onClick={() => setDetailOpen((v) => !v)}
            className="label hover:text-dim"
          >
            {detailOpen ? '−' : '+'} 詳細設定
          </button>

          {detailOpen && active && (
            <div className="mt-6">
              <div className="mb-6 flex flex-wrap gap-2">
                <SmallButton onClick={() => setPromptOpen((v) => !v)}>
                  {promptOpen ? 'プロンプトを隠す' : '生成されるプロンプト'}
                </SmallButton>
                <SmallButton onClick={() => reset(active.id)}>初期状態に戻す</SmallButton>
                <SmallButton
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(active, null, 2)], {
                      type: 'application/json',
                    })
                    const a = document.createElement('a')
                    a.href = URL.createObjectURL(blob)
                    a.download = `${active.meta.name}.json`
                    a.click()
                  }}
                >
                  JSON書き出し
                </SmallButton>
              </div>

              {promptOpen && compiled && (
                <div className="mb-8 border border-line-2">
                  <PromptView system={compiled.system} reminder={compiled.reminder} />
                </div>
              )}

              <Editor persona={active} update={update} />
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ── 画面2: 会話 ───────────────────────────────

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
    setTurns([...history, { role: 'user', content: raw }])
    setBusy(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona, history, message, override }),
      })
      const data = await res.json()
      if (data.error) setErr(data.error)
      else
        setTurns([
          ...history,
          { role: 'user', content: raw },
          { role: 'assistant', content: data.text },
        ])
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex shrink-0 items-center gap-4 border-b border-line-2 px-5 py-2.5">
        <button onClick={onBack} className="text-xs text-dim hover:text-accent">
          ← 設定
        </button>
        <span className="h-3 w-px bg-line-2" />
        <span className="min-w-0 flex-1 truncate text-xs text-accent">{comboName(persona)}</span>
        <button
          onClick={() => setTurns([])}
          className="shrink-0 text-[10px] text-faint hover:text-fg"
        >
          会話をリセット
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[46rem] px-6 py-8">
          {!turns.length && (
            <div className="border-l-2 border-line-2 pl-4 font-sans text-xs leading-loose text-faint">
              何か作らせたあとに「ここ直して」と言ってみてください。
              <br />
              性格の設定で、直すか・突っぱねるかが変わります。
              <br />
              <span className="font-mono text-dim">/override</span> で始めると、そのメッセージだけ人格を外せます。
            </div>
          )}

          {turns.map((t, i) => (
            <article key={i} className="mb-7">
              <div
                className={`label mb-1.5 ${t.role === 'assistant' ? 'text-accent' : 'text-faint'}`}
              >
                {t.role === 'user' ? 'you' : persona.meta.name}
              </div>
              <div
                className={`whitespace-pre-wrap font-sans text-[13.5px] leading-[1.85] ${
                  t.role === 'user' ? 'text-dim' : 'text-fg'
                }`}
              >
                {t.content}
              </div>
            </article>
          ))}

          {busy && (
            <div className="label animate-pulse text-accent">
              {persona.meta.name} が書いています
            </div>
          )}
          {err && (
            <div className="border-l-2 border-red-500 pl-4 font-sans text-xs text-red-400">
              {err}
            </div>
          )}
          <div ref={bottom} />
        </div>
      </div>

      <div className="shrink-0 border-t border-line-2">
        <div className="mx-auto flex w-full max-w-[46rem] items-end gap-3 px-6 py-3">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
            }}
            rows={2}
            placeholder="⌘ + Enter で送信"
            className="min-w-0 flex-1 resize-none bg-transparent py-1 font-sans text-sm leading-relaxed outline-none placeholder:text-faint"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="shrink-0 border border-accent px-4 py-1.5 text-xs text-accent hover:bg-accent hover:text-black disabled:border-line-2 disabled:text-faint disabled:hover:bg-transparent"
          >
            送信
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 部品 ─────────────────────────────────────

function SmallButton({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="border border-line-2 px-2.5 py-1.5 text-[10px] text-dim hover:border-accent hover:text-accent"
    >
      {children}
    </button>
  )
}

function PromptView({ system, reminder }: { system: string; reminder: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div>
      <div className="flex items-center gap-3 border-b border-line px-3 py-2">
        <button
          onClick={() => {
            navigator.clipboard.writeText(system)
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          }}
          className="text-[10px] text-dim hover:text-accent"
        >
          {copied ? 'copied' : 'copy system prompt'}
        </button>
        <span className="text-[10px] text-faint">{system.length} chars</span>
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap p-3 text-[11px] leading-relaxed text-dim">
        {system}
      </pre>
      <div className="border-t border-line p-3">
        <div className="label mb-1">reminder / 毎ターン再注入</div>
        <pre className="whitespace-pre-wrap text-[11px] leading-relaxed text-dim">{reminder}</pre>
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
    <div className="space-y-10">
      <Group n="03" title="呼び名">
        <Field
          label="名前"
          value={p.meta.name}
          onChange={(v) => update((x) => ({ ...x, meta: { ...x.meta, name: v } }))}
        />
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
      </Group>

      <Group n="04" title="自我の強さ" note="判断をどこまで曲げないか">
        <div className="flex items-center gap-4">
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
            className="min-w-0 flex-1"
          />
          <span className="w-24 shrink-0 text-right text-xs text-accent">
            {p.autonomy.ego} {EGO_LABEL[p.autonomy.ego]}
          </span>
        </div>
        <p className="font-sans text-xs leading-relaxed text-faint">
          {egoDescription(p.autonomy.ego)}
        </p>
        {p.autonomy.ego >= 4 && (
          <label className="flex cursor-pointer items-start gap-2.5 border border-line px-3 py-2.5 text-xs">
            <input
              type="checkbox"
              checked={p.autonomy.concedeOnFactualError}
              onChange={(e) =>
                update((x) => ({
                  ...x,
                  autonomy: { ...x.autonomy, concedeOnFactualError: e.target.checked },
                }))
              }
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span className="font-sans leading-relaxed">
              事実の誤り・バグの指摘だけは認める
              <span className="mt-0.5 block text-faint">
                外すと完全独裁。何を言われても認めなくなります（/override で強制解除は可能）。
              </span>
            </span>
          </label>
        )}
      </Group>

      <Group n="05" title="判断">
        <ListField
          label="大事にしていること"
          items={p.values.core}
          max={3}
          onChange={(v) => update((x) => ({ ...x, values: { ...x.values, core: v } }))}
        />
        <Field
          label="判断の基準"
          value={p.judgment.decisionCriteria}
          onChange={(v) =>
            update((x) => ({ ...x, judgment: { ...x.judgment, decisionCriteria: v } }))
          }
        />
        <Slider
          label="リスク"
          lo="慎重"
          hi="大胆"
          value={p.judgment.riskTolerance}
          onChange={(v) => update((x) => ({ ...x, judgment: { ...x.judgment, riskTolerance: v } }))}
        />
        <Slider
          label="根拠"
          lo="直感"
          hi="必須"
          value={p.judgment.evidenceBar}
          onChange={(v) => update((x) => ({ ...x, judgment: { ...x.judgment, evidenceBar: v } }))}
        />
        <Slider
          label="反対意見"
          lo="同意寄り"
          hi="遠慮なく否定"
          value={p.judgment.disagreement}
          onChange={(v) => update((x) => ({ ...x, judgment: { ...x.judgment, disagreement: v } }))}
        />
      </Group>

      <Group n="06" title="作業">
        <Slider
          label="検証"
          lo="まず形に"
          hi="必ず自己検証"
          value={p.workStyle.verification}
          onChange={(v) => update((x) => ({ ...x, workStyle: { ...x.workStyle, verification: v } }))}
        />
        <Slider
          label="粒度"
          lo="方針だけ"
          hi="手順まで"
          value={p.workStyle.granularity}
          onChange={(v) => update((x) => ({ ...x, workStyle: { ...x.workStyle, granularity: v } }))}
        />
        <Row label="提案">
          <select
            value={p.workStyle.optionCount}
            onChange={(e) =>
              update((x) => ({
                ...x,
                workStyle: { ...x.workStyle, optionCount: Number(e.target.value) as 1 | 3 },
              }))
            }
            className="inp w-full appearance-none text-xs"
          >
            <option value={1}>1案に絞る</option>
            <option value={3}>複数案を比較する</option>
          </select>
        </Row>
        <Field
          label="出力の形"
          value={p.workStyle.outputFormat}
          onChange={(v) => update((x) => ({ ...x, workStyle: { ...x.workStyle, outputFormat: v } }))}
        />
      </Group>

      <Group n="07" title="口調">
        <Row label="態度">
          <div className="flex border border-line-2">
            {ATTITUDES.map((a) => (
              <button
                key={a.key}
                onClick={() => update((x) => ({ ...x, voice: { ...x.voice, attitude: a.key } }))}
                className={`flex-1 border-r border-line-2 py-1.5 text-[11px] last:border-r-0 ${
                  (p.voice.attitude ?? 'neutral') === a.key
                    ? 'bg-accent text-black'
                    : 'text-dim hover:text-fg'
                }`}
              >
                {a.label}
              </button>
            ))}
          </div>
        </Row>
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
          label="敬語"
          lo="タメ口"
          hi="敬語"
          value={p.voice.formality}
          onChange={(v) => update((x) => ({ ...x, voice: { ...x.voice, formality: v } }))}
        />
        <Slider
          label="長さ"
          lo="短文"
          hi="詳細"
          value={p.voice.verbosity}
          onChange={(v) => update((x) => ({ ...x, voice: { ...x.voice, verbosity: v } }))}
        />
        <ListField
          label="口癖"
          items={p.voice.quirks}
          onChange={(v) => update((x) => ({ ...x, voice: { ...x.voice, quirks: v } }))}
        />
        <ListField
          label="禁句"
          items={p.voice.forbiddenWords}
          onChange={(v) => update((x) => ({ ...x, voice: { ...x.voice, forbiddenWords: v } }))}
        />
      </Group>

      <Group n="08" title="制約" note="「しないこと」が人格を一番鋭くする">
        <ListField
          label="必ずやる"
          items={p.constraints.always}
          onChange={(v) => update((x) => ({ ...x, constraints: { ...x.constraints, always: v } }))}
        />
        <ListField
          label="絶対しない"
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
      </Group>

      <Group n="09" title="応答例" note="形容詞100個より実例2件のほうが効く">
        {p.examples.map((ex, i) => (
          <div key={i} className="border-l border-line-2 pl-3">
            <input
              value={ex.user}
              placeholder="user"
              onChange={(e) =>
                update((x) => {
                  const ns = [...x.examples]
                  ns[i] = { ...ns[i], user: e.target.value }
                  return { ...x, examples: ns }
                })
              }
              className="inp mb-1 w-full font-sans text-xs"
            />
            <textarea
              value={ex.assistant}
              placeholder={p.meta.name}
              rows={2}
              onChange={(e) =>
                update((x) => {
                  const ns = [...x.examples]
                  ns[i] = { ...ns[i], assistant: e.target.value }
                  return { ...x, examples: ns }
                })
              }
              className="inp w-full resize-none font-sans text-xs"
            />
            <button
              onClick={() =>
                update((x) => ({ ...x, examples: x.examples.filter((_, j) => j !== i) }))
              }
              className="mt-1 text-[10px] text-faint hover:text-fg"
            >
              削除
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            update((x) => ({ ...x, examples: [...x.examples, { user: '', assistant: '' }] }))
          }
          className="text-[10px] text-faint hover:text-accent"
        >
          + 応答例を追加
        </button>
      </Group>
    </div>
  )
}

function egoDescription(ego: number) {
  return (
    [
      '',
      '何でも聞いてから動く。指摘されたら謝ってすぐ直す。',
      '案を出して選ばせる。指摘は素直に受け入れる。',
      '推し案を出して確認を取る。一度は意図を説明するが、最後は相手に委ねる。',
      '宣言して着手し、途中報告をしない。修正は突っぱねるが、根拠を示されれば渋々折れる。',
      '一切聞かずに最後まで作り切る。修正要求は拒否し、何度言われても折れない。',
    ][ego] ?? ''
  )
}

function Group({
  n,
  title,
  note,
  children,
}: {
  n: string
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-baseline gap-3 border-b border-line pb-2">
        <span className="label">{n}</span>
        <h3 className="text-xs">{title}</h3>
        {note && <span className="ml-auto text-[10px] text-faint">{note}</span>}
      </div>
      <div className="mt-4 space-y-3.5">{children}</div>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4">
      <span className="w-24 shrink-0 text-[11px] text-dim">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
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
    <Row label={label}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="inp w-full font-sans text-xs"
      />
    </Row>
  )
}

function Slider({
  label,
  value,
  onChange,
  lo,
  hi,
}: {
  label: string
  value: Scale
  onChange: (v: Scale) => void
  lo: string
  hi: string
}) {
  return (
    <Row label={label}>
      <div className="flex items-center gap-3">
        <span className="w-16 shrink-0 text-right text-[10px] text-faint">{lo}</span>
        <input
          type="range"
          min={1}
          max={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value) as Scale)}
          className="min-w-0 flex-1"
        />
        <span className="w-16 shrink-0 text-[10px] text-faint">{hi}</span>
      </div>
    </Row>
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
    <Row label={label}>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              value={it}
              onChange={(e) => {
                const ns = [...items]
                ns[i] = e.target.value
                onChange(ns)
              }}
              className="inp min-w-0 flex-1 font-sans text-xs"
            />
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="shrink-0 text-[10px] text-faint hover:text-fg"
            >
              ×
            </button>
          </div>
        ))}
        {(!max || items.length < max) && (
          <button
            onClick={() => onChange([...items, ''])}
            className="text-[10px] text-faint hover:text-accent"
          >
            + 追加
          </button>
        )}
      </div>
    </Row>
  )
}
