import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, clearToken } from '../api/client'
import type { User } from '@trovia/shared'
import { errorMessage, formatDate } from '@trovia/shared'
import { useToast } from '../components/Toast'

export default function Settings() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .me()
      .then((u) => {
        if (!cancelled) setUser(u)
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e, '加载账户信息失败，请稍后重试。'))
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await api.logout()
    } catch {
      // 退出失败也清除本地 token，保证本地会话终止
    } finally {
      clearToken()
      toast('已退出登录。')
      navigate('/login')
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>账户</h1>
      </div>

      {error && <div className="notice notice--error">{error}</div>}
      {!error && !user && <div className="loading-row">正在加载……</div>}

      {user && (
        <dl className="account-list">
          <div className="account-row">
            <dt>邮箱</dt>
            <dd>{user.email}</dd>
          </div>
          <div className="account-row">
            <dt>加入时间</dt>
            <dd>{formatDate(user.created_at)}</dd>
          </div>
        </dl>
      )}

      <p className="account-note">你的收藏只属于你。Trovia 只在你自己的收藏中检索，不做公开索引。</p>

      <button type="button" className="btn btn-quiet" onClick={handleLogout} disabled={loggingOut}>
        {loggingOut ? '退出中…' : '退出登录'}
      </button>
    </div>
  )
}
