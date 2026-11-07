import type { ReactElement } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { getToken } from './api/client'
import { ToastProvider } from './components/Toast'
import Home from './pages/Home'
import Documents from './pages/Documents'
import DocumentDetailPage from './pages/DocumentDetail'
import Settings from './pages/Settings'
import Login from './pages/Login'
import Register from './pages/Register'

function RequireAuth({ children }: { children: ReactElement }) {
  return getToken() ? children : <Navigate to="/login" replace />
}

function AppLayout({ children }: { children: ReactElement }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand" aria-label="Trovia 首页">
          Trovia
        </Link>
        <nav className="topnav" aria-label="主导航">
          <NavLink to="/settings" className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}>
            账户
          </NavLink>
        </nav>
      </header>
      <main className="app-main">{children}</main>
    </div>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route
            path="/"
            element={
              <AppLayout>
                <RequireAuth>
                  <Home />
                </RequireAuth>
              </AppLayout>
            }
          />
          <Route
            path="/documents"
            element={
              <AppLayout>
                <RequireAuth>
                  <Documents />
                </RequireAuth>
              </AppLayout>
            }
          />
          <Route
            path="/documents/:id"
            element={
              <AppLayout>
                <RequireAuth>
                  <DocumentDetailPage />
                </RequireAuth>
              </AppLayout>
            }
          />
          <Route
            path="/settings"
            element={
              <AppLayout>
                <RequireAuth>
                  <Settings />
                </RequireAuth>
              </AppLayout>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  )
}
