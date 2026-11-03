import { Link } from 'react-router-dom'
import type { DocumentSummary, SearchResult } from '@trovia/shared'
import { domainOf, formatRelativeDate, SOURCE_TYPE_LABELS } from '@trovia/shared'
import { LiveStatusBadge } from './LiveStatusBadge'

/** 搜索结果：标题、来源、摘要、匹配原因、引用片段。 */
export function SearchResultCard({ item }: { item: SearchResult }) {
  return (
    <article className="list-item">
      <div className="item-head">
        <h3 className="item-title">
          <Link to={`/documents/${item.document_id}`}>{item.title || item.url}</Link>
        </h3>
        <LiveStatusBadge docId={item.document_id} status={item.parse_status} />
      </div>
      <div className="item-meta">
        <span>{domainOf(item.url)}</span>{' '}
        <span>{item.site_name || SOURCE_TYPE_LABELS[item.source_type]}</span>{' '}
        <span>收藏于 {formatRelativeDate(item.saved_at)}</span>
      </div>
      {item.summary && <p className="item-summary">{item.summary}</p>}
      <div className="item-match">
        <span className="item-match-label">为什么找到它</span>
        <p className="item-match-text">{item.match_reason}</p>
      </div>
      {item.matched_excerpt && <blockquote className="matched-excerpt">{item.matched_excerpt}</blockquote>}
      <div className="item-actions">
        <a className="item-link" href={item.url} target="_blank" rel="noopener noreferrer">
          打开原文
        </a>
      </div>
    </article>
  )
}

/** 列表/最近收藏：标题、摘要、来源与时间；只有未整理完才显示状态。 */
export function DocumentSummaryCard({
  doc,
  onTerminal,
}: {
  doc: DocumentSummary
  onTerminal?: (status: DocumentSummary['parse_status']) => void
}) {
  return (
    <article className="list-item">
      <div className="item-head">
        <h3 className="item-title">
          <Link to={`/documents/${doc.id}`}>{doc.title || doc.url}</Link>
        </h3>
        <LiveStatusBadge docId={doc.id} status={doc.parse_status} onTerminal={onTerminal} />
      </div>
      {doc.summary_short && <p className="item-summary">{doc.summary_short}</p>}
      <div className="item-meta">
        <span>{domainOf(doc.url)}</span>{' '}
        <span>{doc.site_name || SOURCE_TYPE_LABELS[doc.source_type]}</span>{' '}
        <span>收藏于 {formatRelativeDate(doc.saved_at)}</span>
      </div>
    </article>
  )
}
