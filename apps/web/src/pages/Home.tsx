import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import type { DocumentSummary, ParseStatus, SearchResult } from '@trovia/shared'
import { errorMessage, isValidHttpUrl, STATUS_TEXT } from '@trovia/shared'
import { SearchBox } from '../components/SearchBox'
import { SaveBox } from '../components/SaveBox'
import { DocumentSummaryCard, SearchResultCard } from '../components/DocumentCard'
import { useToast } from '../components/Toast'

const RECENT_COUNT = 6

function terminalToastContent(status: ParseStatus): { message: string; type: 'success' | 'warning' | 'error' } {
  switch (status) {
    case 'completed':
      return { message: '已完成整理，可以通过描述内容搜索它。', type: 'success' }
    case 'failed':
      return { message: STATUS_TEXT.failed, type: 'error' }
    default:
      return { message: STATUS_TEXT.partial, type: 'warning' }
  }
}

export default function Home() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [recent, setRecent] = useState<DocumentSummary[]>([])
  const [recentError, setRecentError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadRecent = useCallback(async () => {
    try {
      const res = await api.listDocuments({ page: 1, page_size: RECENT_COUNT, sort: 'saved_at_desc' })
      setRecent(res.items)
      setRecentError(null)
    } catch (e) {
      setRecentError(errorMessage(e, '加载最近收藏失败，请稍后重试。'))
    }
  }, [])

  useEffect(() => {
    void loadRecent()
  }, [loadRecent])

  async function handleSearch(query: string) {
    setSearching(true)
    setSearchError(null)
    try {
      const res = await api.search(query)
      setResults(res.results)
    } catch (e) {
      setResults(null)
      setSearchError(errorMessage(e, '搜索暂时不可用，请稍后重试。'))
    } finally {
      setSearching(false)
    }
  }

  async function handleSave(url: string) {
    if (!isValidHttpUrl(url)) {
      toast('请输入有效的网页链接。', { type: 'error' })
      return
    }
    setSaving(true)
    try {
      const res = await api.createDocument(url)
      if (res.duplicate) {
        toast('这篇内容已经保存过了。', {
          action: { label: '打开已有收藏', onClick: () => navigate(`/documents/${res.id}`) },
        })
      } else {
        toast('已保存，正在整理内容……')
      }
      await loadRecent()
    } catch (e) {
      toast(errorMessage(e, '保存失败，请稍后重试。'), { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  function handleCardTerminal(status: ParseStatus) {
    const content = terminalToastContent(status)
    toast(content.message, { type: content.type })
    // 处理完成后刷新列表，让标题与摘要从原始 URL 更新为解析结果
    void loadRecent()
  }

  return (
    <div className="page">
      <section className="hero">
        <p className="hero-eyebrow">Save anything. Find it by memory.</p>
        <h1 className="hero-title">
          <span className="hero-line">你只需要记得，</span>
          <span className="hero-line">
            你想<em>找</em>什么。
          </span>
        </h1>
        <p className="hero-lede">用一句话，找回你收藏过的内容。</p>
        <SearchBox onSubmit={handleSearch} loading={searching} />
        <SaveBox onSave={handleSave} saving={saving} />
      </section>

      {searchError && <div className="notice notice--error">{searchError}</div>}

      {results !== null ? (
        <section>
          <div className="section-head">
            <h2>
              搜索结果
              <span className="section-count">{results.length} 条</span>
            </h2>
            <button type="button" className="section-link" onClick={() => setResults(null)}>
              清除
            </button>
          </div>
          {results.length === 0 ? (
            <div className="empty-state">没有足够相关的内容。换一种描述，或者先保存那篇内容。</div>
          ) : (
            <div className="list">
              {results.map((item) => (
                <SearchResultCard key={item.document_id} item={item} />
              ))}
            </div>
          )}
        </section>
      ) : (
        <section>
          <div className="section-head">
            <h2>最近收藏</h2>
            <Link className="section-link" to="/documents">
              查看全部
            </Link>
          </div>
          {recentError && <div className="notice notice--error">{recentError}</div>}
          {recent.length === 0 && !recentError ? (
            <div className="empty-state">还没有收藏。粘贴第一个链接或一段分享文字，寻迹会自动整理。</div>
          ) : (
            <div className="list">
              {recent.map((doc) => (
                <DocumentSummaryCard key={doc.id} doc={doc} onTerminal={handleCardTerminal} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
