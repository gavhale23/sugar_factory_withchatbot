import process from "node:process";
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Pool } from "pg";
import { z } from "zod";

// Verify database connection string
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[MCP Server Error] Missing DATABASE_URL environment variable.");
  process.exit(1);
}

// Initialize PostgreSQL connection pool
const pool = new Pool({
  connectionString: databaseUrl,
});

// Create the MCP server instance
const server = new McpServer({
  name: "sanjivani-farmer-mcp-server",
  version: "1.0.0",
});

// Register exactly one tool: get_farmer_records
server.registerTool(
  "get_farmer_records",
  {
    description:
      "Retrieves all sugarcane farmer records from the Sanjivani Sugar Factory database, including farmer names, villages, supply tonnage, and payment status.",
    inputSchema: z.object({}),
  },
  async () => {
    try {
      console.error("[MCP Server] Fetching farmer records from PostgreSQL...");
      
      // Execute read-only SQL query to retrieve farmer records
      const result = await pool.query(
        "SELECT farmer_id, farmer_name, village, supply_tonnes, payment_status FROM farmers ORDER BY farmer_id ASC;"
      );

      console.error(
        `[MCP Server] Successfully retrieved ${result.rowCount} farmer record(s).`
      );

      // Return the rows formatted as JSON inside MCP text content
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result.rows, null, 2),
          },
        ],
      };
    } catch (error: any) {
      console.error(
        "[MCP Server Error] Failed to query PostgreSQL database:",
        error?.message || error
      );

      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Database query failed: ${error?.message || "Unknown error"}`,
          },
        ],
      };
    }
  }
);

// Graceful cleanup logic for PostgreSQL connection pool and MCP server
const cleanup = async () => {
  console.error("[MCP Server] Shutting down. Closing database connection pool...");
  try {
    await pool.end();
    await server.close();
  } catch (err: any) {
    console.error("[MCP Server] Error during shutdown:", err?.message || err);
  }
  process.exit(0);
};

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Start the server using StdioServerTransport
async function runServer() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP Server] Sanjivani Farmer MCP Server is running on stdio transport.");
}

runServer().catch((error) => {
  console.error("[MCP Server Fatal Error]", error);
  process.exit(1);
});
