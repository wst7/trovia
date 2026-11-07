/**
 * 正文字体：思源宋体（子集）。
 *
 * Android 系统没有中文衬线字体，想要「读起来像纸书」只能自带一份。
 * 字体是 7542 个常用字（GB2312 全表 + ASCII + 中西文标点）的子集，
 * 2.3MB；生僻字会落到系统字体上，样式略有差别但不会缺字。
 *
 * 用 useSyncExternalStore 做一个「加载好了没有」的订阅：正文在字体
 * 到位后重渲染一次，而不是永远停在系统字体上。
 */
import { useSyncExternalStore } from 'react'

/**
 * 字体名来自 expo-font 插件按文件名注册的结果。
 * 字体是随包打进原生的（app.config 的 expo-font 插件），不再运行时下载——
 * 运行时 loadAsync 会在没有嵌入 asset 表时失败（ExpoAsset.downloadAsync）。
 */
export const SERIF_FAMILY = 'NotoSerifSC-Regular'

// 原生已注册，随时可用；保留这套订阅是为了以后换成可变字体再加载。
let ready = true
const listeners = new Set<() => void>()

export function isSerifReady(): boolean {
  return ready
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 字体是否已经可用；加载完成会触发一次重渲染。 */
export function useSerifReady(): boolean {
  return useSyncExternalStore(subscribe, isSerifReady, isSerifReady)
}
