/**
 * Core memory graph logic — shared by MCP server (index.ts) and CLI (cli.ts)
 */

import { readFileSync, writeFileSync, existsSync } from "fs"

// ── Types ──────────────────────────────────────────────────────────────────

export interface Entity {
  name: string
  entityType: string
  observations: string[]
  last_seen: string
}

export interface Relation {
  from: string
  to: string
  relationType: string
}

export interface Graph {
  entities: Entity[]
  relations: Relation[]
}

// ── Storage ────────────────────────────────────────────────────────────────

export const MEMORY_FILE = process.env.MEMORY_FILE_PATH ?? `${process.env.HOME}/.claude/memory.json`

export function now(): string {
  return new Date().toISOString().split("T")[0] // YYYY-MM-DD
}

export function loadGraph(): Graph {
  if (!existsSync(MEMORY_FILE)) return { entities: [], relations: [] }

  const raw = readFileSync(MEMORY_FILE, "utf-8").trim()
  if (!raw) return { entities: [], relations: [] }

  // Detect standard JSON format (migration from old server format)
  if (raw.startsWith("{") && !raw.includes("\n{")) {
    const parsed = JSON.parse(raw)
    if (parsed.entities || parsed.relations) {
      const graph: Graph = {
        entities: (parsed.entities ?? []).map((e: any) => ({ ...e, last_seen: e.last_seen ?? now() })),
        relations: parsed.relations ?? [],
      }
      saveGraph(graph) // migrate to NDJSON
      return graph
    }
  }

  // NDJSON
  const items: any[] = JSON.parse("[" + raw.replace(/\r?\n/g, ",") + "]")
  const entities: Entity[] = []
  const relations: Relation[] = []
  for (const obj of items) {
    if (obj.type === "entity") {
      entities.push({
        name: obj.name,
        entityType: obj.entityType,
        observations: obj.observations ?? [],
        last_seen: obj.last_seen ?? now(),
      })
    } else if (obj.type === "relation") {
      relations.push({ from: obj.from, to: obj.to, relationType: obj.relationType })
    }
  }
  return { entities, relations }
}

export function saveGraph(graph: Graph): void {
  const lines = [
    ...graph.entities.map(e => JSON.stringify({ type: "entity", name: e.name, entityType: e.entityType, observations: e.observations, last_seen: e.last_seen })),
    ...graph.relations.map(r => JSON.stringify({ type: "relation", from: r.from, to: r.to, relationType: r.relationType })),
  ]
  writeFileSync(MEMORY_FILE, lines.join("\n") + "\n", "utf-8")
}

// ── Graph mutations ────────────────────────────────────────────────────────

export function createEntities(input: Omit<Entity, "last_seen">[]): Entity[] {
  const graph = loadGraph()
  const created: Entity[] = []
  for (const e of input) {
    const existing = graph.entities.find(x => x.name === e.name)
    if (existing) {
      for (const obs of e.observations) {
        if (!existing.observations.includes(obs)) existing.observations.push(obs)
      }
      existing.last_seen = now()
    } else {
      const entity: Entity = { ...e, last_seen: now() }
      graph.entities.push(entity)
      created.push(entity)
    }
  }
  saveGraph(graph)
  return created
}

export function createRelations(input: Relation[]): Relation[] {
  const graph = loadGraph()
  const created: Relation[] = []
  for (const r of input) {
    const exists = graph.relations.some(
      x => x.from === r.from && x.to === r.to && x.relationType === r.relationType
    )
    if (!exists) {
      graph.relations.push(r)
      created.push(r)
    }
    const entity = graph.entities.find(x => x.name === r.from)
    if (entity) entity.last_seen = now()
  }
  saveGraph(graph)
  return created
}

export function addObservations(input: { entityName: string; contents: string[] }[]): { entityName: string; addedObservations: string[] }[] {
  const graph = loadGraph()
  const results = []
  for (const { entityName, contents } of input) {
    const entity = graph.entities.find(x => x.name === entityName)
    if (!entity) throw new Error(`Entity "${entityName}" not found`)
    const added = []
    for (const obs of contents) {
      if (!entity.observations.includes(obs)) {
        entity.observations.push(obs)
        added.push(obs)
      }
    }
    entity.last_seen = now()
    results.push({ entityName, addedObservations: added })
  }
  saveGraph(graph)
  return results
}

export function deleteEntities(names: string[]): void {
  const graph = loadGraph()
  const nameSet = new Set(names)
  graph.entities = graph.entities.filter(e => !nameSet.has(e.name))
  graph.relations = graph.relations.filter(r => !nameSet.has(r.from) && !nameSet.has(r.to))
  saveGraph(graph)
}

export function deleteObservations(input: { entityName: string; observations: string[] }[]): void {
  const graph = loadGraph()
  for (const { entityName, observations } of input) {
    const entity = graph.entities.find(x => x.name === entityName)
    if (entity) {
      const toRemove = new Set(observations)
      entity.observations = entity.observations.filter(o => !toRemove.has(o))
      entity.last_seen = now()
    }
  }
  saveGraph(graph)
}

export function deleteRelations(input: Relation[]): void {
  const graph = loadGraph()
  graph.relations = graph.relations.filter(
    r => !input.some(x => x.from === r.from && x.to === r.to && x.relationType === r.relationType)
  )
  saveGraph(graph)
}

export function openNodes(names: string[]): Graph {
  const graph = loadGraph()
  const nameSet = new Set(names)
  const entities = graph.entities.filter(e => nameSet.has(e.name))
  const entityNames = new Set(entities.map(e => e.name))
  const relations = graph.relations.filter(r => entityNames.has(r.from) && entityNames.has(r.to))
  return { entities, relations }
}

export function searchNodes(query: string): Graph {
  const graph = loadGraph()
  const q = query.toLowerCase()
  const entities = graph.entities.filter(
    e =>
      e.name.toLowerCase().includes(q) ||
      e.entityType.toLowerCase().includes(q) ||
      e.observations.some(o => o.toLowerCase().includes(q))
  )
  const entityNames = new Set(entities.map(e => e.name))
  const relations = graph.relations.filter(r => entityNames.has(r.from) && entityNames.has(r.to))
  return { entities, relations }
}

export function graphHealthCheck(staleDays: number): { stale: Entity[]; orphanRelations: Relation[] } {
  const graph = loadGraph()
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - staleDays)
  const stale = graph.entities.filter(e => new Date(e.last_seen) < cutoff)
  const entityNames = new Set(graph.entities.map(e => e.name))
  const orphanRelations = graph.relations.filter(r => !entityNames.has(r.from) || !entityNames.has(r.to))
  return { stale, orphanRelations }
}

export function compactGraph(): { removedEntities: number; removedRelations: number } {
  const graph = loadGraph()
  const before = { e: graph.entities.length, r: graph.relations.length }

  const entityMap = new Map<string, Entity>()
  for (const e of graph.entities) entityMap.set(e.name, e)
  graph.entities = Array.from(entityMap.values())

  const relSeen = new Set<string>()
  graph.relations = graph.relations.filter(r => {
    const key = `${r.from}|${r.to}|${r.relationType}`
    if (relSeen.has(key)) return false
    relSeen.add(key)
    return true
  })

  const entityNames = new Set(graph.entities.map(e => e.name))
  graph.relations = graph.relations.filter(r => entityNames.has(r.from) && entityNames.has(r.to))

  saveGraph(graph)
  return {
    removedEntities: before.e - graph.entities.length,
    removedRelations: before.r - graph.relations.length,
  }
}
