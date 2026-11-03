import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { DocumentSummary } from '@trovia/shared'
import { errorMessage } from '@trovia/shared'
import { DocumentSummaryCard } from '../components/DocumentCard'
import { SearchIcon } from '../components/Icons'

const PAGE_SIZE = 20

export default function Documents() {
  const [keywordInput, setKeywordInput] = useState('')
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  const [items, setItems] = useState<DocumentSummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 卡片处理完成时触发一次刷新，拿到解析后的标题与摘要
  const [reloadKey, setReloadKey] = useState(0)

  // 输入即筛选，不需要再按「筛选」按钮。
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setKeyword(keywordInput.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [keywordInput])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .listDocuments({ page, page_size: PAGE_SIZE, keyword, sort: 'saved_at_desc' })
      .then((res) => {
        if (cancelled) return
        setItems((prev) => (page === 1 ? res.items : [...prev, ...res.items]))
        setTotal(res.total)
        setError(null)
      })
      .catch((e) => {
        if (cancelled) return
        setError(errorMessage(e, '加载收藏列表失败，请稍后重试。'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, keyword, reloadKey])

  function handleTerminal() {
    setPage(1)
    setReloadKey((k) => k + 1)
  }

  function clearSearch() {
    setKeywordInput('')
    setKeyword('')
    setPage(1)
  }

  const hasMore = items.length < total

  return (
    <div className="page">
      <div className="page-head">
        <h1>全部收藏</h1>
        {!loading && total > 0 && <span className="page-count">{total} 条</span>}
      </div>

      <form
        className="list-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault()
          setKeyword(keywordInput.trim())
          setPage(1)
        }}
      >
        <SearchIcon size={16} />
        <input
          type="search"
          placeholder="在全部收藏中筛选……"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          aria-label="按关键词筛选"
        />
        {(keywordInput || keyword) && (
          <button type="button" className="search-clear" onClick={clearSearch}>
            清除
          </button>
        )}
      </form>

      {error && <div className="notice notice--error">{error}</div>}

      {loading && items.length === 0 && <div className="loading-row">正在加载……</div>}

      {!loading && !error && items.length === 0 && (
        <div className="empty-state">
          {keyword ? '没有匹配的收藏。' : '还没有收藏。回到首页粘贴第一个链接或分享文字，寻迹会自动整理。'}
        </div>
      )}

      <div className="list">
        {items.map((doc) => (
          <DocumentSummaryCard key={doc.id} doc={doc} onTerminal={handleTerminal} />
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          className="load-more"
          disabled={loading}
          onClick={() => setPage((p) => p + 1)}
        >
          {loading ? '加载中……' : '加载更多'}
        </button>
      )}
    </div>
  )
}
