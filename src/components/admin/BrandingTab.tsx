import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { brandingApi, setCachedBranding } from '../../api/branding'
import { setCachedAnimationEnabled } from '../AnimatedBackground'
import { setCachedFullscreenEnabled } from '../../hooks/useTelegramWebApp'
import { UploadIcon, TrashIcon, PencilIcon, CheckIcon, CloseIcon } from './icons'
import { Toggle } from './Toggle'

interface BrandingTabProps {
  accentColor?: string
}

export function BrandingTab({ accentColor = '#3b82f6' }: BrandingTabProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [editingName, setEditingName] = useState(false)
  const [newName, setNewName] = useState('')

  // Queries
  const { data: branding } = useQuery({
    queryKey: ['branding'],
    queryFn: brandingApi.getBranding,
  })

  const { data: animationSettings } = useQuery({
    queryKey: ['animation-enabled'],
    queryFn: brandingApi.getAnimationEnabled,
  })

  const { data: fullscreenSettings } = useQuery({
    queryKey: ['fullscreen-enabled'],
    queryFn: brandingApi.getFullscreenEnabled,
  })

  const { data: emailAuthSettings } = useQuery({
    queryKey: ['email-auth-enabled'],
    queryFn: brandingApi.getEmailAuthEnabled,
  })

  // Mutations
  const updateBrandingMutation = useMutation({
    mutationFn: brandingApi.updateName,
    onSuccess: (data) => {
      setCachedBranding(data)
      queryClient.invalidateQueries({ queryKey: ['branding'] })
      setEditingName(false)
    },
  })

  const uploadLogoMutation = useMutation({
    mutationFn: brandingApi.uploadLogo,
    onSuccess: (data) => {
      setCachedBranding(data)
      queryClient.invalidateQueries({ queryKey: ['branding'] })
    },
  })

  const deleteLogoMutation = useMutation({
    mutationFn: brandingApi.deleteLogo,
    onSuccess: (data) => {
      setCachedBranding(data)
      queryClient.invalidateQueries({ queryKey: ['branding'] })
    },
  })

  const updateAnimationMutation = useMutation({
    mutationFn: (enabled: boolean) => brandingApi.updateAnimationEnabled(enabled),
    onSuccess: (data) => {
      setCachedAnimationEnabled(data.enabled)
      queryClient.invalidateQueries({ queryKey: ['animation-enabled'] })
    },
  })

  const updateFullscreenMutation = useMutation({
    mutationFn: (enabled: boolean) => brandingApi.updateFullscreenEnabled(enabled),
    onSuccess: (data) => {
      setCachedFullscreenEnabled(data.enabled)
      queryClient.invalidateQueries({ queryKey: ['fullscreen-enabled'] })
    },
  })

  const updateEmailAuthMutation = useMutation({
    mutationFn: (enabled: boolean) => brandingApi.updateEmailAuthEnabled(enabled),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['email-auth-enabled'] })
    },
  })

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      uploadLogoMutation.mutate(file)
    }
  }

  return (
    <div className="space-y-6">
      {/* Logo & Name */}
      <div className="p-6 rounded-2xl bg-dark-800/50 border border-dark-700/50">
        <h3 className="text-lg font-semibold text-dark-100 mb-4">{t('admin.settings.logoAndName')}</h3>

        <div className="flex items-start gap-6">
          {/* Logo */}
          <div className="flex-shrink-0">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl font-bold text-white overflow-hidden"
              style={{
                background: `linear-gradient(135deg, ${accentColor}, ${accentColor}dd)`
              }}
            >
              {branding?.has_custom_logo ? (
                <img src={brandingApi.getLogoUrl(branding) ?? undefined} alt="Logo" className="w-full h-full object-cover" />
              ) : (
                branding?.logo_letter || 'V'
              )}
            </div>

            <div className="flex gap-2 mt-3">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadLogoMutation.isPending}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-dark-700 hover:bg-dark-600 text-dark-200 text-sm transition-colors disabled:opacity-50"
              >
                <UploadIcon />
              </button>
              {branding?.has_custom_logo && (
                <button
                  onClick={() => deleteLogoMutation.mutate()}
                  disabled={deleteLogoMutation.isPending}
                  className="px-3 py-2 rounded-xl bg-dark-700 hover:bg-error-500/20 text-dark-400 hover:text-error-400 transition-colors disabled:opacity-50"
                >
                  <TrashIcon />
                </button>
              )}
            </div>
          </div>

          {/* Name */}
          <div className="flex-1">
            <label className="block text-sm font-medium text-dark-300 mb-2">{t('admin.settings.projectName')}</label>
            {editingName ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="flex-1 px-4 py-2 rounded-xl bg-dark-700 border border-dark-600 text-dark-100 focus:outline-none focus:border-accent-500"
                  maxLength={50}
                />
                <button
                  onClick={() => updateBrandingMutation.mutate(newName)}
                  disabled={updateBrandingMutation.isPending}
                  className="px-4 py-2 rounded-xl bg-accent-500 text-white hover:bg-accent-600 transition-colors disabled:opacity-50"
                >
                  <CheckIcon />
                </button>
                <button
                  onClick={() => setEditingName(false)}
                  className="px-4 py-2 rounded-xl bg-dark-700 text-dark-300 hover:bg-dark-600 transition-colors"
                >
                  <CloseIcon />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-lg text-dark-100">{branding?.name || t('admin.settings.notSpecified')}</span>
                <button
                  onClick={() => {
                    setNewName(branding?.name ?? '')
                    setEditingName(true)
                  }}
                  className="p-1.5 rounded-lg text-dark-400 hover:text-dark-200 hover:bg-dark-700 transition-colors"
                >
                  <PencilIcon />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Animation & Fullscreen toggles */}
      <div className="p-6 rounded-2xl bg-dark-800/50 border border-dark-700/50">
        <h3 className="text-lg font-semibold text-dark-100 mb-4">{t('admin.settings.interfaceOptions')}</h3>

        <div className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-xl bg-dark-700/30">
            <div>
              <span className="font-medium text-dark-100">{t('admin.settings.animatedBackground')}</span>
              <p className="text-sm text-dark-400">{t('admin.settings.animatedBackgroundDesc')}</p>
            </div>
            <Toggle
              checked={animationSettings?.enabled ?? true}
              onChange={() => updateAnimationMutation.mutate(!(animationSettings?.enabled ?? true))}
              disabled={updateAnimationMutation.isPending}
            />
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl bg-dark-700/30">
            <div>
              <span className="font-medium text-dark-100">{t('admin.settings.autoFullscreen')}</span>
              <p className="text-sm text-dark-400">{t('admin.settings.autoFullscreenDesc')}</p>
            </div>
            <Toggle
              checked={fullscreenSettings?.enabled ?? false}
              onChange={() => updateFullscreenMutation.mutate(!(fullscreenSettings?.enabled ?? false))}
              disabled={updateFullscreenMutation.isPending}
            />
          </div>

          <div className="flex items-center justify-between p-4 rounded-xl bg-dark-700/30">
            <div>
              <span className="font-medium text-dark-100">{t('admin.settings.emailAuth')}</span>
              <p className="text-sm text-dark-400">{t('admin.settings.emailAuthDesc')}</p>
            </div>
            <Toggle
              checked={emailAuthSettings?.enabled ?? true}
              onChange={() => updateEmailAuthMutation.mutate(!(emailAuthSettings?.enabled ?? true))}
              disabled={updateEmailAuthMutation.isPending}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
