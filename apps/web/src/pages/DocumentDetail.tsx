import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api/client'
import type { DocumentDetail, ParseStatus, RelatedItem } from '@trovia/shared'
import {
  dedupeRelated,
  domainOf,
  errorMessage,
  formatDate,
  RELATION_LABELS,
  sourceLabel,
  SOURCE_TYPE_LABELS,
} from '@trovia/shared'
import { ArrowLeftIcon } from '../components/Icons'
import { LiveStatusBadge } from '../components/LiveStatusBadge'
import { Markdown } from '../components/Markdown'
import { useToast } from '../components/Toast'

export default function DocumentDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [doc, setDoc] = useState<DocumentDetail | null>(null)
  const [related, setRelated] = useState<RelatedItem[]>([])
  const [status, setStatus] = useState<ParseStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reprocessing, setReprocessing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [detail, relatedRes] = await Promise.all([api.getDocument(id), api.getRelated(id)])
      setDoc(detail)
      setStatus(detail.parse_status)
      setRelated(relatedRes.items)
      setError(null)
    } catch (e) {
      setError(errorMessage(e, '加载收藏详情失败，请稍后重试。'))
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function handleReprocess() {
    if (!id) return
    setReprocessing(true)
    try {
      await api.reprocessDocument(id)
      setStatus('pending')
      toast('已重新提交解析任务，正在整理内容……')
    } catch (e) {
      toast(errorMessage(e, '重新解析失败，请稍后重试。'), { type: 'error' })
    } finally {
      setReprocessing(false)
    }
  }

  async function handleDelete() {
    if (!id) return
    if (!window.confirm('确定要删除这篇收藏吗？删除后无法恢复。')) return
    setDeleting(true)
    try {
      await api.deleteDocument(id)
      toast('已删除这篇收藏。')
      navigate('/documents')
    } catch (e) {
      toast(errorMessage(e, '删除失败，请稍后重试。'), { type: 'error' })
      setDeleting(false)
    }
  }

  if (error) {
    return (
      <div className="page">
        <Link className="back-link" to="/documents">
          <ArrowLeftIcon />
          收藏
        </Link>
        <div className="notice notice--error">{error}</div>
      </div>
    )
  }

  if (!doc || status === null) {
    return (
      <div className="page">
        <div className="loading-row">正在加载……</div>
      </div>
    )
  }

  const bodySource = doc.content_markdown ?? doc.plain_text ?? ''
  const canReprocess = status === 'partial' || status === 'failed'
  const relatedItems = dedupeRelated(related)

  return (
    <div className="page">
      <Link className="back-link" to="/documents">
        <ArrowLeftIcon />
        收藏
      </Link>

      <article>
        <header>
          <h1 className="detail-title">{doc.title || doc.url}</h1>
          <p className="detail-meta">
            <span>{sourceLabel(doc.url, doc.site_name, SOURCE_TYPE_LABELS[doc.source_type])}</span>{' '}
            {doc.author && <span>{doc.author}</span>}{' '}
            <span>收藏于 {formatDate(doc.saved_at)}</span>
          </p>

          {status !== 'completed' && (
            <div className="detail-status">
              <LiveStatusBadge docId={doc.id} status={status} onTerminal={() => void load()} />
              {canReprocess && (
                <button type="button" className="text-action" onClick={handleReprocess} disabled={reprocessing}>
                  {reprocessing ? '提交中…' : '重新解析'}
                </button>
              )}
            </div>
          )}
        </header>

        {(doc.summary_short || doc.summary_long) && (
          <section className="summary-block">
            <span className="label">摘要</span>
            {doc.summary_short && <p className="summary-lead">{doc.summary_short}</p>}
            {doc.summary_long && <p className="summary-long">{doc.summary_long}</p>}
          </section>
        )}

        {doc.keywords.length > 0 && (
          <div className="keyword-line">
            <span className="label">关键词</span>
            {doc.keywords.map((kw) => (
              <span key={kw} className="chip">
                {kw}
              </span>
            ))}
          </div>
        )}

        <section className="article-body">
          {bodySource ? (
            <div className="markdown-body">
              <Markdown source={bodySource} />
            </div>
          ) : (
            <div className="empty-state">正文暂时无法读取，原始链接始终为你保留。</div>
          )}
        </section>

        {relatedItems.length > 0 && (
          <section className="related">
            <h2>相关收藏</h2>
            <ul className="related-list">
              {relatedItems.map((item) => (
                <li key={item.document_id} className="related-item">
                  <Link to={`/documents/${item.document_id}`}>{item.title || item.url}</Link>
                  <span className="related-meta">
                    {RELATION_LABELS[item.relation_type] ?? item.relation_type} · {domainOf(item.url)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="detail-footer">
          <a className="btn btn-primary" href={doc.url} target="_blank" rel="noopener noreferrer">
            打开原文
          </a>
          <button type="button" className="link-danger" onClick={handleDelete} disabled={deleting}>
            {deleting ? '删除中…' : '删除这篇收藏'}
          </button>
        </footer>
      </article>
    </div>
  )
}
