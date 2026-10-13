import process from "node:process";
import path from "node:path";
import "dotenv/config";
import express from "express";
import cors from "cors";
import OpenAI from "openai";
import { Pool } from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[Web Server Error] DATABASE_URL is missing in .env");
  process.exit(1);
}

// PostgreSQL pool for direct table view queries
const pool = new Pool({
  connectionString: databaseUrl,
});

// Endpoint: Fetch farmer records directly for the UI table
app.get("/api/farmers", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT farmer_id, farmer_name, village, supply_tonnes, payment_status FROM farmers ORDER BY farmer_id ASC;"
    );
    res.json({ farmers: result.rows });
  } catch (error: any) {
    console.error("[API Error] Failed to fetch farmers:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Create a new farmer record in PostgreSQL
app.post("/api/farmers", async (req, res) => {
  try {
    const {
      farmer_name,
      village,
      supply_tonnes,
      payment_status,
      mobile_number,
      sugarcane_variety,
      rate_per_tonne,
    } = req.body;

    if (!farmer_name || !village || supply_tonnes === undefined || !payment_status) {
      return res.status(400).json({
        error: "Missing required fields: farmer_name, village, supply_tonnes, and payment_status are required.",
      });
    }

    const tonnes = parseFloat(supply_tonnes);
    if (isNaN(tonnes) || tonnes <= 0) {
      return res.status(400).json({ error: "supply_tonnes must be a positive number." });
    }

    const rate = parseFloat(rate_per_tonne) || 3200.0;
    const status = payment_status.trim();
    if (!["Paid", "Pending", "Partial"].includes(status)) {
      return res.status(400).json({ error: "payment_status must be 'Paid', 'Pending', or 'Partial'." });
    }

    const amountPaid =
      status === "Paid" ? tonnes * rate : status === "Partial" ? (tonnes * rate) / 2 : 0;

    const result = await pool.query(
      `INSERT INTO farmers (
        farmer_name, village, supply_tonnes, payment_status,
        supply_date, rate_per_tonne, amount_paid,
        mobile_number, sugarcane_variety
      ) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5, $6, $7, $8) RETURNING *;`,
      [
        farmer_name.trim(),
        village.trim(),
        tonnes,
        status,
        rate,
        amountPaid,
        mobile_number ? mobile_number.trim() : null,
        sugarcane_variety ? sugarcane_variety.trim() : "Co-86032",
      ]
    );

    console.log(
      `[Database] Inserted new farmer record: #${result.rows[0].farmer_id} - ${result.rows[0].farmer_name} (${result.rows[0].village})`
    );

    res.status(201).json({ success: true, farmer: result.rows[0] });
  } catch (error: any) {
    console.error("[API Error] Failed to create farmer:", error.message);
    res.status(500).json({ error: error.message });
  }
});

// Endpoint: Process Chat Message using MCP + OpenAI Responses API
app.post("/api/chat", async (req, res) => {
  const { message } = req.body;
  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Missing message in request body" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const isKeyConfigured = apiKey && apiKey !== "your_openai_api_key_here";

  // If OpenAI key is not configured, fallback to direct smart query so UI works immediately
  if (!isKeyConfigured) {
    try {
      const dbResult = await pool.query(
        "SELECT farmer_id, farmer_name, village, supply_tonnes, payment_status FROM farmers ORDER BY farmer_id ASC;"
      );
      const rows = dbResult.rows;
      const lower = message.toLowerCase();
      const isMarathi = /[\u0900-\u097F]/.test(message); // Detect Devanagari script

      // Factory General Knowledge answers (Support English & Devanagari Marathi)
      if (lower.includes("chairman") || lower.includes("president") || lower.includes("vivek") || message.includes("अध्यक्ष") || message.includes("विवेक")) {
        return res.json({
          reply: isMarathi 
            ? `**संजीवनी साखर कारखाना नेतृत्व:**\n• **अध्यक्ष:** **श्री. विवेक बिपिन कोल्हे** — संचालक मंडळाचे अध्यक्ष असून सहकार महर्षी शंकरराव कोल्हे सहकारी साखर कारखान्याच्या आधुनिकीकरणाचे नेतृत्व करत आहेत.\n• **संस्थापक:** कै. **शंकररावजी गेणूजी कोल्हे** (माजी मंत्री, महाराष्ट्र शासन), ज्यांनी १९६० मध्ये या कारखान्याची स्थापना केली.`
            : `**Leadership of Sanjivani Sugar Factory:**\n• **Chairman:** **Shri. Vivek Bipin Kolhe** leads the board of directors and guides the modernization of Sahakar Maharshi Shankarrao Kolhe Sahakari Sakhar Karkhana Ltd.\n• **Founder:** Late Hon. **Shri. Shankarraoji Genuji Kolhe** (Ex-Minister, Govt. of Maharashtra), who founded the factory in 1960.`
        });
      }

      if (lower.includes("founder") || lower.includes("history") || lower.includes("shankarrao") || lower.includes("established") || message.includes("संस्थापक") || message.includes("इतिहास") || message.includes("शंकरराव")) {
        return res.json({
          reply: isMarathi
            ? `**इतिहास व संस्थापक:**\n• **नोंदणी:** २८ ऑक्टोबर, १९६० (पहिली चाचणी गाळप: नोव्हेंबर १९६३).\n• **संस्थापक:** **सहकार महर्षी शंकररावजी कोल्हे**, महाराष्ट्रातील सहकार चळवळीचे मार्गदर्शक.\n• **पत्ता:** सहजानंदनगर, पो. शिंगणापूर, ता. कोपरगाव, जि. अहिल्यानगर (अहमदनगर).`
            : `**History & Founder:**\n• **Registered:** 28th October, 1960 (Trial crushing began November 1963).\n• **Founder:** **Sahakar Maharshi Shankarraoji Kolhe**, pioneering cooperative leader in Maharashtra.\n• **Location:** Sahajanandnagar, P.O. Shingnapur, Kopargaon, Dist. Ahilyanagar (Ahmednagar).`
        });
      }

      if (lower.includes("division") || lower.includes("product") || lower.includes("ethanol") || lower.includes("chemical") || message.includes("विभाग") || message.includes("उत्पादन") || message.includes("इथेनॉल")) {
        return res.json({
          reply: isMarathi
            ? `**कारखान्याचे मुख्य औद्योगिक विभाग व उत्पादने:**\n1. **साखर विभाग:** पांढरी स्फटिक साखर (M-30, S-30) व कच्ची साखर (४,५०० TCD गाळप).\n2. **डिस्टिलरी व इथेनॉल:** फ्युएल इथेनॉल (२०% पेट्रोल ब्लेंड) व एक्स्ट्रा न्यूट्रल अल्कोहोल (ENA).\n3. **केमिकल्स:** ॲसिटिक ॲसिड, इथाईल ॲसिटेट, ॲसिटिक ॲनहायड्राइड.\n4. **फार्मा विभाग:** TEO व EMME बल्क औषध मध्यस्थ.\n5. **हरित ऊर्जा व बायो-CNG:** ३० मेगावॅट को-जनरेशन व कॉम्प्रेस्ड बायोगॅस (CBG).\n6. **सेंद्रिय खते:** *सल्फाबॅक्ट*, बायो-कंपोस्ट व फॉस्फो-कंपोस्ट.`
            : `**Key Industrial Verticals & Products:**\n1. **Sugar Division:** Plantation White Sugar (M-30, S-30) & Raw Sugar (4,500 TCD).\n2. **Distillery & Ethanol:** Bio-Ethanol (supporting 20% petrol blending mandate) & Extra Neutral Alcohol (ENA).\n3. **Chemicals:** Acetic Acid, Ethyl Acetate, Acetic Anhydride.\n4. **Pharma Intermediates:** TEO & EMME.\n5. **Green Power & Bio-CNG:** 30 MW Co-generation & compressed bio-methane gas.\n6. **Bio-Fertilizers:** *Sulfabact*, Bio-compost & Phospho-compost.`
        });
      }

      if ((lower.includes("100") || message.includes("१००")) && (lower.includes("pending") || lower.includes("payment") || message.includes("बाकी") || message.includes("प्रलंबित") || message.includes("पेमेंट"))) {
        const filtered = rows.filter(
          (r) => parseFloat(r.supply_tonnes) > 100 && r.payment_status.toLowerCase() === "pending"
        );
        let reply = isMarathi
          ? `**संजीवनी साखर कारखाना (कोपरगाव) - शेतकरी खातेवही:**\n१०० टनांपेक्षा जास्त ऊस पुरवठा करून पेमेंट प्रलंबित असलेले **${filtered.length} शेतकरी** आढळले:\n\n`
          : `**Sanjivani Sugar Factory (Kopargaon) - Farmer Ledger:**\nFound **${filtered.length} farmers** who supplied > 100 tonnes with Pending payments:\n\n`;

        filtered.forEach((f) => {
          reply += isMarathi
            ? `• **${f.farmer_name}** (${f.village}) — **${f.supply_tonnes} टन** &bull; पेमेंट: *प्रलंबित (Pending)*\n`
            : `• **${f.farmer_name}** (${f.village}) — **${f.supply_tonnes} tonnes** &bull; Status: *Pending*\n`;
        });
        return res.json({ reply });
      }

      if (lower.includes("top") || lower.includes("maximum") || lower.includes("highest") || message.includes("सर्वाधिक") || message.includes("जास्त") || message.includes("पहिला")) {
        const top = [...rows].sort((a,b) => parseFloat(b.supply_tonnes) - parseFloat(a.supply_tonnes))[0];
        return res.json({
          reply: isMarathi
            ? `🏆 **या हंगामातील सर्वाधिक ऊस पुरवठादार शेतकरी:**\n• **नाव:** **${top.farmer_name}** (${top.village})\n• **पुरवठा:** **${top.supply_tonnes} टन**\n• **पेमेंट स्थिती:** *${top.payment_status === 'Paid' ? 'पूर्ण अदा' : top.payment_status === 'Pending' ? 'प्रलंबित' : 'अंशतः अदा'}*`
            : `🏆 **Top Sugarcane Supplier this Season:**\n• **Farmer:** **${top.farmer_name}** from **${top.village}**\n• **Supply:** **${top.supply_tonnes} tonnes**\n• **Payment Status:** *${top.payment_status}*`
        });
      }

      return res.json({
        reply: isMarathi
          ? `**सहकार महर्षी शंकरराव कोल्हे सहकारी साखर कारखाना लि.** डेटाबेसशी जोडणी यशस्वी झाली (${rows.length} नोंदी). आपण ऊस आवक, पेमेंट स्थिती, कारखान्याचे विभाग किंवा अध्यक्ष श्री. विवेक कोल्हे यांच्याविषयी प्रश्न विचारू शकता!`
          : `Connected to **Sahakar Maharshi Shankarrao Kolhe Sahakari Sakhar Karkhana Ltd. (Sanjivani Sugar Factory)** database with ${rows.length} records. Ask about sugarcane tonnage, payment status, factory divisions, or Chairman Shri Vivek Kolhe!`
      });
    } catch (e: any) {
      return res.status(500).json({ error: e.message });
    }
  }

  // MCP Client + OpenAI Execution
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["./node_modules/tsx/dist/cli.mjs", "mcp-server.ts"],
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
    } as Record<string, string>,
  });

  const mcpClient = new Client(
    { name: "sanjivani-web-chatbot-client", version: "1.0.0" },
    { capabilities: {} }
  );

  const openai = new OpenAI({ apiKey });
  const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

  try {
    await mcpClient.connect(transport);
    const toolsResult = await mcpClient.listTools();

    const openAiTools = toolsResult.tools.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description || "",
      parameters: {
        type: "object",
        properties: (tool.inputSchema as any)?.properties ?? {},
        required: (tool.inputSchema as any)?.required ?? [],
        additionalProperties: false,
      },
      strict: true,
    }));

    const factoryInstructions =
      "You are the official AI Assistant for Sahakar Maharshi Shankarrao Kolhe Sahakari Sakhar Karkhana Ltd. (The Sanjivani Sugar Factory, Kopargaon), established in 1960 at Sahajanandnagar by late Hon. Shri Shankarraoji Kolhe, currently chaired by Shri Vivek Kolhe. Answer questions clearly about farmer cane tonnage, payments, FRP, varieties (Co-86032, CoM-0265), and factory divisions (Sugar, Ethanol, Distillery, Chemicals, Pharma, Power, Bio-fertilizers) using the available MCP tool 'get_farmer_records'. IMPORTANT: If the user writes in Marathi or Devanagari script (e.g. देवनागरी / मराठी), you MUST respond in fluent, respectful Marathi using Devanagari script.";

    const inputItems: any[] = [{ role: "user", content: message }];

    const initialResponse = await openai.responses.create({
      model: MODEL,
      instructions: factoryInstructions,
      input: inputItems,
      tools: openAiTools,
    });

    const toolCall = initialResponse.output.find((item) => item.type === "function_call");

    if (toolCall && toolCall.type === "function_call") {
      const callArgs = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
      const toolExecutionResult = await mcpClient.callTool({
        name: toolCall.name,
        arguments: callArgs,
      });

      const toolOutputText = (toolExecutionResult.content as any[])
        .map((c) => (c.type === "text" ? c.text : JSON.stringify(c)))
        .join("\n");

      const continuationInput = [
        ...inputItems,
        ...initialResponse.output,
        {
          type: "function_call_output" as const,
          call_id: toolCall.call_id,
          output: toolOutputText,
        },
      ];

      const finalResponse = await openai.responses.create({
        model: MODEL,
        instructions: factoryInstructions,
        input: continuationInput as any,
        tools: openAiTools,
      });

      return res.json({ reply: finalResponse.output_text });
    } else {
      return res.json({ reply: initialResponse.output_text });
    }
  } catch (err: any) {
    console.error("[Chat Error]:", err?.message || err);
    return res.status(500).json({ error: err?.message || "Failed to process chat query" });
  } finally {
    try {
      await mcpClient.close();
      await transport.close();
    } catch {}
  }
});

app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🌾 Sanjivani Sugar Factory Portal & Chatbot Online!`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`======================================================\n`);
});
