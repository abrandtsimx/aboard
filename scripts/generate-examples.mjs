// Generates synthetic Aboard documents (medium + extra-large) for testing the
// explorer with many items, data types, and diverse relationships.
//
//   node scripts/generate-examples.mjs
//
// Output: public/examples/medium.json, public/examples/xlarge.json

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'examples');

const LOREM = `## Overview

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor
incididunt ut labore et dolore magna aliqua.

### Responsibilities

- Duis aute irure dolor in reprehenderit in voluptate
- Excepteur sint occaecat cupidatat non proident
- Sunt in culpa qui officia deserunt mollit anim

### Notes

Neque porro quisquam est qui dolorem ipsum quia dolor sit amet.`;

// Deterministic RNG so regenerating produces stable files.
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DOMAINS = [
  'Scenario Authoring',
  'Runtime & Sessions',
  'Content Delivery',
  'Clinical Data',
  'Analytics & Reporting',
  'Identity & Access',
  'Device Management',
  'Learning Management',
];

const APP_WORDS = [
  'Editor', 'Composer', 'Studio', 'Builder', 'Designer', 'Console', 'Portal',
  'Gateway', 'Service', 'Engine', 'Orchestrator', 'Scheduler', 'Sync', 'Hub',
  'Manager', 'Pipeline', 'Renderer', 'Validator', 'Importer', 'Exporter',
  'Dashboard', 'Inspector', 'Simulator', 'Trainer', 'Recorder', 'Streamer',
  'Catalog', 'Registry', 'Broker', 'Connector',
];

const DTYPE_WORDS = [
  'Scenario Mutation', 'Voice Clip', 'Clinical Case', 'Vitals Snapshot',
  'Patient Profile', 'Drug Order', 'Lab Result', 'Imaging Study', 'Waveform',
  'Annotation', 'Rubric', 'Assessment', 'Session Log', 'Telemetry Event',
  'Avatar Rig', 'Animation Track', 'Dialogue Tree', 'Care Plan', 'Protocol',
  'Equipment Config', 'Scoring Model', 'Transcript', 'Consent Record',
  'Checklist', 'Debrief Note', 'Haptic Profile', 'Environment Preset',
  'Localization Bundle', 'Achievement', 'Feedback Form',
];

const INFRA_WORDS = [
  'AWS S3 Bucket', 'Postgres Cluster', 'Redis Cache', 'Kafka Topic',
  'CloudFront CDN', 'ElasticSearch Index', 'Cognito Pool', 'SQS Queue',
  'Lambda Pool', 'EKS Cluster', 'DynamoDB Table', 'Vault Secrets',
];

const EXTERNAL_WORDS = [
  'Eleven Labs', 'Jira', 'Stripe', 'Twilio', 'Okta', 'Segment',
  'SendGrid', 'Datadog', 'OpenAI', 'Auth0',
];

const CREATION_VERBS = [
  ['Creates', 'creates'],
  ['Generates', 'generates'],
  ['Produces', 'produces'],
  ['Builds', 'builds'],
  ['Authors', 'authors'],
  ['Assembles', 'assembles'],
  ['Fabricates', 'fabricates'],
  ['Forges', 'forges'],
];

const APP_APP_VERBS = [
  ['Depends on', 'depends-on'],
  ['Calls', 'calls'],
  ['Authenticates via', 'authenticates-via'],
  ['Syncs with', 'syncs-with'],
  ['Publishes to', 'publishes-to'],
  ['Retrieves from', 'retrieves-from'],
  ['Streams to', 'streams-to'],
];

const DTYPE_CONSUME_VERBS = [
  ['Consumed by', 'consumed-by'],
  ['Parsed by', 'parsed-by'],
  ['Rendered by', 'rendered-by'],
  ['Validated by', 'validated-by'],
];

const DTYPE_STORE_VERBS = [
  ['Stored in', 'stored-in'],
  ['Indexed by', 'indexed-by'],
  ['Cached in', 'cached-in'],
];

const APP_INFRA_VERBS = [
  ['Deploys to', 'deploys-to'],
  ['Hosted on', 'hosted-on'],
  ['Monitored by', 'monitored-by'],
];

const EXTERNAL_VERBS = [
  ['Syncs with', 'syncs-with'],
  ['Tracks work in', 'tracks-in'],
  ['Authenticates via', 'authenticates-via'],
  ['Integrates with', 'integrates-with'],
];

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];

function name(words, i) {
  if (i < words.length) return words[i];
  return `${words[i % words.length]} ${Math.floor(i / words.length) + 1}`;
}

