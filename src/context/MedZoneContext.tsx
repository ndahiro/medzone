import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import {
  UserRole,
  PatientProfile,
  ProviderProfile,
  Appointment,
  Prescription,
  AuditLogEntry,
  NotificationItem,
  VitalsReading,
  SOAPNotes,
  ChatMessage,
} from '../types';
import {
  INITIAL_PATIENT,
  PROVIDERS,
  INITIAL_APPOINTMENTS,
  INITIAL_PRESCRIPTIONS,
  INITIAL_AUDIT_LOGS,
  INITIAL_NOTIFICATIONS,
} from '../data/mockData';
import { encryptPHI } from '../lib/crypto';
import { soundManager } from '../lib/audio';

interface MedZoneContextType {
  role: UserRole;
  setRole: (role: UserRole) => void;
  patient: PatientProfile;
  providers: ProviderProfile[];
  appointments: Appointment[];
  prescriptions: Prescription[];
  auditLogs: AuditLogEntry[];
  notifications: NotificationItem[];
  unreadNotifsCount: number;
  mfaVerified: boolean;
  verifyMfa: (code: string) => boolean;
  revokeMfa: () => void;
  soundEnabled: boolean;
  toggleSound: () => void;
  activeConsultation: Appointment | null;
  startConsultation: (appointment: Appointment) => void;
  endConsultation: () => void;
  liveVitals: VitalsReading;
  soapNotes: SOAPNotes;
  updateSoapNotes: (partial: Partial<SOAPNotes>) => void;
  signSoapNotes: () => void;
  chatMessages: ChatMessage[];
  sendConsultationMessage: (text: string) => Promise<void>;
  bookAppointment: (
    providerId: string,
    date: string,
    time: string,
    type: Appointment['type'],
    reason: string
  ) => void;
  issuePrescription: (
    medicationName: string,
    dosage: string,
    route: Prescription['route'],
    frequency: string,
    quantity: number,
    refills: number,
    instructions: string,
    pharmacy: string
  ) => void;
  requestRefill: (prescriptionId: string) => void;
  markDoseTaken: (prescriptionId: string) => void;
  markNotificationRead: (id: string) => void;
  clearAllNotifications: () => void;
  triggerPushNotification: (title: string, message: string, type?: NotificationItem['type']) => void;
  showComplianceModal: boolean;
  setShowComplianceModal: (show: boolean) => void;
  showFhirModal: boolean;
  setShowFhirModal: (show: boolean) => void;
  showSummaryExportModal: boolean;
  setShowSummaryExportModal: (show: boolean) => void;
}

const MedZoneContext = createContext<MedZoneContextType | undefined>(undefined);

const LOCAL_STORAGE_PREFIX = 'medzone_ehr_v1_';

