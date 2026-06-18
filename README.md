# Aboard

An orientation explorer for mapping relationships between apps, tools, and systems — built for SimX.

Aboard is a presentation-style tool (think PowerPoint, but interactive) for explaining how a large suite of applications fits together. Instead of static slides, you navigate a hierarchical map: start at the ecosystem level, zoom into an app, then drill into aspects and item types — without the noise of deeper layers until you need them.

## Features

- **Layered zoom navigation** — View one hierarchy level at a time; select a node and explore deeper
- **Customer vs internal** — Visual distinction for customer-facing, internal, and shared items
- **Custom relationships** — Define arbitrary relationship types between any nodes (e.g. shared deployment, creates, consumes)
- **JSON import/export** — Documents are plain JSON files you can version, share, and edit
- **SimX branding** — Lato typography and official SimX color palette

## Getting started

```bash
cd aboard
npm install
npm start
```

Open [http://localhost:4200](http://localhost:4200).

## Document format

Documents are JSON files with this structure:

```json
{
  "version": "1.0",
  "title": "My Overview",
  "rootId": "env-root",
  "nodes": [
    {
      "id": "env-root",
      "label": "Ecosystem",
      "description": "...",
      "type": "environment",
      "visibility": "both",
      "parentId": null
    }
  ],
  "relationships": [
    {
      "id": "rel-1",
      "sourceId": "app-a",
      "targetId": "tool-b",
      "type": "shared-deployment",
      "label": "Uses same deployment tool"
    }
  ]
}
```

A sample document is included at `public/sample-document.json`.

### Node types

`environment`, `app`, `tool`, `aspect`, `item-type`, `system`, `custom`

### Visibility

`customer-facing`, `internal`, `both`

## Usage

1. **Click a circle** to peek — it enlarges with description, relationship hints, and child count; other circles dim
2. **Click again** (or **Enter →**) to immerse — full-screen view with relationship flows as connected circles and arrows
3. **Click a flow endpoint** (e.g. Session Server) to cross-navigate with a zoom-out/zoom-in transition
4. **Back to overview** or breadcrumbs to navigate up the hierarchy
5. **Import / Export JSON** to load or save orientation documents

## Build

```bash
npm run build
```

## Deploy

GitHub Pages deploys automatically when changes are pushed to `main`.

```bash
npm run build:pages
```

Use `build:pages` to verify the production build locally with the `/aboard/` base path used by GitHub Pages. The deployment workflow can also be run manually from the Actions tab.
