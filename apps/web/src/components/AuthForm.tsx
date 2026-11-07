import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Link } from 'react-router-dom'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 登录/注册共用表单：邮箱格式 + 密码 ≥ 8 位客户端校验；
 * onSubmit 抛出的错误（服务端 message）显示在表单顶部。
 */
export function AuthForm({
  title,
  submitLabel,
  onSubmit,
  footer,
  newPassword = false,
}: {
  title: string
  submitLabel: string
  onSubmit: (email: string, password: string) => Promise<void>
  footer: ReactNode
  newPassword?: boolean
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const nextEmailError = EMAIL_PATTERN.test(email.trim()) ? null : '请输入有效的邮箱地址。'
    const nextPasswordError = password.length >= 8 ? null : '密码至少需要 8 位。'
    setEmailError(nextEmailError)
    setPasswordError(nextPasswordError)
    if (nextEmailError || nextPasswordError) return
    setFormError(null)
    setBusy(true)
    try {
      await onSubmit(email.trim(), password)
    } catch (err) {
      setFormError(err && typeof err === 'object' && 'message' in err ? String((err as Error).message) : '请求失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <Link to="/" className="auth-brand-name">
          Trovia
        </Link>
        <p className="auth-tagline">Save anything. Find it by memory.</p>
      </div>
      <div className="auth-card">
        <h1 className="auth-title">{title}</h1>
        {formError && <div className="notice notice--error">{formError}</div>}
        <form onSubmit={submit} noValidate>
          <label className="field">
            <span className="field-label">邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="you@example.com"
            />
            {emailError && <span className="field-error">{emailError}</span>}
          </label>
          <label className="field">
            <span className="field-label">密码</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={newPassword ? 'new-password' : 'current-password'}
              placeholder="至少 8 位"
            />
            {passwordError && <span className="field-error">{passwordError}</span>}
          </label>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? '提交中…' : submitLabel}
          </button>
        </form>
        <div className="auth-footer">{footer}</div>
      </div>
    </div>
  )
}