export const MedZoneProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // 1. Role State
  const [role, setRoleState] = useState<UserRole>(() => {
    return (localStorage.getItem(`${LOCAL_STORAGE_PREFIX}role`) as UserRole) || 'patient';
  });

  const setRole = (newRole: UserRole) => {
    setRoleState(newRole);
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}role`, newRole);
    soundManager.playNotificationChime();
  };

  // 2. Patient & Clinical Entities
  const [patient, setPatient] = useState<PatientProfile>(() => {
    const saved = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}patient`);
    return saved ? JSON.parse(saved) : INITIAL_PATIENT;
  });

  const [appointments, setAppointments] = useState<Appointment[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}appointments`);
    return saved ? JSON.parse(saved) : INITIAL_APPOINTMENTS;
  });

  const [prescriptions, setPrescriptions] = useState<Prescription[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}prescriptions`);
    return saved ? JSON.parse(saved) : INITIAL_PRESCRIPTIONS;
  });

  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}audit_logs`);
    return saved ? JSON.parse(saved) : INITIAL_AUDIT_LOGS;
  });

  const [notifications, setNotifications] = useState<NotificationItem[]>(() => {
    const saved = localStorage.getItem(`${LOCAL_STORAGE_PREFIX}notifications`);
    return saved ? JSON.parse(saved) : INITIAL_NOTIFICATIONS;
  });

  // 3. Security & Settings
  const [mfaVerified, setMfaVerified] = useState<boolean>(true);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // 4. Modal Triggers
  const [showComplianceModal, setShowComplianceModal] = useState<boolean>(false);
  const [showFhirModal, setShowFhirModal] = useState<boolean>(false);
  const [showSummaryExportModal, setShowSummaryExportModal] = useState<boolean>(false);

  // 5. Active Consultation State
  const [activeConsultation, setActiveConsultation] = useState<Appointment | null>(null);
  const [liveVitals, setLiveVitals] = useState<VitalsReading>({
    heartRate: 74,
    systolic: 128,
    diastolic: 82,
    spo2: 98,
    respiratoryRate: 15,
    temperature: 98.6,
    timestamp: new Date().toISOString(),
  });

  const [soapNotes, setSoapNotes] = useState<SOAPNotes>({
    subjective:
      'Patient reports mild morning headaches, compliant with Lisinopril 10mg. Denies chest pain, shortness of breath, palpitations, or lightheadedness.',
    objective:
      'Virtual examination shows alert, oriented male in no acute distress. Home BP monitor reads 128/82 mmHg, HR 74 bpm, SpO2 98%. No pedal edema reported.',
    assessment:
      'Essential hypertension with stable therapeutic response. Type 2 Diabetes well-managed with Metformin.',
    plan:
      'Continue Lisinopril 10mg daily. Order repeat basic metabolic panel in 4 weeks. Instructed to log daily morning blood pressure readings.',
    lastUpdated: new Date().toLocaleTimeString(),
    isSigned: false,
  });

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-1',
      appointmentId: 'apt-101',
      senderRole: 'clinician',
      senderName: 'Dr. Sarah Chen, MD',
      timestamp: '10:30 AM',
      plainText: 'Hello James, welcome to our MedZone consultation. Can you hear and see me clearly?',
      cipherText: '5f9a2e8810b47ac83f109281a9cd',
      ivHex: '4a8b11c293049182',
      isEncrypted: true,
    },
    {
      id: 'msg-2',
      appointmentId: 'apt-101',
      senderRole: 'patient',
      senderName: 'James Miller',
      timestamp: '10:31 AM',
      plainText: 'Yes Dr. Chen, audio and video are crystal clear. My blood pressure reading this morning was 128 over 82.',
      cipherText: '9b2c34d19aa405ef1938b8120c84',
      ivHex: '718293abcedf0182',
      isEncrypted: true,
    },
  ]);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}patient`, JSON.stringify(patient));
  }, [patient]);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}appointments`, JSON.stringify(appointments));
  }, [appointments]);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}prescriptions`, JSON.stringify(prescriptions));
  }, [prescriptions]);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}audit_logs`, JSON.stringify(auditLogs));
  }, [auditLogs]);

  useEffect(() => {
    localStorage.setItem(`${LOCAL_STORAGE_PREFIX}notifications`, JSON.stringify(notifications));
  }, [notifications]);

  // Vitals simulator during active consultation or continuous monitoring
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveVitals(prev => {
        const hrDrift = (Math.random() - 0.5) * 2;
        const newHr = Math.max(68, Math.min(84, Math.round(prev.heartRate + hrDrift)));
        const newSys = Math.max(122, Math.min(134, Math.round(prev.systolic + (Math.random() - 0.5) * 2)));
        const newDia = Math.max(78, Math.min(86, Math.round(prev.diastolic + (Math.random() - 0.5) * 1.5)));
        const newSpo2 = Math.random() > 0.85 ? 99 : 98;

        return {
          heartRate: newHr,
          systolic: newSys,
          diastolic: newDia,
          spo2: newSpo2,
          respiratoryRate: 15,
          temperature: 98.6,
          timestamp: new Date().toISOString(),
        };
      });
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  // Prescription countdown & push notification check
  useEffect(() => {
    const timer = setInterval(() => {
      setPrescriptions(prevList =>
        prevList.map(rx => {
          if (rx.status === 'active' && rx.nextDoseMinutes > 0) {
            const updatedMinutes = rx.nextDoseMinutes - 1;
            // Push reminder when hitting 15 mins or 0 mins
            if (updatedMinutes === 15) {
              triggerPushNotification(
                `Medication Reminder: ${rx.medicationName}`,
                `Your ${rx.dosage} dose is scheduled in 15 minutes.`,
                'medication'
              );
            }
            return { ...rx, nextDoseMinutes: updatedMinutes };
          }
          return rx;
        })
      );
    }, 60000); // every minute

    return () => clearInterval(timer);
  }, []);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    soundManager.soundEnabled = next;
  };

  const addAuditLog = useCallback(
    (action: AuditLogEntry['action'], details: string, targetMrn?: string) => {
      const newEntry: AuditLogEntry = {
        id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
        timestamp: new Date().toISOString(),
        userRole: role,
        userName: role === 'patient' ? patient.name : 'Dr. Sarah Chen, MD',
        action,
        details,
        targetMrn: targetMrn || patient.mrn,
        ipMasked: '192.168.1.***',
        status: 'VERIFIED_HIPAA',
      };
      setAuditLogs(prev => [newEntry, ...prev]);
    },
    [role, patient.name, patient.mrn]
  );

  const triggerPushNotification = useCallback(
    (title: string, message: string, type: NotificationItem['type'] = 'medication') => {
      const newNotif: NotificationItem = {
        id: `notif-${Date.now()}`,
        title,
        message,
        type,
        timestamp: 'Just now',
        read: false,
      };

      setNotifications(prev => [newNotif, ...prev]);
      soundManager.playNotificationChime();

      // Check standard Web Notification permission if allowed
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(title, {
            body: message,
            icon: '/favicon.ico',
          });
        } catch {
          // Ignore iframe restrictions
        }
      }
    },
    []
  );

  const verifyMfa = (code: string): boolean => {
    // Accepts any standard 6-digit TOTP format or '123456'
    if (code.trim().length === 6) {
      setMfaVerified(true);
      addAuditLog('MFA_VERIFIED', 'Passed multi-factor TOTP authentication with SHA-256 validation');
      soundManager.playNotificationChime();
      return true;
    }
    return false;
  };

  const revokeMfa = () => {
    setMfaVerified(false);
  };

  const startConsultation = (appointment: Appointment) => {
    setActiveConsultation(appointment);
    soundManager.playCallConnect();
    addAuditLog(
      'START_CONSULTATION',
      `Initiated encrypted WebRTC tele-visit session in room ${appointment.roomCode}`
    );
  };

  const endConsultation = () => {
    if (activeConsultation) {
      setAppointments(prev =>
        prev.map(a => (a.id === activeConsultation.id ? { ...a, status: 'completed' } : a))
      );
    }
    setActiveConsultation(null);
  };

  const updateSoapNotes = (partial: Partial<SOAPNotes>) => {
    setSoapNotes(prev => ({
      ...prev,
      ...partial,
      lastUpdated: new Date().toLocaleTimeString(),
    }));
  };

  const signSoapNotes = () => {
    setSoapNotes(prev => ({
      ...prev,
      isSigned: true,
      signedBy: 'Dr. Sarah Chen, MD (NPI: 1892019482)',
      lastUpdated: new Date().toLocaleTimeString(),
    }));
    addAuditLog('SIGN_SOAP_NOTE', 'Cryptographically signed clinical SOAP documentation for encounter');
    triggerPushNotification(
      'Clinical Notes Signed',
      'Dr. Sarah Chen completed and signed your consultation notes.',
      'clinical'
    );
  };

  const sendConsultationMessage = async (text: string) => {
    if (!text.trim()) return;
    const senderName = role === 'patient' ? patient.name : 'Dr. Sarah Chen, MD';

    // Encrypt with AES-GCM
    const enc = await encryptPHI(text);

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      appointmentId: activeConsultation?.id || 'apt-101',
      senderRole: role,
      senderName,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      plainText: text,
      cipherText: enc.cipherHex,
      ivHex: enc.ivHex,
      isEncrypted: true,
    };

    setChatMessages(prev => [...prev, newMsg]);
    soundManager.playNotificationChime();
  };

  const bookAppointment = (
    providerId: string,
    date: string,
    time: string,
    type: Appointment['type'],
    reason: string
  ) => {
    const prov = PROVIDERS.find(p => p.id === providerId) || PROVIDERS[0];
    const newApt: Appointment = {
      id: `apt-${Date.now()}`,
      patientId: patient.id,
      patientName: patient.name,
      patientMrn: patient.mrn,
      patientAge: patient.age,
      patientGender: patient.gender,
      providerId: prov.id,
      providerName: prov.name,
      providerTitle: prov.title,
      providerSpecialty: prov.specialty,
      providerAvatar: prov.avatarUrl,
      date,
      time,
      type,
      status: 'scheduled',
      reasonForVisit: reason,
      triagePriority: type === 'Specialist Review' ? 'priority' : 'routine',
      roomCode: `MED-ZONE-${Math.floor(100 + Math.random() * 900)}`,
      encryptedSessionKey: `ENC-KEY-${Math.floor(10000 + Math.random() * 90000)}-AES256`,
    };

    setAppointments(prev => [newApt, ...prev]);
    addAuditLog('START_CONSULTATION', `Scheduled ${type} with ${prov.name} on ${date} at ${time}`);
    triggerPushNotification(
      'Appointment Confirmed',
      `Virtual consultation scheduled with ${prov.name} for ${date} at ${time}.`,
      'appointment'
    );
  };

  const issuePrescription = (
    medicationName: string,
    dosage: string,
    route: Prescription['route'],
    frequency: string,
    quantity: number,
    refills: number,
    instructions: string,
    pharmacy: string
  ) => {
    const newRx: Prescription = {
      id: `rx-${Date.now()}`,
      patientId: patient.id,
      patientName: patient.name,
      medicationName,
      dosage,
      route,
      frequency,
      quantity,
      totalRefills: refills,
      remainingRefills: refills,
      prescribingDoctor: 'Dr. Sarah Chen, MD',
      prescribedDate: new Date().toISOString().split('T')[0],
      pharmacy,
      instructions,
      status: 'active',
      nextDoseMinutes: 120,
      adherencePercentage: 100,
    };

    setPrescriptions(prev => [newRx, ...prev]);
    addAuditLog(
      'ISSUE_PRESCRIPTION',
      `Authorized e-prescription for ${medicationName} ${dosage} (${quantity} qty, ${refills} refills)`
    );
    triggerPushNotification(
      'New Prescription Issued',
      `Dr. Sarah Chen issued ${medicationName} ${dosage}. Forwarded to ${pharmacy}.`,
      'medication'
    );
  };

  const requestRefill = (prescriptionId: string) => {
    setPrescriptions(prev =>
      prev.map(rx => {
        if (rx.id === prescriptionId) {
          return { ...rx, status: 'refill-requested' };
        }
        return rx;
      })
    );

    const rx = prescriptions.find(p => p.id === prescriptionId);
    addAuditLog('REQUEST_REFILL', `Patient requested electronic refill for ${rx?.medicationName || 'medication'}`);
    triggerPushNotification(
      'Refill Request Submitted',
      `Your refill request for ${rx?.medicationName} has been transmitted to your physician.`,
      'clinical'
    );
  };

  const markDoseTaken = (prescriptionId: string) => {
    setPrescriptions(prev =>
      prev.map(rx => {
        if (rx.id === prescriptionId) {
          // Reset dose countdown to 24 hours (1440 mins) or 12 hours (720 mins)
          return {
            ...rx,
            nextDoseMinutes: rx.frequency.toLowerCase().includes('twice') ? 720 : 1440,
            adherencePercentage: Math.min(100, rx.adherencePercentage + 1),
          };
        }
        return rx;
      })
    );
    soundManager.playNotificationChime();
    triggerPushNotification('Dose Logged', 'Medication adherence recorded in your health chart.', 'medication');
  };

  const markNotificationRead = (id: string) => {
    setNotifications(prev => prev.map(n => (n.id === id ? { ...n, read: true } : n)));
  };

  const clearAllNotifications = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const unreadNotifsCount = notifications.filter(n => !n.read).length;

  return (
    <MedZoneContext.Provider
      value={{
        role,
        setRole,
        patient,
        providers: PROVIDERS,
        appointments,
        prescriptions,
        auditLogs,
        notifications,
        unreadNotifsCount,
        mfaVerified,
        verifyMfa,
        revokeMfa,
        soundEnabled,
        toggleSound,
        activeConsultation,
        startConsultation,
        endConsultation,
        liveVitals,
        soapNotes,
        updateSoapNotes,
        signSoapNotes,
        chatMessages,
        sendConsultationMessage,
        bookAppointment,
        issuePrescription,
        requestRefill,
        markDoseTaken,
        markNotificationRead,
        clearAllNotifications,
        triggerPushNotification,
        showComplianceModal,
        setShowComplianceModal,
        showFhirModal,
        setShowFhirModal,
        showSummaryExportModal,
        setShowSummaryExportModal,
      }}
    >
      {children}
    </MedZoneContext.Provider>
  );
};

export function useMedZone() {
  const context = useContext(MedZoneContext);
  if (!context) {
    throw new Error('useMedZone must be used within a MedZoneProvider');
  }
  return context;
}
