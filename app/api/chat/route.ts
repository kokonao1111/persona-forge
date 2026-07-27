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

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      // temperature は Opus 5 では受け付けられない。深さは effort で制御する。
      output_config: { effort: 'low' },
      ...(body.override ? {} : { system }),
      messages,
    })

    if (response.stop_reason === 'refusal') {
      return Response.json({ text: '（応答が拒否されました）' })
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')

    return Response.json({ text })
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: `API error ${error.status}: ${error.message}` }, { status: 500 })
    }
    return Response.json({ error: String(error) }, { status: 500 })
  }
}
