import Anthropic from '@anthropic-ai/sdk'
import { compile } from '@/lib/compile'
import type { Persona } from '@/lib/persona'

const MODEL = 'claude-opus-5'

type Turn = { role: 'user' | 'assistant'; content: string }

export async function POST(request: Request) {
  const body = (await request.json()) as {
    persona: Persona
    history: Turn[]
    message: string
    /** true のとき人格を無効化して素のClaudeとして応答する（脱出ハッチ） */
    override?: boolean
    /** true のとき本文を少しずつ流す（画面用）。検証スクリプトは一括で受け取る */
    stream?: boolean
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY が設定されていません。.env.local に追加してください。' },
      { status: 500 },
    )
  }

  const client = new Anthropic()
  const { system, reminder } = compile(body.persona)

  const messages: Anthropic.MessageParam[] = [
    ...body.history.map((t) => ({ role: t.role, content: t.content })),
    { role: 'user' as const, content: body.message },
  ]

  // 人格リマインダーの再注入。
  // 会話が長くなると人格が薄れる(persona drift)ので、毎ターン直近のユーザー発言の後に
  // role:"system" を挿す。これは偽装できない運営者チャンネルで、
  // かつ先頭の system を書き換えないためプロンプトキャッシュも壊さない。
  // (assistant prefill は現行モデルでは廃止されているため、これが持続性の担い手)
  if (!body.override && reminder) {
    messages.push({ role: 'system', content: reminder } as Anthropic.MessageParam)
  }

  const params = {
    model: MODEL,
    max_tokens: 8000,
    // temperature は Opus 5 では受け付けられない。深さは effort で制御する。
    output_config: { effort: 'low' as const },
    ...(body.override ? {} : { system }),
    messages,
  }

  // 画面からの要求はストリーミングで返す。
  // 議論(<thinking>)は伏せたまま、<answer> に入った時点から流し始める。
  if (body.stream) {
    const hideUntilAnswer = !body.override && (body.persona.workStyle.deliberate ?? true)
    return streamAnswer(client, params, hideUntilAnswer)
  }

  try {
    const response = await client.messages.create(params)

    if (response.stop_reason === 'refusal') {
      return Response.json({ text: '（応答が拒否されました）' })
    }

    const raw = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    return Response.json(split(raw))
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: humanize(error) }, { status: 500 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}


/**
 * 本文を少しずつ流す。1行 = 1つのJSON（NDJSON）で返し、
 * エラーもストリームの中に載せる（ヘッダを送った後では status を変えられないため）。
 *
 * hideUntilAnswer が true のときは <answer> が現れるまで何も流さない。
 * 閉じタグが途中まで届いた状態で送ってしまわないよう、末尾は常に少し握っておく。
 */
function streamAnswer(
  client: Anthropic,
  params: Anthropic.MessageCreateParamsNonStreaming,
  hideUntilAnswer: boolean,
) {
  const OPEN = '<answer>'
  const CLOSE = '</answer>'
  const enc = new TextEncoder()

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(JSON.stringify(o) + '\n'))
      let buf = ''
      let started = !hideUntilAnswer
      let finished = false
      let whole = ''

      try {
        const stream = client.messages.stream(params)

        stream.on('text', (delta) => {
          if (finished) return
          whole += delta
          buf += delta

          if (!started) {
            const i = buf.indexOf(OPEN)
            if (i === -1) return
            started = true
            buf = buf.slice(i + OPEN.length).replace(/^\n+/, '')
          }

          const j = buf.indexOf(CLOSE)
          if (j !== -1) {
            if (j > 0) send({ t: buf.slice(0, j) })
            buf = ''
            finished = true
            return
          }
          // 閉じタグが分割して届く場合に備えて末尾を握る
          if (buf.length > CLOSE.length) {
            send({ t: buf.slice(0, buf.length - CLOSE.length) })
            buf = buf.slice(buf.length - CLOSE.length)
          }
        })

        await stream.finalMessage()

        if (!finished && buf) send({ t: buf })
        // <answer> が一度も現れなかった場合は取りこぼさないよう全文を出す
        if (!started) {
          const fallback = whole.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim()
          if (fallback) send({ t: fallback })
        }
        send({ done: true })
      } catch (error) {
        send({
          error:
            error instanceof Anthropic.APIError ? humanize(error) : String(error),
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      // プロキシに溜め込まれるとストリームの意味がなくなる
      'X-Accel-Buffering': 'no',
    },
  })
}

/**
 * 4役の議論(<thinking>)と結論(<answer>)を分ける。
 * タグが欠けても本文を失わないよう、取れなかった場合は素通しする。
 */
function split(raw: string): { text: string; deliberation: string | null } {
  const think = raw.match(/<thinking>([\s\S]*?)<\/thinking>/i)?.[1]?.trim() ?? null
  const answer = raw.match(/<answer>([\s\S]*?)<\/answer>/i)?.[1]?.trim()
  if (answer) return { text: answer, deliberation: think }

  // <answer> の閉じタグが欠けた場合 → 開始タグ以降を本文とみなす
  const open = raw.match(/<answer>([\s\S]*)$/i)?.[1]?.trim()
  if (open) return { text: open, deliberation: think }

  // タグが一切ない場合 → <thinking> だけ取り除いて全部返す
  const stripped = raw.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '').trim()
  return { text: stripped || raw, deliberation: think }
}

/** APIエラーを、原因と次の一手が分かる日本語にする */
function humanize(e: InstanceType<typeof Anthropic.APIError>): string {
  const raw = e.message ?? ''
  if (raw.includes('credit balance')) {
    return 'APIクレジットが残っていません。https://platform.claude.com/settings/billing でチャージしてください。'
  }
  if (e.status === 401) {
    return 'APIキーが無効です。.env.local の ANTHROPIC_API_KEY を確認してください。'
  }
  if (e.status === 429) {
    return 'レート制限に達しました。少し待ってから送信してください。'
  }
  if (e.status && e.status >= 500) {
    return 'Anthropic側で一時的なエラーが発生しています。少し待って再送してください。'
  }
  return `APIエラー (${e.status}): ${raw}`
}
