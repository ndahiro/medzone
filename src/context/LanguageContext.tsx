/**
 * MedZone language preference (HCW@Home "multilingual — serve patients in
 * their own language" parity).
 *
 * The patient portal is the surface where a language choice matters most, so
 * this provider exposes a small translation table plus a persisted preference.
 * Only the presentation strings live here — no clinical data, and no PHI ever
 * reaches localStorage.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type LanguageCode = 'en' | 'fr' | 'es' | 'ar';

export const LANGUAGES: { code: LanguageCode; label: string; native: string }[] = [
  { code: 'en', label: 'English', native: 'English' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'ar', label: 'Arabic', native: 'العربية' },
];

type Dictionary = Record<string, string>;

/**
 * UI strings only. Deliberately a focused set that covers the patient portal's
 * navigation and primary actions — the pattern is what matters, and an
 * untranslated string always falls back to English rather than to a key.
 *
 * Exported so tests/local-language.test.ts can pin every locale to the same
 * key set: a language that is missing a string silently degrades to English
 * for that one label, which is exactly how a half-translated UI ships.
 */
export const TRANSLATIONS: Record<LanguageCode, Dictionary> = {
  en: {
    'nav.home': 'Home',
    'nav.visits': 'Visits',
    'nav.schedule': 'Schedule',
    'nav.records': 'Records',
    'nav.meds': 'Meds',
    'nav.users': 'Users',
    'app.language': 'Language',
    'common.signOut': 'Sign out',
    'common.cancel': 'Cancel',
    'portal.hipaa': 'HIPAA-Ready Encrypted Portal',
    'portal.welcome': 'Welcome back',
    'portal.upcoming': 'Upcoming Virtual Consultations',
    'portal.noUpcoming': 'No upcoming consultations',
    'portal.noUpcomingHint': 'Schedule a virtual tele-visit with one of our certified medical specialists.',
    'portal.book': 'Book Virtual Consultation',
    'portal.schedule': 'Schedule Appointment',
    'portal.export': 'Export Medical Summary',
    'portal.join': 'Join Video Visit',
    'portal.vitals': 'Recent Vitals & Biometrics',
    'portal.meds': 'Active Regimens & Refills',
    'portal.logDose': 'Log Dose Taken',
    'portal.refill': 'Refill',
    'portal.reason': 'Reason for visit',
    'waiting.title': 'Clinic waiting room',
    'waiting.empty': 'No one is waiting right now',
    'waiting.claim': 'Pick up patient',
    'waiting.claimedBy': 'Picked up by',
    'invite.title': 'Invite patient',
    'invite.share': 'Share a one-click join link.',
    'invite.copy': 'Copy link',
    'invite.copied': 'Copied',
    'invite.sms': 'SMS',
    'invite.email': 'Email',
    'invite.whatsapp': 'WhatsApp',
    'attachments.title': 'Shared files & images',
    'attachments.share': 'Share file',
    'attachments.empty': 'No files shared yet.',
  },
  fr: {
    'nav.home': 'Accueil',
    'nav.visits': 'Consultations',
    'nav.schedule': 'Agenda',
    'nav.records': 'Dossiers',
    'nav.meds': 'Médicaments',
    'nav.users': 'Utilisateurs',
    'app.language': 'Langue',
    'common.signOut': 'Déconnexion',
    'common.cancel': 'Annuler',
    'portal.hipaa': 'Portail chiffré conforme HIPAA',
    'portal.welcome': 'Bon retour',
    'portal.upcoming': 'Consultations virtuelles à venir',
    'portal.noUpcoming': 'Aucune consultation à venir',
    'portal.noUpcomingHint': 'Planifiez une téléconsultation avec l’un de nos spécialistes agréés.',
    'portal.book': 'Réserver une consultation virtuelle',
    'portal.schedule': 'Planifier un rendez-vous',
    'portal.export': 'Exporter le résumé médical',
    'portal.join': 'Rejoindre la visite vidéo',
    'portal.vitals': 'Signes vitaux récents',
    'portal.meds': 'Traitements actifs et renouvellements',
    'portal.logDose': 'Enregistrer la prise',
    'portal.refill': 'Renouveler',
    'portal.reason': 'Motif de la visite',
    'waiting.title': 'Salle d’attente de la clinique',
    'waiting.empty': 'Personne n’attend pour le moment',
    'waiting.claim': 'Prendre en charge',
    'waiting.claimedBy': 'Pris en charge par',
    'invite.title': 'Inviter le patient',
    'invite.share': 'Partagez un lien de connexion en un clic.',
    'invite.copy': 'Copier le lien',
    'invite.copied': 'Copié',
    'invite.sms': 'SMS',
    'invite.email': 'E-mail',
    'invite.whatsapp': 'WhatsApp',
    'attachments.title': 'Fichiers et images partagés',
    'attachments.share': 'Partager un fichier',
    'attachments.empty': 'Aucun fichier partagé pour l’instant.',
  },
  es: {
    'nav.home': 'Inicio',
    'nav.visits': 'Consultas',
    'nav.schedule': 'Agenda',
    'nav.records': 'Historiales',
    'nav.meds': 'Medicamentos',
    'nav.users': 'Usuarios',
    'app.language': 'Idioma',
    'common.signOut': 'Cerrar sesión',
    'common.cancel': 'Cancelar',
    'portal.hipaa': 'Portal cifrado compatible con HIPAA',
    'portal.welcome': 'Bienvenido de nuevo',
    'portal.upcoming': 'Próximas consultas virtuales',
    'portal.noUpcoming': 'No hay consultas próximas',
    'portal.noUpcomingHint': 'Programe una teleconsulta con uno de nuestros especialistas certificados.',
    'portal.book': 'Reservar consulta virtual',
    'portal.schedule': 'Programar cita',
    'portal.export': 'Exportar resumen médico',
    'portal.join': 'Unirse a la videollamada',
    'portal.vitals': 'Signos vitales recientes',
    'portal.meds': 'Tratamientos activos y recetas',
    'portal.logDose': 'Registrar dosis',
    'portal.refill': 'Renovar',
    'portal.reason': 'Motivo de la consulta',
    'waiting.title': 'Sala de espera de la clínica',
    'waiting.empty': 'Nadie está esperando ahora mismo',
    'waiting.claim': 'Atender paciente',
    'waiting.claimedBy': 'Atendido por',
    'invite.title': 'Invitar al paciente',
    'invite.share': 'Comparta un enlace de acceso en un clic.',
    'invite.copy': 'Copiar enlace',
    'invite.copied': 'Copiado',
    'invite.sms': 'SMS',
    'invite.email': 'Correo',
    'invite.whatsapp': 'WhatsApp',
    'attachments.title': 'Archivos e imágenes compartidos',
    'attachments.share': 'Compartir archivo',
    'attachments.empty': 'Aún no se han compartido archivos.',
  },
  ar: {
    'nav.home': 'الرئيسية',
    'nav.visits': 'الزيارات',
    'nav.schedule': 'المواعيد',
    'nav.records': 'السجلات',
    'nav.meds': 'الأدوية',
    'nav.users': 'المستخدمون',
    'app.language': 'اللغة',
    'common.signOut': 'تسجيل الخروج',
    'common.cancel': 'إلغاء',
    'portal.hipaa': 'بوابة مشفّرة متوافقة مع HIPAA',
    'portal.welcome': 'مرحبًا بعودتك',
    'portal.upcoming': 'الاستشارات الافتراضية القادمة',
    'portal.noUpcoming': 'لا توجد استشارات قادمة',
    'portal.noUpcomingHint': 'احجز استشارة عبر الإنترنت مع أحد أخصائيينا المعتمدين.',
    'portal.book': 'حجز استشارة افتراضية',
    'portal.schedule': 'تحديد موعد',
    'portal.export': 'تصدير الملخص الطبي',
    'portal.join': 'الانضمام إلى مكالمة الفيديو',
    'portal.vitals': 'العلامات الحيوية الأخيرة',
    'portal.meds': 'العلاجات النشطة وإعادة الصرف',
    'portal.logDose': 'تسجيل الجرعة',
    'portal.refill': 'إعادة صرف',
    'portal.reason': 'سبب الزيارة',
    'waiting.title': 'غرفة انتظار العيادة',
    'waiting.empty': 'لا أحد ينتظر حاليًا',
    'waiting.claim': 'استقبال المريض',
    'waiting.claimedBy': 'تم الاستقبال بواسطة',
    'invite.title': 'دعوة المريض',
    'invite.share': 'شارك رابط انضمام بنقرة واحدة.',
    'invite.copy': 'نسخ الرابط',
    'invite.copied': 'تم النسخ',
    'invite.sms': 'رسالة نصية',
    'invite.email': 'البريد الإلكتروني',
    'invite.whatsapp': 'واتساب',
    'attachments.title': 'الملفات والصور المشتركة',
    'attachments.share': 'مشاركة ملف',
    'attachments.empty': 'لم تتم مشاركة أي ملفات بعد.',
  },
};

const STORAGE_KEY = 'medzone_ui_v1_lang';

interface LanguageContextValue {
  lang: LanguageCode;
  setLang: (lang: LanguageCode) => void;
  /** Translate a UI key; an unknown key falls back to English, then the key. */
  t: (key: string) => string;
  /** True for right-to-left languages (Arabic), so the shell can flip layout. */
  isRtl: boolean;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

const readStoredLang = (): LanguageCode => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && stored in TRANSLATIONS) return stored as LanguageCode;
  } catch {
    // Ignore storage failures — fall back to English.
  }
  return 'en';
};

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<LanguageCode>(readStoredLang);

  const setLang = useCallback((next: LanguageCode) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference simply is not persisted.
    }
  }, []);

  const value = useMemo<LanguageContextValue>(() => {
    const dict = TRANSLATIONS[lang] ?? TRANSLATIONS.en;
    return {
      lang,
      setLang,
      t: (key: string) => dict[key] ?? TRANSLATIONS.en[key] ?? key,
      isRtl: lang === 'ar',
    };
  }, [lang, setLang]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export const useLanguage = (): LanguageContextValue => {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider');
  return ctx;
};
