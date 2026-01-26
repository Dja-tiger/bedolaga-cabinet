import { useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { authApi } from '../api/auth'
import LanguageSwitcher from '../components/LanguageSwitcher'

export default function ResetPassword() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [status, setStatus] = useState<'form' | 'loading' | 'success' | 'error'>('form')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!token) {
      setError(t('resetPassword.invalidToken', 'Invalid or missing reset token'))
      return
    }

    if (password.length < 8) {
      setError(t('auth.passwordTooShort', 'Password must be at least 8 characters'))
      return
    }

    if (password !== confirmPassword) {
      setError(t('auth.passwordMismatch', 'Passwords do not match'))
      return
    }

    setStatus('loading')

    try {
      await authApi.resetPassword(token, password)
      setStatus('success')
      setTimeout(() => navigate('/login', { replace: true }), 2000)
    } catch (err: unknown) {
      setStatus('error')
      const error = err as { response?: { data?: { detail?: string } } }
      setError(error.response?.data?.detail || t('common.error'))
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center py-8 px-4 sm:py-12">
        <div className="fixed inset-0 bg-gradient-to-br from-dark-950 via-dark-900 to-dark-950" />
        <div className="fixed top-4 right-4 z-50">
          <LanguageSwitcher />
        </div>
        <div className="relative max-w-md w-full text-center">
          <div className="card">
            <div className="text-error-400 text-5xl mb-4">!</div>
            <h2 className="text-xl font-semibold text-dark-50 mb-2">
              {t('resetPassword.invalidToken', 'Invalid reset link')}
            </h2>
            <p className="text-dark-400 mb-6">
              {t('resetPassword.tokenExpiredOrInvalid', 'This password reset link is invalid or has expired.')}
            </p>
            <Link to="/login" className="btn-primary w-full inline-block">
              {t('auth.backToLogin', 'Back to login')}
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center py-8 px-4 sm:py-12">
      <div className="fixed inset-0 bg-gradient-to-br from-dark-950 via-dark-900 to-dark-950" />
      <div className="fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-accent-500/10 via-transparent to-transparent" />
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher />
      </div>

      <div className="relative max-w-md w-full">
        <div className="card">
          {status === 'success' ? (
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-success-500/20 flex items-center justify-center">
                <svg className="w-8 h-8 text-success-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h2 className="text-xl font-bold text-dark-50 mb-2">
                {t('resetPassword.success', 'Password changed!')}
              </h2>
              <p className="text-dark-400 mb-4">
                {t('resetPassword.redirectingToLogin', 'Redirecting to login...')}
              </p>
              <div className="animate-spin rounded-full h-6 w-6 border-2 border-accent-500 border-t-transparent mx-auto" />
            </div>
          ) : (
            <>
              <h2 className="text-xl font-bold text-dark-50 mb-2 text-center">
                {t('resetPassword.title', 'Set new password')}
              </h2>
              <p className="text-dark-400 mb-6 text-center">
                {t('resetPassword.enterNewPassword', 'Enter your new password below.')}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="password" className="label">
                    {t('auth.password', 'Password')}
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="input"
                    autoComplete="new-password"
                    disabled={status === 'loading'}
                  />
                </div>

                <div>
                  <label htmlFor="confirmPassword" className="label">
                    {t('auth.confirmPassword', 'Confirm Password')}
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="input"
                    autoComplete="new-password"
                    disabled={status === 'loading'}
                  />
                </div>

                {error && (
                  <div className="bg-error-500/10 border border-error-500/30 text-error-400 px-4 py-3 rounded-xl text-sm">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="btn-primary w-full"
                >
                  {status === 'loading' ? (
                    <span className="flex items-center justify-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      {t('common.loading')}
                    </span>
                  ) : (
                    t('resetPassword.setPassword', 'Set new password')
                  )}
                </button>
              </form>

              <div className="mt-4 text-center">
                <Link to="/login" className="text-sm text-dark-400 hover:text-dark-200 transition-colors">
                  {t('auth.backToLogin', 'Back to login')}
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
