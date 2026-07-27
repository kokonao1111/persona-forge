// 人格に対応する画像の探し方。
//
// コードに「この組み合わせならこの画像」とは書かない。ファイル名で決まる。
// 具体的なものから順に探し、無ければ一段ずつ大まかなものに落ちる。
// 1枚も無ければ何も表示しない（枠だけ残る）ので、途中まで用意した状態でも壊れない。

import type { Persona } from './persona'

/** 画像を置く場所。public/ 以下なのでビルド不要、ファイルを置けば即反映される */
export const FACE_DIR = '/personas'

const EXT = ['png', 'webp', 'jpg']

function withExt(base: string): string[] {
  return EXT.map((e) => `${base}.${e}`)
}

function keys(p: Persona) {
  return {
    c: p.meta.basePreset ?? 'gentle', // 性格 gentle | anxious | stubborn
    a: p.voice.attitude ?? 'neutral', // 態度 dom | neutral | sub
    g: p.identity.gender ?? 'none', // 性別 boy | girl | none
  }
}

/** 合成後の一枚。具体的な組み合わせから順に探す */
export function facePaths(p: Persona): string[] {
  const { c, a, g } = keys(p)
  return [
    `${FACE_DIR}/face/${c}-${a}-${g}`, // 素直×ドS×女の子
    `${FACE_DIR}/face/${c}-${g}`, // 素直×女の子
    `${FACE_DIR}/face/${c}-${a}`, // 素直×ドS
    `${FACE_DIR}/face/${a}-${g}`, // ドS×女の子
    `${FACE_DIR}/face/${c}`, // 素直
    `${FACE_DIR}/face/${a}`, // ドS
    // 合成後を用意していない段階では、態度の絵をそのまま使う
    `${FACE_DIR}/attitude/${a}-${g}`,
    `${FACE_DIR}/attitude/${a}`,
  ].flatMap(withExt)
}

/** 左の枠（性格）。性別ごとに分けてもいいし、分けなくてもいい */
export function personalityPaths(p: Persona): string[] {
  const { c, g } = keys(p)
  return [`${FACE_DIR}/personality/${c}-${g}`, `${FACE_DIR}/personality/${c}`].flatMap(withExt)
}

/** 右の枠（態度）。ふつうは絵を用意しないこともあるので、その場合は枠だけ残る */
export function attitudePaths(p: Persona): string[] {
  const { a, g } = keys(p)
  return [`${FACE_DIR}/attitude/${a}-${g}`, `${FACE_DIR}/attitude/${a}`].flatMap(withExt)
}
