import { fetchArticle } from '../src/local/article'

/** Temporary diagnostic: given a feed or page address, see what the extraction actually pulled out. */
const targets = process.argv.slice(2)

for (const url of targets) {
  try {
    const article = await fetchArticle(url)
    console.log('\n==', url)
    console.log('title:', article.title?.slice(0, 40))
    console.log('字数:', article.plainText.length, '图:', article.images.length, 'blocked:', article.blocked)
    console.log('开头:', JSON.stringify(article.plainText.slice(0, 200)))
    console.log('结尾:', JSON.stringify(article.plainText.slice(-120)))
  } catch (error) {
    console.log('\n==', url, 'ERR', error instanceof Error ? error.message : String(error))
  }
}
