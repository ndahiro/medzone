/** Purge + reseed with Ugandan data. Run: node scripts/purge-seed-uganda.mjs */
import 'dotenv/config';
import { closePool, query } from '../server/db.js';
import { insertRow } from '../server/repository.js';
import * as m from '../server/mappers.js';
import { hashPassword } from '../server/auth.js';
const TABLES = ['visit_attachments','visit_invites','visit_guests','room_signals','chat_messages','soap_notes','consultation_requests','referrals','consultant_notes','follow_ups','notifications','audit_logs','appointments','prescriptions','provider_availability','allergies','conditions','lab_results','vitals_readings','users','patients','providers'];
const T = { SNOMED_CT: 'http://snomed.info/sct', LOINC: 'http://loinc.org', RXNORM: 'http://www.nlm.nih.gov/research/umls/rxnorm' };
const DAY = new Date(); const p2 = (n) => String(n).padStart(2, '0');
const dISO = (off = 0) => { const d = new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate() + off, 12); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
const iISO = (off = 0, h = 10, mi = 0) => { const d = new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate() + off, h, mi, 0, 0); const tz = -d.getTimezoneOffset(); const s = tz >= 0 ? '+' : '-'; return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:00${s}${p2(Math.floor(Math.abs(tz) / 60))}:${p2(Math.abs(tz) % 60)}`; };
const dsp = (h, mi = 0) => `${h % 12 || 12}:${p2(mi)} ${h >= 12 ? 'PM' : 'AM'}`;
const at = (off, h, mi = 0) => ({ date: dISO(off), time: dsp(h, mi), scheduledStart: iISO(off, h, mi) });
const friendly = (off = 0) => new Date(DAY.getFullYear(), DAY.getMonth(), DAY.getDate() + off, 12).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const PROV = [
  { id: 'prov-ug-001', npi: 'UG1000001', name: 'Dr. Sarah Nakimuli', title: 'General Practitioner', specialty: 'General Medicine', hospital: 'Mulago National Referral Hospital, Kampala', rating: 4.9, reviewsCount: 412, avatarUrl: '', bio: 'GP focused on hypertension, diabetes and family medicine.', consultationFee: 0, availableTimes: ['09:00','09:30','10:00','10:30','11:00'] },
  { id: 'prov-ug-002', npi: 'UG1000002', name: 'Dr. Brian Ssemwanga', title: 'Consulting Physician', specialty: 'Cardiovascular & Internal Medicine', hospital: 'Nsambya Hospital, Kampala', rating: 4.8, reviewsCount: 298, avatarUrl: '', bio: 'Internist focused on heart failure and hypertension.', consultationFee: 0, availableTimes: ['09:15','11:00','13:30','15:45'] },
  { id: 'prov-ug-003', npi: 'UG1000003', name: 'Dr. Grace Atim', title: 'Consulting Physician', specialty: 'Internal Medicine & Diabetes Care', hospital: 'Mbarara Regional Referral Hospital', rating: 4.9, reviewsCount: 356, avatarUrl: '', bio: 'Diabetes and chronic-disease specialist.', consultationFee: 0, availableTimes: ['10:00','10:30','14:00','16:00'] },
];
const PATS_RAW = [
['pat-ug-001','UG-MRN-1001','Brian Mugisha','1988-03-14',38,'Male','brian.mugisha@example.com','+256 772 410 201','Plot 12 Lumumba Ave, Kampala','Sarah Mugisha','Spouse','+256 772 410 202'],
['pat-ug-002','UG-MRN-1002','Sarah Namono','1994-07-22',32,'Female','sarah.namono@example.com','+256 753 220 114','Kireka, Wakiso','Peter Ssentongo','Brother','+256 753 220 115'],
['pat-ug-003','UG-MRN-1003','David Okello','1979-11-05',46,'Male','david.okello@example.com','+256 771 903 441','Gulu Town, Laroo','Rebecca Amongi','Spouse','+256 771 903 442'],
['pat-ug-004','UG-MRN-1004','Grace Achieng','1991-02-17',35,'Female','grace.achieng@example.com','+256 702 551 780','Tororo Road, Mbale','David Okello','Brother','+256 702 551 781'],
['pat-ug-005','UG-MRN-1005','Moses Kiggundu','2001-09-30',25,'Male','moses.kiggundu@example.com','+256 758 114 309','Makerere, Kampala','Faith Nabirye','Sister','+256 758 114 310'],
['pat-ug-006','UG-MRN-1006','Faith Nabirye','1976-05-11',50,'Female','faith.nabirye@example.com','+256 774 662 901','Jinja Road, Jinja','Moses Kiggundu','Son','+256 774 662 902'],
['pat-ug-007','UG-MRN-1007','Peter Ssentongo','1973-12-02',52,'Male','peter.ssentongo@example.com','+256 752 881 220','Entebbe Road, Kajjansi','Sarah Namono','Sister','+256 752 881 221'],
['pat-ug-008','UG-MRN-1008','Rebecca Amongi','1985-06-25',41,'Female','rebecca.amongi@example.com','+256 779 304 556','Lira Town, Lira','David Okello','Brother','+256 779 304 557'],
];
const BT = ['O-Positive','A-Positive','B-Positive','O-Negative','AB-Positive','A-Negative','O-Positive','B-Negative'];
const INS = ['UAP Old Mutual Medical','Sanlam Medical','Jubilee Medical','UAP Old Mutual Medical','Case Medical Plan','Sanlam Medical','Jubilee Medical','UAP Old Mutual Medical'];
const PATIENTS = PATS_RAW.map((r, i) => ({ id: r[0], mrn: r[1].replace('UG-MRN','UG-MRN'), name: r[2], dob: r[3], age: r[4], gender: r[5], bloodType: BT[i], email: r[6], phone: r[7], avatarUrl: '', address: r[8], emergencyContact: { name: r[9], relationship: r[10], phone: r[11] }, insurance: { provider: INS[i], policyNumber: `${r[1]}-P`, groupNumber: 'GRP-UG' }, allergies: [], conditions: [], recentLabs: [], vitalsHistory: [] }));
PATIENTS[0].mrn = 'UG-MRN-1001';
const C = (i, o) => PATIENTS[i].conditions.push(o);
const L = (i, o) => PATIENTS[i].recentLabs.push(o);
const V = (i, o) => PATIENTS[i].vitalsHistory.push(o);
const A = (i, o) => PATIENTS[i].allergies.push(o);

A(0, { id: 'alg-ug-11', substance: 'Penicillin', reaction: 'Rash', severity: 'moderate', substanceCode: { system: T.SNOMED_CT, code: '764676009', display: 'Penicillin' } });
A(2, { id: 'alg-ug-31', substance: 'Sulfonamides', reaction: 'Hives', severity: 'moderate', substanceCode: { system: T.SNOMED_CT, code: '293586004', display: 'Sulfonamide' } });
A(5, { id: 'alg-ug-61', substance: 'Aspirin', reaction: 'Bronchospasm', severity: 'severe', substanceCode: { system: T.SNOMED_CT, code: '293586005', display: 'Aspirin' } });
C(0, { id: 'con-ug-11', name: 'Essential hypertension', icd10: 'I10', snomed: { system: T.SNOMED_CT, code: '59621000', display: 'Essential hypertension' }, diagnosedDate: dISO(-400), status: 'active' });
C(0, { id: 'con-ug-12', name: 'Type 2 diabetes mellitus', icd10: 'E11.9', snomed: { system: T.SNOMED_CT, code: '44054006', display: 'Type 2 diabetes' }, diagnosedDate: dISO(-520), status: 'active' });
C(1, { id: 'con-ug-21', name: 'Migraine without aura', icd10: 'G43.009', snomed: { system: T.SNOMED_CT, code: '37796009', display: 'Migraine' }, diagnosedDate: dISO(-300), status: 'active' });
C(2, { id: 'con-ug-31', name: 'Type 2 diabetes mellitus', icd10: 'E11.9', snomed: { system: T.SNOMED_CT, code: '44054006', display: 'Type 2 diabetes' }, diagnosedDate: dISO(-700), status: 'active' });
C(2, { id: 'con-ug-32', name: 'Chronic kidney disease stage 3', icd10: 'N18.3', snomed: { system: T.SNOMED_CT, code: '433144002', display: 'CKD stage 3' }, diagnosedDate: dISO(-300), status: 'active' });
C(3, { id: 'con-ug-41', name: 'Essential hypertension', icd10: 'I10', snomed: { system: T.SNOMED_CT, code: '59621000', display: 'Essential hypertension' }, diagnosedDate: dISO(-250), status: 'active' });
C(3, { id: 'con-ug-42', name: 'Generalized anxiety disorder', icd10: 'F41.1', snomed: { system: T.SNOMED_CT, code: '48694002', display: 'GAD' }, diagnosedDate: dISO(-200), status: 'active' });
C(4, { id: 'con-ug-51', name: 'Asthma', icd10: 'J45.909', snomed: { system: T.SNOMED_CT, code: '195967001', display: 'Asthma' }, diagnosedDate: dISO(-900), status: 'active' });
C(5, { id: 'con-ug-61', name: 'Chronic heart failure', icd10: 'I50.9', snomed: { system: T.SNOMED_CT, code: '84114007', display: 'Heart failure' }, diagnosedDate: dISO(-600), status: 'active' });
C(5, { id: 'con-ug-62', name: 'Atrial fibrillation', icd10: 'I48.91', snomed: { system: T.SNOMED_CT, code: '49436004', display: 'Atrial fibrillation' }, diagnosedDate: dISO(-500), status: 'active' });
C(6, { id: 'con-ug-71', name: 'Prediabetes', icd10: 'R73.09', snomed: { system: T.SNOMED_CT, code: '714628002', display: 'Prediabetes' }, diagnosedDate: dISO(-180), status: 'active' });
C(7, { id: 'con-ug-81', name: 'Hypothyroidism', icd10: 'E03.9', snomed: { system: T.SNOMED_CT, code: '40930008', display: 'Hypothyroidism' }, diagnosedDate: dISO(-400), status: 'active' });
L(0, { id: 'lab-ug-11', testName: 'HbA1c', category: 'Endocrine', loinc: { system: T.LOINC, code: '4548-4', display: 'HbA1c' }, value: 6.6, unit: '%', referenceRange: '4.0 - 5.6', date: dISO(-14), status: 'abnormal' });
L(2, { id: 'lab-ug-31', testName: 'eGFR', category: 'Metabolic', loinc: { system: T.LOINC, code: '33914-3', display: 'GFR' }, value: 52, unit: 'mL/min', referenceRange: '>= 60', date: dISO(-10), status: 'abnormal' });
L(5, { id: 'lab-ug-61', testName: 'Potassium', category: 'Metabolic', loinc: { system: T.LOINC, code: '2823-3', display: 'Potassium' }, value: 4.2, unit: 'mmol/L', referenceRange: '3.5 - 5.1', date: dISO(-7), status: 'normal' });
L(7, { id: 'lab-ug-81', testName: 'TSH', category: 'Endocrine', loinc: { system: T.LOINC, code: '3016-3', display: 'TSH' }, value: 6.8, unit: 'mIU/L', referenceRange: '0.4 - 4.0', date: dISO(-15), status: 'abnormal' });
V(0, { heartRate: 76, systolic: 132, diastolic: 84, spo2: 98, respiratoryRate: 16, temperature: 36.7, timestamp: iISO(-1, 9, 0) });
V(1, { heartRate: 72, systolic: 118, diastolic: 76, spo2: 99, respiratoryRate: 14, temperature: 36.5, timestamp: iISO(-2, 11, 0) });
V(2, { heartRate: 78, systolic: 136, diastolic: 86, spo2: 98, respiratoryRate: 16, temperature: 36.8, timestamp: iISO(-3, 10, 0) });
V(3, { heartRate: 76, systolic: 134, diastolic: 84, spo2: 99, respiratoryRate: 15, temperature: 36.6, timestamp: iISO(0, 8, 30) });
V(4, { heartRate: 82, systolic: 122, diastolic: 78, spo2: 97, respiratoryRate: 18, temperature: 36.9, timestamp: iISO(-5, 14, 0) });
V(5, { heartRate: 88, systolic: 118, diastolic: 72, spo2: 96, respiratoryRate: 18, temperature: 36.7, timestamp: iISO(0, 9, 0) });
V(6, { heartRate: 75, systolic: 130, diastolic: 82, spo2: 98, respiratoryRate: 15, temperature: 36.6, timestamp: iISO(-4, 9, 30) });
const PV = [['prov-ug-001','Dr. Sarah Nakimuli','General Practitioner','General Medicine'],['prov-ug-002','Dr. Brian Ssemwanga','Consulting Physician','Cardiovascular & Internal Medicine'],['prov-ug-003','Dr. Grace Atim','Consulting Physician','Internal Medicine & Diabetes Care']];
const mkA = (id, pi, vi, off, h, mi, type, status, reason, pri) => { const p = PATIENTS[pi]; const v = PV[vi]; return { id, patientId: p.id, providerId: v[0], patientName: p.name, patientMrn: `UG-MRN-100${pi + 1}`, patientAge: p.age, patientGender: p.gender, providerName: v[1], providerTitle: v[2], providerSpecialty: v[3], providerAvatar: '', ...at(off, h, mi), type, status, reasonForVisit: reason, triagePriority: pri, roomCode: `MED-${id.toUpperCase()}`, encryptedSessionKey: `ENC-${id.toUpperCase()}` }; };
const APPTS = [
mkA('apt-ug-101',0,0,1,10,30,'Virtual Consultation','scheduled','Quarterly hypertension and diabetes review.','priority'),
mkA('apt-ug-102',0,0,-14,14,30,'Follow-Up','completed','Glycemic checkup and metabolic panel review.','routine'),
mkA('apt-ug-201',1,0,2,11,0,'Follow-Up','scheduled','Migraine review and preventive therapy check-in.','routine'),
mkA('apt-ug-301',2,2,1,14,0,'Virtual Consultation','scheduled','Diabetes + CKD quarterly review (Gulu).','priority'),
mkA('apt-ug-302',2,2,-21,11,0,'Follow-Up','completed','Renal function and A1c review.','routine'),
mkA('apt-ug-401',3,1,0,13,30,'Virtual Consultation','in-progress','BP and anxiety medication check-in.','priority'),
mkA('apt-ug-501',4,2,3,10,0,'Virtual Consultation','scheduled','Asthma control review and inhaler technique.','routine'),
mkA('apt-ug-601',5,1,0,9,15,'Follow-Up','in-progress','Heart-failure titration and rhythm check.','urgent'),
mkA('apt-ug-602',5,1,3,15,45,'Virtual Consultation','scheduled','Diuretic response and potassium recheck.','priority'),
mkA('apt-ug-701',6,0,4,9,0,'Virtual Consultation','scheduled','Prediabetes and lipid review after labs.','routine'),
mkA('apt-ug-801',7,2,2,14,30,'Virtual Consultation','scheduled','Hypothyroidism review and dose titration.','routine'),
];
APPTS[5].notesSnippet = 'Home BP 132/84; market-work stress.'; APPTS[7].notesSnippet = 'Mild exertional dyspnea; SpO2 96%.'; APPTS[0].notesSnippet = 'Home BP 132/84; review lisinopril + metformin.';
const RX = (id, pi, med, code, disp2, dosage, route, freq, qty, tr, rr, doc, off, pharm, instr, status, mins, adh) => ({ id, patientId: PATIENTS[pi].id, patientName: PATIENTS[pi].name, medicationName: med, rxnorm: { system: T.RXNORM, code, display: disp2 }, dosage, route, frequency: freq, quantity: qty, totalRefills: tr, remainingRefills: rr, prescribingDoctor: doc, prescribedDate: dISO(off), pharmacy: pharm, instructions: instr, status, nextDoseMinutes: mins, adherencePercentage: adh });
const RXS = [
RX('rx-ug-101',0,'Lisinopril','314076','lisinopril 10 MG Oral Tablet','10mg','Oral','Once daily in the morning',30,3,3,'Dr. Sarah Nakimuli',-30,'Kampala Pharmacy, City Centre','Take each morning; log home BP.','active',60,94),
RX('rx-ug-102',0,'Metformin Hydrochloride ER','860975','metformin 500 MG ER Tablet','1000mg','Oral','Twice daily with meals',60,3,2,'Dr. Sarah Nakimuli',-30,'Kampala Pharmacy, City Centre','Take with breakfast and dinner.','active',180,91),
RX('rx-ug-201',1,'Propranolol Hydrochloride','647146','propranolol 20 MG Tablet','20mg','Oral','Twice daily',60,2,2,'Dr. Sarah Nakimuli',-21,'Guardian Pharmacy, Ntinda','Keep migraine trigger diary.','active',240,88),
RX('rx-ug-301',2,'Metformin Hydrochloride ER','860975','metformin 500 MG ER Tablet','1000mg','Oral','Twice daily with meals',60,3,3,'Dr. Grace Atim',-40,'Gulu Central Pharmacy','Repeat kidney labs in 1 month.','active',180,93),
RX('rx-ug-401',3,'Amlodipine Besylate','308135','amlodipine 5 MG Tablet','5mg','Oral','Once daily',30,3,3,'Dr. Brian Ssemwanga',-21,'Mbale Community Pharmacy','Report ankle swelling.','active',90,97),
RX('rx-ug-402',3,'Sertraline Hydrochloride','312938','sertraline 50 MG Tablet','50mg','Oral','Once daily in the morning',30,2,2,'Dr. Brian Ssemwanga',-21,'Mbale Community Pharmacy','Take with food.','active',120,95),
RX('rx-ug-501',4,'Fluticasone / Salmeterol','896245','fluticasone/salmeterol inhaler','250/50 mcg','Inhalation','Two puffs twice daily',1,3,3,'Dr. Grace Atim',-35,'Case Hospital Pharmacy','Rinse mouth after use.','active',150,89),
RX('rx-ug-601',5,'Furosemide','313988','furosemide 40 MG Tablet','40mg','Oral','Once daily in the morning',30,2,2,'Dr. Brian Ssemwanga',-30,'Jinja Central Pharmacy','Track daily weight.','active',75,90),
RX('rx-ug-602',5,'Apixaban','1364430','apixaban 5 MG Tablet','5mg','Oral','Twice daily',60,1,1,'Dr. Brian Ssemwanga',-30,'Jinja Central Pharmacy','Report bleeding.','refill-requested',210,87),
RX('rx-ug-701',6,'Atorvastatin Calcium','617311','atorvastatin 20 MG Tablet','20mg','Oral','Once daily at bedtime',30,2,2,'Dr. Sarah Nakimuli',-24,'Entebbe Road Pharmacy','Repeat lipids in 3 months.','active',420,94),
RX('rx-ug-801',7,'Levothyroxine Sodium','10582','levothyroxine 50 MCG Tablet','50mcg','Oral','Once daily before breakfast',30,3,3,'Dr. Grace Atim',-28,'Lira Medical Pharmacy','30 min before food.','active',600,96),
];
const nowT = () => new Date().toLocaleTimeString();
const SOAPS = [
['apt-ug-101','Brian reports morning headaches, adherent to lisinopril. Denies chest pain.','Alert; home BP 132/84, HR 76, SpO2 98%. No edema.','Hypertension stable; diabetes well-managed.','Continue lisinopril + metformin. Metabolic panel in 4 weeks; daily BP log.',false,'Dr. Sarah Nakimuli'],
['apt-ug-102','Good adherence, no hypoglycemia. Home avg 126/80.','BP 124/80, HR 72. A1c 6.6%.','HTN + diabetes controlled.','Continue therapy. Repeat panel in 3 months.',true,'Dr. Sarah Nakimuli'],
['apt-ug-302','David reports better energy; metformin with posho and beans.','BP 136/86, A1c 7.9%, eGFR 52. No foot ulcers.','T2D above goal with CKD stage 3.','Continue metformin; renal diet; repeat A1c in 3 months.',true,'Dr. Grace Atim'],
['apt-ug-401','Grace reports market-work stress and palpitations. Adherent.','BP 134/84, HR 76, SpO2 99%. Regular rhythm.','HTN above goal; anxiety stable.','Continue meds; twice-daily BP; review in 4 weeks.',false,'Dr. Brian Ssemwanga'],
['apt-ug-601','Faith reports mild exertional dyspnea, no orthopnea. Weights stable.','BP 118/72, HR 88, SpO2 96%. Trace edema.','CHF compensated.','Continue furosemide + apixaban. K+ and renal panel in 1 week.',false,'Dr. Brian Ssemwanga'],
];


V(7, { heartRate: 70, systolic: 124, diastolic: 80, spo2: 99, respiratoryRate: 14, temperature: 36.5, timestamp: iISO(-6, 10, 30) });


const MOD_ALL = ['dashboard','followups','contacts','appointments','availability'];
const MOD_PAT = ['dashboard','appointments'];
const USERS = [
['admin','Administrator','UgandaAdmin123',MOD_ALL,1,'admin',null,null],
['clinician.demo','Dr. Sarah Nakimuli','Clinician123456',MOD_ALL,0,'clinician',null,null],
['clinician.nakimuli','Dr. Sarah Nakimuli','Clinician123456',MOD_ALL,0,'clinician',null,'prov-ug-001'],
['clinician.ssemwanga','Dr. Brian Ssemwanga','Clinician123456',MOD_ALL,0,'clinician',null,'prov-ug-002'],
['clinician.atim','Dr. Grace Atim','Clinician123456',MOD_ALL,0,'clinician',null,'prov-ug-003'],
['patient.mugisha','Brian Mugisha','Patient123456',MOD_PAT,0,'patient','pat-ug-001',null],
['patient.namono','Sarah Namono','Patient123456',MOD_PAT,0,'patient','pat-ug-002',null],
['patient.okello','David Okello','Patient123456',MOD_PAT,0,'patient','pat-ug-003',null],
['patient.achieng','Grace Achieng','Patient123456',MOD_PAT,0,'patient','pat-ug-004',null],
['patient.kiggundu','Moses Kiggundu','Patient123456',MOD_PAT,0,'patient','pat-ug-005',null],
['patient.nabirye','Faith Nabirye','Patient123456',MOD_PAT,0,'patient','pat-ug-006',null],
['patient.ssentongo','Peter Ssentongo','Patient123456',MOD_PAT,0,'patient','pat-ug-007',null],
['patient.amongi','Rebecca Amongi','Patient123456',MOD_PAT,0,'patient','pat-ug-008',null],
];
const FUS = [
['fu-ug-001','#UG2026-001','Hypertension + diabetes renewal','Active',-30,'Quarterly renewal for Brian Mugisha.','Sarah Nakimuli','dr.nakimuli@medzone.ug','SN','General Medicine','Brian Mugisha','brian.mugisha@example.com','BM'],
['fu-ug-002','#UG2026-002','Migraine follow-up','Active',-28,'Review therapy for Sarah Namono.','Sarah Nakimuli','dr.nakimuli@medzone.ug','SN','General Medicine','Sarah Namono','sarah.namono@example.com','SN'],
['fu-ug-003','#UG2026-003','Heart-failure titration','Active',-30,'Titrate diuretics for Faith Nabirye.','Brian Ssemwanga','dr.ssemwanga@medzone.ug','BS','Cardiovascular & Internal Medicine','Faith Nabirye','faith.nabirye@example.com','FN'],
['fu-ug-004','#UG2026-004','Diabetes + CKD monitoring','Active',-40,'Glycemic review for David Okello.','Grace Atim','dr.atim@medzone.ug','GA','Internal Medicine & Diabetes Care','David Okello','david.okello@example.com','DO'],
];
async function run() {
console.log('[uganda-seed] purging...');
await query('SET FOREIGN_KEY_CHECKS = 0');
try { for (const t of TABLES) await query(`TRUNCATE TABLE \`${t}\``); } finally { await query('SET FOREIGN_KEY_CHECKS = 1'); }
console.log('[uganda-seed] seeding...');
for (const p of PROV) { await insertRow('providers', m.providerColumns(p)); for (let i = 0; i < p.availableTimes.length; i += 1) await insertRow('provider_availability', { provider_id: p.id, slot: p.availableTimes[i], position: i }); }
for (const p of PATIENTS) { await insertRow('patients', m.patientColumns(p)); for (const a of p.allergies) await insertRow('allergies', m.allergyColumns(p.id, a)); for (const c of p.conditions) await insertRow('conditions', m.conditionColumns(p.id, c)); for (const l of p.recentLabs) await insertRow('lab_results', m.labColumns(p.id, l)); for (const v of p.vitalsHistory) await insertRow('vitals_readings', m.vitalsColumns(p.id, v)); }
for (const a of APPTS) await insertRow('appointments', m.appointmentColumns(a));
for (const r of RXS) await insertRow('prescriptions', m.prescriptionColumns(r));
for (const [aid, s, o, a2, pl, signed, by] of SOAPS) await insertRow('soap_notes', m.soapColumns(`soap-${aid}`, { subjective: s, objective: o, assessment: a2, plan: pl, lastUpdated: nowT(), isSigned: signed, signedBy: by }, aid));
for (const [id, code, title, status, off, desc, cn, ce, ci, grp, pn, pe, pi2] of FUS) await insertRow('follow_ups', m.followUpColumns({ id, code, title, status, createdDate: friendly(off), description: desc, createdBy: { name: cn, email: ce, initials: ci, isCurrentUser: true }, practitioner: { name: cn, email: ce, initials: ci, isCurrentUser: true, group: grp }, patient: { name: pn, email: pe, initials: pi2 } }));
await insertRow('consultant_notes', m.consultantNoteColumns({ id: 'cn-ug-01', patientId: 'pat-ug-001', patientName: 'Brian Mugisha', patientMrn: 'UG-MRN-1001', authorName: 'Dr. Sarah Nakimuli', authorRole: 'clinician', title: 'Quarterly chronic-care review', body: 'BP and glycemic trends stable. Salt reduction + daily walks. Next review with labs.', createdAt: iISO(-13, 15, 0) }));
await insertRow('consultant_notes', m.consultantNoteColumns({ id: 'cn-ug-02', patientId: 'pat-ug-006', patientName: 'Faith Nabirye', patientMrn: 'UG-MRN-1006', authorName: 'Dr. Brian Ssemwanga', authorRole: 'clinician', title: 'Heart-failure shared-care note', body: 'Compensated CHF; continue diuresis. Echo at Uganda Heart Institute. Daily weights.', createdAt: iISO(-6, 10, 0) }));
await insertRow('referrals', m.referralColumns({ id: 'ref-ug-01', patientId: 'pat-ug-001', patientName: 'Brian Mugisha', patientMrn: 'UG-MRN-1001', patientAge: 38, patientGender: 'Male', specialty: 'Endocrinology', referredToProviderId: 'prov-ug-003', referredToProviderName: 'Dr. Grace Atim', reason: 'Suboptimal glycemic control.', priority: 'routine', notes: 'A1c 6.6% on metformin ER.', status: 'pending', source: 'clinician', createdBy: 'Dr. Sarah Nakimuli', createdAt: iISO(-2, 10, 0) }));
await insertRow('referrals', m.referralColumns({ id: 'ref-ug-02', patientId: 'pat-ug-006', patientName: 'Faith Nabirye', patientMrn: 'UG-MRN-1006', patientAge: 50, patientGender: 'Female', specialty: 'Cardiology', reason: 'AFib rate control review.', priority: 'urgent', notes: 'On apixaban; needs echo.', status: 'pending', source: 'clinician', createdBy: 'Dr. Brian Ssemwanga', createdAt: iISO(-5, 9, 0) }));
await query('UPDATE referrals SET status = ? WHERE id = ?', ['accepted', 'ref-ug-02']);
await insertRow('notifications', m.notificationColumns({ id: 'notif-ug-1', title: 'Teleconsultation Starting', message: 'Renewal visit with Brian Mugisha is scheduled for tomorrow.', type: 'appointment', timestamp: 'Just now', createdAt: iISO(-1, 15, 55), read: false, actionPayload: 'apt-ug-101' }));
await insertRow('notifications', m.notificationColumns({ id: 'notif-ug-2', title: 'Patient Waiting', message: 'Grace Achieng checked in with Dr. Ssemwanga.', type: 'appointment', timestamp: '25m ago', createdAt: iISO(0, 13, 5), read: false, actionPayload: 'apt-ug-401' }));
await insertRow('audit_logs', m.auditLogColumns({ id: 'aud-ug-01', timestamp: iISO(-1, 15, 58), userRole: 'clinician', userName: 'Sarah Nakimuli', action: 'VIEW_RECORD', details: 'Opened chart for Brian Mugisha (UG-MRN-1001)', targetMrn: 'UG-MRN-1001', ipMasked: '192.168.1.***', status: 'VERIFIED_HIPAA' }));
await insertRow('audit_logs', m.auditLogColumns({ id: 'aud-ug-02', timestamp: iISO(-1, 16, 0), userRole: 'clinician', userName: 'Sarah Nakimuli', action: 'START_CONSULTATION', details: 'Initiated teleconsultation with Brian Mugisha', targetMrn: 'UG-MRN-1001', ipMasked: '192.168.1.***', status: 'VERIFIED_HIPAA' }));
console.log('[uganda-seed] users...');
for (const [u, dn, pw, mods, adm, role, pat, prv] of USERS) await insertRow('users', { username: u, display_name: dn, password_hash: await hashPassword(pw), modules: JSON.stringify(mods), is_admin: adm, role, patient_id: pat, provider_id: prv });
const counts = {}; for (const t of ['providers','patients','appointments','prescriptions','follow_ups','users']) counts[t] = Number((await query(`SELECT COUNT(*) AS c FROM \`${t}\``))[0]?.c ?? 0);
console.log('[uganda-seed] DONE', JSON.stringify(counts));
console.table(await query('SELECT username, display_name, role FROM users ORDER BY role, username'));
await closePool();
}
run().catch(async (e) => { console.error('[uganda-seed] FAILED:', e.message); try { await closePool(); } catch {} process.exitCode = 1; });
