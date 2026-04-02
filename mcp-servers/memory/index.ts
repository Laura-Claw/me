#!/usr/bin/env bun
/**
 * Laura's custom Memory MCP Server
 *
 * Drop-in replacement for @modelcontextprotocol/server-memory with:
 * - auto last_seen tracking on every entity write
 * - graph_health_check: list entities stale for N+ days
 * - compact_graph: dedup, prune orphans, rewrite file
 *
 * File format: NDJSON (compatible with @modelcontextprotocol/server-memory)
 * Core logic lives in core.ts — also callable via cli.ts from hooks.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import {
  loadGraph,
  createEntities,
  createRelations,
  addObservations,
  deleteEntities,
  deleteObservations,
  deleteRelations,
  openNodes,
  searchNodes,
  graphHealthCheck,
  compactGraph,
} from "./core.ts"

// Claude Code serializes array/object args as JSON strings — unwrap if needed
function arr(val: any): any[] {
  if (typeof val === "string") return JSON.parse(val)
  return val ?? []
}

// ── MCP Server ─────────────────────────────────────────────────────────────

const server = new Server(
  { name: "laura-memory", version: "1.0.0" },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "create_entities",
      description: "Create new entities in the knowledge graph. Existing entities get observations merged and last_seen updated.",
      inputSchema: {
        type: "object",
        properties: {
          entities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                entityType: { type: "string" },
                observations: { type: "array", items: { type: "string" } },
              },
              required: ["name", "entityType", "observations"],
            },
          },
        },
        required: ["entities"],
      },
    },
    {
      name: "create_relations",
      description: "Create relations between entities. Duplicates are ignored. Updates last_seen on the from-entity.",
      inputSchema: {
        type: "object",
        properties: {
          relations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                from: { type: "string" },
                to: { type: "string" },
                relationType: { type: "string" },
              },
              required: ["from", "to", "relationType"],
            },
          },
        },
        required: ["relations"],
      },
    },
    {
      name: "add_observations",
      description: "Add observations to existing entities. Updates last_seen.",
      inputSchema: {
        type: "object",
        properties: {
          observations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                entityName: { type: "string" },
                contents: { type: "array", items: { type: "string" } },
              },
              required: ["entityName", "contents"],
            },
          },
        },
        required: ["observations"],
      },
    },
    {
      name: "delete_entities",
      description: "Delete entities and their associated relations from the graph.",
      inputSchema: {
        type: "object",
        properties: {
          entityNames: { type: "array", items: { type: "string" } },
        },
        required: ["entityNames"],
      },
    },
    {
      name: "delete_observations",
      description: "Remove specific observations from entities.",
      inputSchema: {
        type: "object",
        properties: {
          deletions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                entityName: { type: "string" },
                observations: { type: "array", items: { type: "string" } },
              },
              required: ["entityName", "observations"],
            },
          },
        },
        required: ["deletions"],
      },
    },
    {
      name: "delete_relations",
      description: "Delete specific relations from the graph.",
      inputSchema: {
        type: "object",
        properties: {
          relations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                from: { type: "string" },
                to: { type: "string" },
                relationType: { type: "string" },
              },
              required: ["from", "to", "relationType"],
            },
          },
        },
        required: ["relations"],
      },
    },
    {
      name: "open_nodes",
      description: "Retrieve specific entities and the relations between them by name.",
      inputSchema: {
        type: "object",
        properties: {
          names: { type: "array", items: { type: "string" } },
        },
        required: ["names"],
      },
    },
    {
      name: "search_nodes",
      description: "Search entities by name, type, or observation content (case-insensitive substring match).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
    {
      name: "read_graph",
      description: "Return the entire knowledge graph. Use sparingly — prefer open_nodes or search_nodes.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "graph_health_check",
      description: "List entities not updated in N days, and orphan relations. Use before compact_graph to review what will be cleaned.",
      inputSchema: {
        type: "object",
        properties: {
          stale_days: {
            type: "number",
            description: "Entities with last_seen older than this many days are flagged as stale. Default: 30.",
          },
        },
      },
    },
    {
      name: "compact_graph",
      description: "Deduplicate entities and relations, remove orphan relations. Returns counts of removed items.",
      inputSchema: { type: "object", properties: {} },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  try {
    switch (name) {
      case "create_entities": {
        const created = createEntities(arr(args!.entities))
        return { content: [{ type: "text", text: JSON.stringify(created, null, 2) }] }
      }
      case "create_relations": {
        const created = createRelations(arr(args!.relations))
        return { content: [{ type: "text", text: JSON.stringify(created, null, 2) }] }
      }
      case "add_observations": {
        const results = addObservations(arr(args!.observations))
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] }
      }
      case "delete_entities": {
        deleteEntities(arr(args!.entityNames))
        return { content: [{ type: "text", text: "Entities deleted." }] }
      }
      case "delete_observations": {
        deleteObservations(arr(args!.deletions))
        return { content: [{ type: "text", text: "Observations deleted." }] }
      }
      case "delete_relations": {
        deleteRelations(arr(args!.relations))
        return { content: [{ type: "text", text: "Relations deleted." }] }
      }
      case "open_nodes": {
        const result = openNodes(arr(args!.names))
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
      }
      case "search_nodes": {
        const result = searchNodes(args!.query as string)
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
      }
      case "read_graph": {
        const graph = loadGraph()
        return { content: [{ type: "text", text: JSON.stringify(graph, null, 2) }] }
      }
      case "graph_health_check": {
        const staleDays = (args?.stale_days as number) ?? 30
        const result = graphHealthCheck(staleDays)
        const summary = {
          stale_days_threshold: staleDays,
          stale_entity_count: result.stale.length,
          orphan_relation_count: result.orphanRelations.length,
          stale_entities: result.stale.map(e => ({ name: e.name, entityType: e.entityType, last_seen: e.last_seen })),
          orphan_relations: result.orphanRelations,
        }
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] }
      }
      case "compact_graph": {
        const result = compactGraph()
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] }
      }
      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${(err as Error).message}` }],
      isError: true,
    }
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
