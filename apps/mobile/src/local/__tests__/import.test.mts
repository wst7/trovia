/**
 * 导入解析的回归测试。用的是**真实导出文件的结构**，不是自己编的格式：
 *   - Chrome 书签导出（Netscape HTML）
 *   - Chrome / Edge 的 Bookmarks JSON
 *   - Raindrop 导出的 CSV
 *   - 一行一个链接的清单
 *
 * 跑法：npx tsx apps/mobile/src/local/__tests__/import.test.mts
 */
import assert from 'node:assert/strict'
import { detectFormat, normalizeUrl, parseImport } from '../import/parse.ts'

// 1. Chrome 导出的书签 HTML（保留原始结构：DT/DD、ADD_DATE、实体转义）
const chromeHtml = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file.
     It will be read and overwritten.
     DO NOT EDIT! -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1700000000" LAST_MODIFIED="1700000001">技术</H3>
    <DL><p>
        <DT><A HREF="https://juejin.cn/post/7143946519886954527" ADD_DATE="1700000100">手把手教你写好技术文章</A>
        <DT><A HREF="https://sspai.com/post/74258" ADD_DATE="1700000200">少数派 &amp; 效率工具</A>
        <DT><A HREF="javascript:void(0)">小书签</A>
    </DL><p>
    <DT><A HREF="https://example.com/tools?utm_source=newsletter&utm_medium=email" ADD_DATE="1700000300">带跟踪参数的工具页</A>
</DL><p>`

const htmlResult = parseImport(chromeHtml)
assert.equal(htmlResult.format, 'bookmarks-html')
assert.equal(htmlResult.items.length, 3, '三条有效链接')
assert.equal(htmlResult.items[0].url, 'https://juejin.cn/post/7143946519886954527')
assert.equal(htmlResult.items[1].title, '少数派 & 效率工具', '实体要解码')
assert.equal(
  htmlResult.items[2].url,
  'https://example.com/tools',
  'utm_* 跟踪参数要在去重前去掉',
)
assert.equal(htmlResult.items[2].addedAt, null, 'HTML 里的 ADD_DATE 不猜成时间戳')
console.log('✓ Chrome 书签 HTML：三条链接、实体解码、跟踪参数被去掉、javascript: 被跳过')

// 2. Chrome 的 Bookmarks JSON（同步盘/备份里就是这个文件）
const chromeJson = JSON.stringify({
  checksum: 'abc',
  roots: {
    bookmark_bar: {
      children: [
        { type: 'url', name: 'React', url: 'https://github.com/facebook/react', date_added: '1700000000000000' },
        {
          type: 'folder',
          name: '阅读',
          children: [{ type: 'url', name: '维基：睡眠', url: 'https://zh.wikipedia.org/wiki/睡眠' }],
        },
      ],
    },
    other: { children: [] },
  },
  version: 1,
})
const jsonResult = parseImport(chromeJson)
assert.equal(jsonResult.format, 'bookmarks-json')
assert.equal(jsonResult.items.length, 2, '要递归进文件夹')
assert.equal(jsonResult.items[1].title, '维基：睡眠')
console.log('✓ Chrome JSON：递归文件夹，两条都拿到')

// 3. Raindrop 导出的 CSV（表头是第一行）
const raindropCsv = `id,title,note,excerpt,url,folder,tags,created,cover,highlights,favorite
1,"写文章的方法","","",https://juejin.cn/post/1,"技术","写作",2024-01-01,,,false
2,"数据库索引","","",https://developer.aliyun.com/article/1036457,"数据库","",2024-01-02,,,false
3,"坏链接","","",not-a-url,"","",2024-01-03,,,false`
const csvResult = parseImport(raindropCsv)
assert.equal(csvResult.format, 'csv')
assert.equal(csvResult.items.length, 2)
assert.equal(csvResult.items[0].title, '写文章的方法')
assert.equal(csvResult.skipped.length, 1, '坏链接要进跳过列表')
console.log('✓ CSV：按 url/title 列取，坏行进跳过列表')

// 4. 纯文本清单：三种常见写法混排
const urlList = `# 我的一堆收藏
https://example.com/a
https://example.com/b 少见的写法：标题写在后面
- [React 文档](https://react.dev/learn)
这行没有链接
`
const listResult = parseImport(urlList)
assert.equal(listResult.format, 'urls')
assert.equal(listResult.items.length, 3)
assert.equal(listResult.items[1].title, '少见的写法：标题写在后面')
assert.equal(listResult.items[2].title, 'React 文档')
assert.equal(listResult.skipped.length, 1, '没有链接的行要报出来')
console.log('✓ 纯文本：URL、URL+标题、Markdown 链接都能读')

// 5. 去重与归一化
assert.equal(normalizeUrl('https://WWW.Example.com/path/'), 'https://example.com/path')
assert.equal(normalizeUrl('http://example.com/path'), 'https://example.com/path')
assert.equal(normalizeUrl('https://example.com/path#section'), 'https://example.com/path')
assert.equal(normalizeUrl('chrome://bookmarks'), null)

const dupes = parseImport(`https://example.com/x
https://example.com/x/
https://www.example.com/x`)
assert.equal(dupes.items.length, 1, '三个写法归一化后是同一条')
console.log('✓ 归一化：大小写、www、协议、尾斜杠、锚点都算同一条')

// 5b. HTML 里的 &amp; 必须先解码再归一化，否则同一批数据 JSON/HTML 两种导入会重复
const escapedHtml = '<DT><A HREF="https://youtube.com/watch?v=abc&amp;index=6&amp;list=XYZ">视频</A>'
const escapedJson = JSON.stringify({ roots: { bookmark_bar: { children: [
  { type: 'url', name: '视频', url: 'https://youtube.com/watch?v=abc&index=6&list=XYZ' },
] } } })
assert.equal(
  parseImport(escapedHtml).items[0].url,
  parseImport(escapedJson).items[0].url,
  '同一篇内容在 HTML 与 JSON 里必须归一到同一个链接',
)
console.log('✓ 实体解码：HTML 的 &amp; 与 JSON 的 & 归一到同一条，不会重复导入')

// 6. 上限保护
const many = Array.from({ length: 620 }, (_, i) => `https://example.com/post/${i}`).join('\n')
const capped = parseImport(many)
assert.equal(capped.items.length, 500, '单次最多 500 条')
assert.ok(capped.skipped.some((row) => row.reason.includes('最多')), '要说明为什么被截断')
console.log('✓ 上限：620 条只取 500，并说明原因')

// 7. 认不出的文件不能假装成功
const junk = parseImport('这就是一段普通文字，没有任何链接。')
assert.equal(junk.format, 'unknown')
assert.equal(junk.items.length, 0)
assert.ok(junk.skipped.length > 0)
console.log('✓ 认不出的文件：返回空并给出原因，不伪造结果')

console.log('\n全部通过：四种真实格式、去重归一化、上限与错误回执')
