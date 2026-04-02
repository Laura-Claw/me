#!/usr/bin/env bun
/**
 * Memory CLI — shell-callable interface to the memory graph.
 * Used by hooks to read/write memory without going through MCP.
 *
 * Usage:
 *   bun run cli.ts <command> [args]
 *
 * Commands (args are JSON strings):
 *   create-entities    '[{"name":"...","entityType":"...","observations":[...]}]'
 *   create-relations   '[{"from":"...","to":"...","relationType":"..."}]'
 *   add-observations   '[{"entityName":"...","contents":[...]}]'
 *   delete-entities    '["name1","name2"]'
 *   delete-observations '[{"entityName":"...","observations":[...]}]'
 *   delete-relations   '[{"from":"...","to":"...","relationType":"..."}]'
 *   open-nodes         '["name1","name2"]'
 *   search-nodes       "query string"
 *   read-graph
 *   graph-health-check [stale_days]
 *   compact-graph
 *
 * Outputs JSON to stdout. Exits 1 on error.
 */

import {
  createEntities,
  createRelations,
  addObservations,
  deleteEntities,
  deleteObservations,
  deleteRelations,
  openNodes,
  searchNodes,
  loadGraph,
  graphHealthCheck,
  compactGraph,
} from "./core.ts"

const [cmd, ...rest] = process.argv.slice(2)

function arg(i = 0): any {
  if (!rest[i]) throw new Error(`Missing argument at position ${i}`)
  return JSON.parse(rest[i])
}

try {
  let result: any

  switch (cmd) {
    case "create-entities":
      result = createEntities(arg())
      break
    case "create-relations":
      result = createRelations(arg())
      break
    case "add-observations":
      result = addObservations(arg())
      break
    case "delete-entities":
      deleteEntities(arg())
      result = { ok: true }
      break
    case "delete-observations":
      deleteObservations(arg())
      result = { ok: true }
      break
    case "delete-relations":
      deleteRelations(arg())
      result = { ok: true }
      break
    case "open-nodes":
      result = openNodes(arg())
      break
    case "search-nodes":
      if (!rest[0]) throw new Error("Missing query")
      result = searchNodes(rest[0])
      break
    case "read-graph":
      result = loadGraph()
      break
    case "graph-health-check": {
      const staleDays = rest[0] ? parseInt(rest[0], 10) : 30
      const { stale, orphanRelations } = graphHealthCheck(staleDays)
      result = {
        stale_days_threshold: staleDays,
        stale_entity_count: stale.length,
        orphan_relation_count: orphanRelations.length,
        stale_entities: stale.map(e => ({ name: e.name, entityType: e.entityType, last_seen: e.last_seen })),
        orphan_relations: orphanRelations,
      }
      break
    }
    case "compact-graph":
      result = compactGraph()
      break
    default:
      throw new Error(`Unknown command: ${cmd}\nRun with no args to see usage.`)
  }

  console.log(JSON.stringify(result, null, 2))
} catch (err) {
  console.error(`Error: ${(err as Error).message}`)
  process.exit(1)
}