function buildDoc({ seed, rootId, title, domainCount, appsPerDomain, dtypesPerApp, infraCount, externalCount }) {
  const rng = mulberry32(seed);
  const nodes = [];
  const relationships = [];

  nodes.push({
    id: rootId,
    label: title,
    description: 'Synthetic environment for testing large, diverse graphs.',
    type: 'environment',
    category: 'environment',
    visibility: 'both',
    parentId: null,
  });

  const apps = [];
  const dtypes = [];
  const infra = [];
  const externals = [];

  // Content domains with apps + data types.
  let appWordIdx = 0;
  let dtypeWordIdx = 0;
  for (let d = 0; d < domainCount; d++) {
    const domainId = `dom-${d}`;
    nodes.push({
      id: domainId,
      label: name(DOMAINS, d),
      description: `${name(DOMAINS, d)} domain.`,
      type: 'environment',
      category: 'environment',
      visibility: 'both',
      parentId: rootId,
    });

    for (let a = 0; a < appsPerDomain; a++) {
      const appId = `app-${d}-${a}`;
      const visibility = rng() < 0.4 ? 'customer-facing' : 'internal';
      const app = {
        id: appId,
        label: `${name(DOMAINS, d).split(' ')[0]} ${name(APP_WORDS, appWordIdx++)}`,
        description: 'Application node with owned data types and dependencies.',
        type: 'app',
        category: 'application',
        visibility,
        parentId: domainId,
        links: {
          jira: `https://simx.atlassian.net/jira/software/projects/${appId.toUpperCase()}/boards/1`,
          confluence: `https://simx.atlassian.net/wiki/spaces/${appId.toUpperCase()}/overview`,
        },
        content: LOREM,
      };
      nodes.push(app);
      apps.push(app);

      for (let t = 0; t < dtypesPerApp; t++) {
        const dtId = `dt-${d}-${a}-${t}`;
        const dt = {
          id: dtId,
          label: name(DTYPE_WORDS, dtypeWordIdx++),
          description: 'Data type produced and consumed across the platform.',
          type: 'item-type',
          category: 'data-type',
          visibility: app.visibility,
          parentId: appId,
          content: LOREM,
        };
        nodes.push(dt);
        dtypes.push(dt);
      }
    }
  }

  // Dedicated infrastructure domain.
  const infraDomainId = 'dom-infra';
  nodes.push({
    id: infraDomainId,
    label: 'Platform Infrastructure',
    description: 'Shared infrastructure and managed services.',
    type: 'environment',
    category: 'environment',
    visibility: 'internal',
    parentId: rootId,
  });
  for (let s = 0; s < infraCount; s++) {
    const infraId = `infra-${s}`;
    const node = {
      id: infraId,
      label: name(INFRA_WORDS, s),
      description: 'Managed infrastructure service.',
      type: 'system',
      category: 'infrastructure',
      visibility: 'internal',
      parentId: infraDomainId,
      content: LOREM,
    };
    nodes.push(node);
    infra.push(node);
  }

  // External SaaS tools live at the root so they surface as diamonds.
  for (let x = 0; x < externalCount; x++) {
    const extId = `ext-${x}`;
    const node = {
      id: extId,
      label: name(EXTERNAL_WORDS, x),
      description: 'Third-party SaaS integration.',
      type: 'external',
      category: 'external-tool',
      visibility: 'internal',
      parentId: rootId,
      content: LOREM,
    };
    nodes.push(node);
    externals.push(node);
  }

  // ---- relationships ----
  let relSeq = 0;
  const rel = (sourceId, targetId, [label, type]) => {
    relationships.push({ id: `rel-${relSeq++}`, sourceId, targetId, type, label });
  };

  // Each app creates its own data types.
  for (const dt of dtypes) {
    const ownerId = dt.parentId;
    rel(ownerId, dt.id, pick(rng, CREATION_VERBS));
  }

  // Some data types have multiple factories (cross-app creation).
  for (const dt of dtypes) {
    if (rng() < 0.35) {
      const other = pick(rng, apps);
      if (other.id !== dt.parentId) {
        rel(other.id, dt.id, pick(rng, CREATION_VERBS));
      }
    }
  }

  // Data type lifecycle: stored in infra + consumed by an app.
  for (const dt of dtypes) {
    rel(dt.id, pick(rng, infra).id, pick(rng, DTYPE_STORE_VERBS));
    const consumer = pick(rng, apps);
    if (consumer.id !== dt.parentId) {
      rel(dt.id, consumer.id, pick(rng, DTYPE_CONSUME_VERBS));
    }
  }

  // App-to-app dependencies (1-2 each).
  for (const app of apps) {
    const count = 1 + Math.floor(rng() * 2);
    for (let k = 0; k < count; k++) {
      const other = pick(rng, apps);
      if (other.id !== app.id) rel(app.id, other.id, pick(rng, APP_APP_VERBS));
    }
  }

  // App-to-infra.
  for (const app of apps) {
    rel(app.id, pick(rng, infra).id, pick(rng, APP_INFRA_VERBS));
  }

  // External tools: some apps integrate with them, and some external tools act
  // as factories that generate data types (shows up as a creator/diamond).
  if (externals.length) {
    for (const app of apps) {
      if (rng() < 0.3) rel(app.id, pick(rng, externals).id, pick(rng, EXTERNAL_VERBS));
    }
    for (const dt of dtypes) {
      if (rng() < 0.12) rel(pick(rng, externals).id, dt.id, pick(rng, CREATION_VERBS));
    }
  }

  return {
    version: '1.0',
    title,
    rootId,
    nodes,
    relationships,
  };
}

const medium = buildDoc({
  seed: 1337,
  rootId: 'env-medium',
  title: 'Medium Example Platform',
  domainCount: 3,
  appsPerDomain: 3,
  dtypesPerApp: 2,
  infraCount: 4,
  externalCount: 3,
});

const xlarge = buildDoc({
  seed: 90210,
  rootId: 'env-xlarge',
  title: 'Extra-Large Example Platform',
  domainCount: 6,
  appsPerDomain: 5,
  dtypesPerApp: 3,
  infraCount: 8,
  externalCount: 6,
});

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'medium.json'), JSON.stringify(medium, null, 2));
writeFileSync(join(outDir, 'xlarge.json'), JSON.stringify(xlarge, null, 2));

const summarize = (doc) => {
  const byCat = {};
  for (const n of doc.nodes) byCat[n.category] = (byCat[n.category] ?? 0) + 1;
  return `${doc.nodes.length} nodes (${JSON.stringify(byCat)}), ${doc.relationships.length} relationships`;
};

console.log('medium.json  ->', summarize(medium));
console.log('xlarge.json  ->', summarize(xlarge));
