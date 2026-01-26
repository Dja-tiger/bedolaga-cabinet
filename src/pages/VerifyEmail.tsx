import { useEffect, useState } from 'react'
import { useSearchParams, Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { authApi } from '../api/auth'
import { useAuthStore } from '../store/auth'
import { tokenStorage } from '../utils/token'
import LanguageSwitcher from '../components/LanguageSwitcher'

export default function VerifyEmail() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')
  const [error, setError] = useState('')
  const { setTokens, setUser, checkAdminStatus } = useAuthStore()

  useEffect(() => {
    const token = searchParams.get('token')

    if (!token) {
      setStatus('error')
      setError(t('common.error'))
      return
    }

    const verify = async () => {
      try {
        const response = await authApi.verifyEmail(token)
        // Save tokens and log user in
        tokenStorage.setTokens(response.access_token, response.refresh_token)
        setTokens(response.access_token, response.refresh_token)
        setUser(response.user)
        checkAdminStatus()
        setStatus('success')
        // Redirect to dashboard after short delay
        setTimeout(() => navigate('/', { replace: true }), 1500)
      } catch (err: unknown) {
        setStatus('error')
        const error = err as { response?: { data?: { detail?: string } } }
        setError(error.response?.data?.detail || t('emailVerification.failed'))
      }
    }

    verify()
  }, [searchParams, t, navigate, setTokens, setUser, checkAdminStatus])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-8 px-4 sm:py-12">
      {/* Language switcher in corner */}
      <div className="fixed top-4 right-4 z-50">
        <LanguageSwitcher />
      </div>

      <div className="max-w-md w-full text-center">
        {status === 'loading' && (
          <div>
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">{t('emailVerification.verifying')}</h2>
            <p className="text-sm sm:text-base text-gray-500 mt-2">{t('emailVerification.pleaseWait')}</p>
          </div>
        )}

        {status === 'success' && (
          <div>
            <div className="text-green-500 text-5xl sm:text-6xl mb-4">✓</div>
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">{t('emailVerification.success')}</h2>
            <p className="text-sm sm:text-base text-gray-500 mt-2">
              {t('emailVerification.redirecting', 'Redirecting to dashboard...')}
            </p>
            <div className="mt-4">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600 mx-auto"></div>
            </div>
          </div>
        )}

        {status === 'error' && (
          <div>
            <div className="text-red-500 text-5xl sm:text-6xl mb-4">✗</div>
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">{t('emailVerification.failed')}</h2>
            <p className="text-sm sm:text-base text-gray-500 mt-2">{error}</p>
            <div className="mt-6">
              <Link to="/login" className="btn-secondary">
                {t('emailVerification.goToLogin')}
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
