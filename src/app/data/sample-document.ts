import { AboardDocument, ABOARD_DOCUMENT_VERSION } from '../models/aboard.models';

const SAMPLE_MD = `## Overview

This sample node is part of the SimX training platform map. It demonstrates how
the board format combines hierarchy, relationships, and a markdown detail panel.

### Responsibilities

- Shows how the item fits into the surrounding workflow
- Provides a focused page for related systems, tools, and data types
- Keeps relationship context visible without requiring a separate document

### Notes

Use the arrows to inspect upstream producers, downstream consumers, and external
integrations.`;

export const SAMPLE_DOCUMENT: AboardDocument = {
  version: ABOARD_DOCUMENT_VERSION,
  title: 'SimX Platform Overview',
  rootId: 'env-simx',
  // Custom schema: each node `type` maps to a shape + color. `app` is omitted on
  // purpose so applications fall back to the built-in visibility-based coloring,
  // demonstrating that schema and default styling can coexist per node.
  schema: {
    types: [
      { id: 'environment', label: 'Environment', shape: 'rounded-square', color: '#091d3c' },
      { id: 'item-type', label: 'Data type', shape: 'circle', color: '#e31f2f' },
      { id: 'system', label: 'Infrastructure', shape: 'square', color: '#1d4e8a' },
      { id: 'aspect', label: 'Process', shape: 'hexagon', color: '#0f2d5b' },
      { id: 'external', label: 'External tool', shape: 'diamond', color: '#18171d' },
    ],
  },
  nodes: [
    {
      id: 'env-simx',
      label: 'SimX Ecosystem',
      description: 'The complete SimX medical simulation VR training platform.',
      type: 'environment',
      category: 'environment',
      visibility: 'both',
      parentId: null,
    },
    {
      id: 'app-simx-client',
      label: 'SimX Client',
      description:
        'Customer-facing VR application; retrieves mutations and cases from the Admin Portal for sessions.',
      type: 'app',
      category: 'application',
      visibility: 'customer-facing',
      parentId: 'env-simx',
      position: { x: 16, y: 24 },
      links: {
        jira: 'https://simx.atlassian.net/jira/software/projects/CLIENT/boards/1',
        confluence: 'https://simx.atlassian.net/wiki/spaces/CLIENT/overview',
      },
      content: SAMPLE_MD,
    },
    {
      id: 'app-session-server',
      label: 'Session Server',
      description: 'Coordinates multiplayer sessions and parses scenario mutations at runtime.',
      type: 'app',
      category: 'application',
      visibility: 'internal',
      parentId: 'env-simx',
      position: { x: 20, y: 72 },
      links: {
        jira: 'https://simx.atlassian.net/jira/software/projects/SESSION/boards/2',
        confluence: 'https://simx.atlassian.net/wiki/spaces/SESSION/overview',
      },
      content: SAMPLE_MD,
    },
    {
      id: 'app-scenario-creator',
      label: 'Scenario Creator',
      description: 'High-level tool for assembling new simulation scenarios from templates.',
      type: 'app',
      category: 'application',
      visibility: 'internal',
      parentId: 'env-simx',
      position: { x: 50, y: 46 },
      links: {
        jira: 'https://simx.atlassian.net/jira/software/projects/CREATOR/boards/3',
        confluence: 'https://simx.atlassian.net/wiki/spaces/CREATOR/overview',
      },
      content: SAMPLE_MD,
    },
    {
      id: 'app-admin-portal',
      label: 'Admin Portal',
      description:
        'Customer-facing portal for institution admins; hosts published mutations and clinical cases.',
      type: 'app',
      category: 'application',
      visibility: 'customer-facing',
      parentId: 'env-simx',
      position: { x: 64, y: 76 },
      links: {
        jira: 'https://simx.atlassian.net/jira/software/projects/ADMIN/boards/4',
        confluence: 'https://simx.atlassian.net/wiki/spaces/ADMIN/overview',
      },
      content: SAMPLE_MD,
    },
    {
      id: 'app-scenario-editor',
      label: 'Scenario Editor',
      description: 'Allows customization of scenarios, mutations, and voice content.',
      type: 'app',
      category: 'application',
      visibility: 'internal',
      parentId: 'env-simx',
      position: { x: 82, y: 26 },
      links: {
        jira: 'https://simx.atlassian.net/jira/software/projects/EDITOR/boards/5',
        confluence: 'https://simx.atlassian.net/wiki/spaces/EDITOR/overview',
      },
      content: SAMPLE_MD,
    },
    {
      id: 'dtype-scenario-mutation',
      label: 'Scenario Mutation',
      description: 'Runtime mutation payload produced by the Scenario Editor.',
      type: 'item-type',
      category: 'data-type',
      visibility: 'internal',
      parentId: 'app-scenario-editor',
      links: {
        jira: 'https://simx.atlassian.net/jira/software/projects/EDITOR/issues?jql=labels%3Dmutation',
        confluence: 'https://simx.atlassian.net/wiki/spaces/EDITOR/pages/scenario-mutation',
      },
      content: SAMPLE_MD,
    },
    {
      id: 'dtype-voice-clip',
      label: 'Voice Clip',
      description: 'UGC voice line generated via Eleven Labs integration.',
      type: 'item-type',
      category: 'data-type',
      visibility: 'internal',
      parentId: 'app-scenario-editor',
      links: {
        jira: 'https://simx.atlassian.net/jira/software/projects/EDITOR/issues?jql=labels%3Dvoice',
        confluence: 'https://simx.atlassian.net/wiki/spaces/EDITOR/pages/voice-clip',
      },
      content: SAMPLE_MD,
    },
    {
      id: 'svc-aws-s3',
      label: 'AWS S3 Bucket',
      description: 'Parses and sorts UGC voice clips for delivery to the client.',
      type: 'system',
      category: 'infrastructure',
      visibility: 'internal',
      parentId: 'env-simx',
      position: { x: 88, y: 68 },
      links: {
        jira: 'https://simx.atlassian.net/jira/software/projects/INFRA/boards/6',
        confluence: 'https://simx.atlassian.net/wiki/spaces/INFRA/pages/aws-s3',
      },
      content: SAMPLE_MD,
    },
    {
      id: 'aspect-session-parse',
      label: 'Parses Mutations',
      description: 'Session Server ingests and applies scenario mutations during live sessions.',
      type: 'aspect',
      category: 'process',
      visibility: 'internal',
      parentId: 'app-session-server',
    },
    {
      id: 'aspect-admin-content',
      label: 'Hosts Mutations and Cases',
      description: 'Central store for published scenario mutations and clinical cases.',
      type: 'aspect',
      category: 'process',
      visibility: 'customer-facing',
      parentId: 'app-admin-portal',
    },
    {
      id: 'aspect-s3-sort',
      label: 'Parses and Sorts UGC Voice Clips',
      description: 'Bucket ingestion pipeline for authored voice assets.',
      type: 'aspect',
      category: 'process',
      visibility: 'internal',
      parentId: 'svc-aws-s3',
    },
    {
      id: 'ext-eleven-labs',
      label: 'Eleven Labs',
      description: 'Third-party text-to-speech API used to synthesize voice clips.',
      type: 'external',
      category: 'external-tool',
      visibility: 'internal',
      parentId: 'env-simx',
      links: {
        confluence: 'https://simx.atlassian.net/wiki/spaces/EDITOR/pages/eleven-labs',
      },
      content: SAMPLE_MD,
    },
    {
      id: 'ext-jira',
      label: 'Jira',
      description: 'Atlassian issue tracker used by authoring tools for work items.',
      type: 'external',
      category: 'external-tool',
      visibility: 'internal',
      parentId: 'env-simx',
      links: {
        jira: 'https://simx.atlassian.net/jira',
      },
      content: SAMPLE_MD,
    },
  ],
  relationships: [
    {
      id: 'rel-editor-creates-mutation',
      sourceId: 'app-scenario-editor',
      targetId: 'dtype-scenario-mutation',
      type: 'creates',
      label: 'Creates',
    },
    {
      id: 'rel-mutation-admin',
      sourceId: 'dtype-scenario-mutation',
      targetId: 'app-admin-portal',
      type: 'publishes-to',
      label: 'Publishes mutations to',
    },
    {
      id: 'rel-mutation-session',
      sourceId: 'dtype-scenario-mutation',
      targetId: 'app-session-server',
      type: 'feeds',
      label: 'Parsed by Session Server',
    },
    {
      id: 'rel-editor-creates-voice',
      sourceId: 'app-scenario-editor',
      targetId: 'dtype-voice-clip',
      type: 'creates',
      label: 'Creates',
    },
    {
      id: 'rel-voice-s3',
      sourceId: 'dtype-voice-clip',
      targetId: 'svc-aws-s3',
      type: 'stores-in',
      label: 'Stored in AWS S3',
    },
    {
      id: 'rel-client-admin',
      sourceId: 'app-simx-client',
      targetId: 'app-admin-portal',
      type: 'retrieves-from',
      label: 'Retrieves mutations and cases from',
    },
    {
      id: 'rel-creator-editor',
      sourceId: 'app-scenario-creator',
      targetId: 'app-scenario-editor',
      type: 'opens',
      label: 'Opens for detailed editing',
    },
    {
      id: 'rel-client-session',
      sourceId: 'app-simx-client',
      targetId: 'app-session-server',
      type: 'connects-to',
      label: 'Connects to during sessions',
    },
    {
      id: 'rel-eleven-voice',
      sourceId: 'ext-eleven-labs',
      targetId: 'dtype-voice-clip',
      type: 'generates',
      label: 'Generates',
    },
    {
      id: 'rel-creator-jira',
      sourceId: 'app-scenario-creator',
      targetId: 'ext-jira',
      type: 'tracks-in',
      label: 'Tracks work in',
    },
    {
      id: 'rel-editor-jira',
      sourceId: 'app-scenario-editor',
      targetId: 'ext-jira',
      type: 'syncs-with',
      label: 'Syncs issues with',
    },
  ],
};
