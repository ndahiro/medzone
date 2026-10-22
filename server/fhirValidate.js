/**
 * Server-side FHIR R4 bundle validation.
 *
 * Structural, dependency-free validation of the generated interoperability
 * document (US Core Document Bundle). This is deliberately not a full FHIR
 * validator: it checks the invariants the client claims when it labels the
 * bundle "validated" — bundle shape, entry integrity, document ordering and
 * the required US Core fields the generator is expected to populate. Every
 * finding is surfaced to the caller instead of a fabricated success.
 */

const BUNDLE_TYPES = new Set(['document', 'collection', 'message', 'transaction', 'batch']);

const SUPPORTED_RESOURCE_TYPES = new Set([
  'AllergyIntolerance',
  'Composition',
  'Condition',
  'Encounter',
  'MedicationRequest',
  'Observation',
  'Patient',
  'Practitioner',
  'Organization',
  'Provenance',
]);

const MAX_ENTRIES = 1000;

/** Minimal required-member checks per supported resource type (US Core). */
const RESOURCE_RULES = {
  Patient: [['name', 'array']],
  Condition: [['code', 'object'], ['subject', 'object']],
  AllergyIntolerance: [['patient', 'object']],
  MedicationRequest: [['medicationCodeableConcept', 'object'], ['subject', 'object']],
  Observation: [['code', 'object'], ['status', 'string']],
  Encounter: [['status', 'string'], ['subject', 'object']],
  Practitioner: [['name', 'array']],
};

const issue = (severity, path, message, resourceType) => ({
  severity,
  path,
  message,
  ...(resourceType ? { resourceType } : {}),
});

const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validates a FHIR R4 bundle.
 *
 * @returns {{ valid: boolean, resourceCount: number, issues: Array }}
 *   `valid` is true only when no `error`-severity issues were found; `warning`
 *   issues describe lower-severity conformance gaps.
 */
export function validateFhirBundle(bundle) {
  const issues = [];
  const error = (path, message, resourceType) => issues.push(issue('error', path, message, resourceType));
  const warning = (path, message, resourceType) => issues.push(issue('warning', path, message, resourceType));

  if (!isObject(bundle) || bundle.resourceType !== 'Bundle') {
    error('Bundle.resourceType', 'Expected a FHIR R4 Bundle resource (resourceType: "Bundle").');
    return { valid: false, resourceCount: 0, issues };
  }

  if (!BUNDLE_TYPES.has(bundle.type)) {
    error('Bundle.type', `Bundle.type must be one of: ${[...BUNDLE_TYPES].join(', ')}.`);
  }

  if (!Array.isArray(bundle.entry)) {
    error('Bundle.entry', 'Bundle.entry must be an array.');
    return { valid: false, resourceCount: 0, issues };
  }

  if (bundle.entry.length > MAX_ENTRIES) {
    error('Bundle.entry', `Bundle exceeds the ${MAX_ENTRIES}-entry validation cap.`);
  }

  const entries = bundle.entry.slice(0, MAX_ENTRIES);
  entries.forEach((entry, index) => {
    const path = `Bundle.entry[${index}]`;
    if (!isObject(entry)) {
      error(path, 'Entry must be an object.');
      return;
    }
    if (typeof entry.fullUrl !== 'string' || !entry.fullUrl.trim()) {
      error(`${path}.fullUrl`, 'Entry is missing its fullUrl.');
    }
    if (!isObject(entry.resource)) {
      error(`${path}.resource`, 'Entry is missing its resource object.');
      return;
    }

    const resourceType = entry.resource.resourceType;
    if (typeof resourceType !== 'string' || !resourceType) {
      error(`${path}.resource.resourceType`, 'Resource is missing resourceType.');
      return;
    }
    if (!SUPPORTED_RESOURCE_TYPES.has(resourceType)) {
      warning(`${path}.resource.resourceType`, `Unrecognized resource type "${resourceType}".`, resourceType);
      return;
    }

    for (const [member, kind] of RESOURCE_RULES[resourceType] ?? []) {
      const value = entry.resource[member];
      const ok = kind === 'array' ? Array.isArray(value) && value.length > 0 : isObject(value);
      if (!ok) {
        error(
          `${path}.resource.${member}`,
          `${resourceType} is missing required member "${member}" (US Core minimum).`,
          resourceType,
        );
      }
    }
  });

  // A US Core Document Bundle must lead with its Composition.
  const first = entries[0]?.resource;
  if (bundle.type === 'document') {
    if (!isObject(first) || first.resourceType !== 'Composition') {
      error('Bundle.entry[0].resource', 'A document Bundle must start with a Composition resource.', 'Composition');
    } else {
      if (!Array.isArray(first.section) || first.section.length === 0) {
        error('Bundle.entry[0].resource.section', 'Composition must carry at least one section.', 'Composition');
      }
      if (!isObject(first.subject) || typeof first.subject.reference !== 'string') {
        error('Bundle.entry[0].resource.subject', 'Composition must reference its patient subject.', 'Composition');
      }
    }
  }

  const resourceCount = entries.filter((entry) => isObject(entry?.resource)).length;
  const valid = !issues.some((finding) => finding.severity === 'error');
  return { valid, resourceCount, issues };
}
