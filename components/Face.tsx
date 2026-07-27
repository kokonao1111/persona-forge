'use client'

import { useEffect, useState } from 'react'

/**
 * 候補のパスを上から順に試し、最初に読めたものを表示する。
 * 全部読めなければ null を返す（呼び出し側が空の枠を出す）。
 *
 * 白黒に変換して出しているので、どんな絵を入れても画面の統一感が崩れない。
 */
export function Face({
  paths,
  alt,
  className = '',
}: {
  paths: string[]
  alt: string
  className?: string
}) {
  const [i, setI] = useState(0)
  const [dead, setDead] = useState(false)

  // 人格を切り替えたら最初の候補から探し直す
  useEffect(() => {
    setI(0)
    setDead(false)
  }, [paths.join('|')])

  if (dead) return <EmptyFace />

  return (
    // 画像は public/ 配下の固定サイズ素材なので、next/image ではなく素の img で足りる
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={paths[i]}
      alt={alt}
      draggable={false}
      onError={() => {
        if (i + 1 < paths.length) setI(i + 1)
        else setDead(true)
      }}
      // 縦長の人物写真でも顔が残るよう、中央ではなく上を基準に切る
      className={`h-full w-full object-cover object-top [filter:grayscale(1)_contrast(1.05)] ${className}`}
    />
  )
}

/** 絵がまだ無いときの枠。何も置かないより「入る場所がある」と分かるほうがいい */
export function EmptyFace({ label }: { label?: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center border border-dashed border-line-2">
      {label && <span className="label">{label}</span>}
    </div>
  )
}
